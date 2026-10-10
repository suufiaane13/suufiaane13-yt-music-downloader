use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::youtube_search::SearchItem;

/// Nombre maximum de recherches mises en cache.
const MAX_QUERIES: usize = 100;
/// Nombre maximum de résultats conservés au total (~2-3 Mo de JSON).
const MAX_ITEMS_TOTAL: usize = 500;
/// Durée de validité d'une entrée (24 h).
const TTL_SECS: u64 = 24 * 3600;

static CACHE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Serialize, Deserialize, Clone)]
struct CacheEntry {
    /// Clé normalisée (minuscules, espaces uniques).
    query: String,
    /// Nombre de résultats récupérés lors du dernier appel réseau.
    limit: u32,
    /// Horodatage Unix (secondes).
    at: u64,
    items: Vec<SearchItem>,
}

#[derive(Serialize, Deserialize, Default)]
struct CacheFile {
    #[serde(default)]
    entries: Vec<CacheEntry>,
}

fn cache_path() -> PathBuf {
    let appdata = std::env::var("APPDATA").unwrap_or_else(|_| ".".into());
    PathBuf::from(appdata)
        .join("YTMusicDownloader")
        .join("search_cache.json")
}

fn tmp_path() -> PathBuf {
    let p = cache_path();
    p.with_extension("json.tmp")
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn load() -> CacheFile {
    match fs::read_to_string(cache_path()) {
        Ok(raw) => serde_json::from_str(&raw).unwrap_or_default(),
        Err(_) => CacheFile::default(),
    }
}

/// Écriture atomique : fichier temporaire puis renommage. Une coupure de
/// courant ne peut donc pas laisser un `search_cache.json` tronqué (le
/// respaldo `*.tmp` est ignoré au chargement).
fn store(file: &CacheFile) {
    let path = cache_path();
    if let Some(dir) = path.parent() {
        let _ = fs::create_dir_all(dir);
    }
    let Ok(json) = serde_json::to_string(file) else {
        return;
    };
    let tmp = tmp_path();
    if fs::write(&tmp, json).is_err() {
        return;
    }
    let _ = fs::rename(&tmp, &path);
}

/// Retourne une page de résultats si elle est en cache et fraîche.
/// `limit` doit être inférieur ou égal au `limit` d'origine : « Charger plus »
/// peut ainsi servir une requête plus longue depuis le cache, sans réseau.
pub fn get(query: &str, limit: u32) -> Option<Vec<SearchItem>> {
    let key = crate::youtube_search::normalize(query);
    if key.is_empty() {
        return None;
    }
    let _guard = CACHE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let now = now();
    load()
        .entries
        .into_iter()
        .find(|e| e.query == key && e.at.saturating_add(TTL_SECS) > now && e.limit >= limit)
        .map(|e| e.items.into_iter().take(limit as usize).collect())
}

/// Mémorise les résultats d'une recherche (écriture différée au prochain appel :
/// le fichier est de quelques dizaines de Ko maximum).
pub fn put(query: &str, limit: u32, items: Vec<SearchItem>) {
    if items.is_empty() {
        return;
    }
    let key = crate::youtube_search::normalize(query);
    if key.is_empty() {
        return;
    }
    let _guard = CACHE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let now = now();
    let mut file = load();
    file.entries
        .retain(|e| e.at.saturating_add(TTL_SECS) > now && e.query != key);
    file.entries.push(CacheEntry {
        query: key,
        limit,
        at: now,
        items,
    });
    // Les plus récentes d'abord.
    file.entries.sort_by(|a, b| b.at.cmp(&a.at));
    file.entries.truncate(MAX_QUERIES);

    // Garde-fou mémoire : on retire les entrées les plus anciennes au-delà du
    // quota total de résultats.
    let mut total = 0usize;
    let mut kept: Vec<CacheEntry> = Vec::new();
    for e in file.entries.into_iter() {
        let next = total + e.items.len();
        if next > MAX_ITEMS_TOTAL && !kept.is_empty() {
            break;
        }
        total = next;
        kept.push(e);
    }
    file.entries = kept;
    store(&file);
}

/// Vide le cache des recherches (action « Vider le cache » des paramètres).
pub fn clear() {
    let _guard = CACHE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let _ = fs::remove_file(cache_path());
    let _ = fs::remove_file(tmp_path());
}
