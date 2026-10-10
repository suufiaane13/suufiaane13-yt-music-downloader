use std::collections::HashSet;
use std::io::Read;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

/// Borne haute du nombre de résultats renvoyés au frontend.
pub const MAX_LIMIT: u32 = 50;
/// Borne basse (une page « mode éco » vaut 12).
pub const MIN_LIMIT: u32 = 5;
/// Delai maximal d'une recherche avant que le process yt-dlp soit tué.
pub const SEARCH_TIMEOUT: Duration = Duration::from_secs(12);
/// Longueur maximale d'une requête (en caractères Unicode).
const MAX_QUERY_CHARS: usize = 100;
/// Garde-fou mémoire sur la sortie JSON lue (4 Mo suffisent largement).
const MAX_OUTPUT_BYTES: u64 = 4 * 1024 * 1024;
/// Timeout réseau passé à yt-dlp (`--socket-timeout`).
const SOCKET_TIMEOUT: &str = "8";

/// Budget « une seule requête réseau à la fois » : les recherches sont
/// sérialisées pour ne pas saturer un petit CPU.
static SEARCH_LOCK: Mutex<()> = Mutex::new(());

/// Jeton de génération : toute recherche plus récente invalide la précédente,
/// ce qui permet d'annuler proprement un process yt-dlp déjà lancé.
static SEARCH_GEN: AtomicU64 = AtomicU64::new(0);

/// Un résultat de recherche, réduit au strict nécessaire pour l'affichage.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SearchItem {
    pub id: String,
    pub title: String,
    pub channel: String,
    #[serde(default)]
    pub duration: Option<f64>,
    pub thumbnail: String,
    pub url: String,
    /// `video` | `playlist`
    pub kind: String,
    #[serde(default)]
    pub views: Option<u64>,
}

/// Réponse d'une recherche (une page de résultats).
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SearchPage {
    pub query: String,
    pub items: Vec<SearchItem>,
    /// true quand la page provient du cache local (aucun appel réseau).
    pub cached: bool,
    pub elapsed_ms: u64,
    /// true quand yt-dlp a rendu exactement `limit` résultats : il en reste
    /// probablement d'autres.
    pub has_more: bool,
}

impl SearchPage {
    pub fn new(
        query: String,
        items: Vec<SearchItem>,
        cached: bool,
        elapsed_ms: u64,
        limit: u32,
    ) -> Self {
        let has_more = items.len() >= limit as usize && limit < MAX_LIMIT;
        Self {
            query,
            items,
            cached,
            elapsed_ms,
            has_more,
        }
    }
}

/// Réserve un jeton : les recherches portant un jeton plus ancien sont
/// considérées comme obsolètes et tuées.
pub fn new_token() -> u64 {
    SEARCH_GEN.fetch_add(1, Ordering::SeqCst) + 1
}

/// Annule la recherche en cours (ou la prochaine si aucune ne tourne).
pub fn cancel() {
    SEARCH_GEN.fetch_add(1, Ordering::SeqCst);
}

fn is_stale(token: u64) -> bool {
    SEARCH_GEN.load(Ordering::SeqCst) != token
}

/// Verrou d'exclusion mutuelle des recherches (1 requête à la fois).
pub fn lock() -> MutexGuard<'static, ()> {
    SEARCH_LOCK.lock().unwrap_or_else(|e| e.into_inner())
}

// ---------------------------------------------------------------------------
// Requête
// ---------------------------------------------------------------------------

/// Normalise une requête pour la clé de cache (minuscules, espaces uniques).
pub fn normalize(query: &str) -> String {
    query
        .to_lowercase()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// Valide et nettoie une requête saisie par l'utilisateur : caractères de
/// contrôle retirés, espaces uniques, longueur bornée.
pub fn sanitize_query(raw: &str) -> Result<String, String> {
    let mut q = String::new();
    let mut last_space = true;
    for c in raw.chars() {
        if c.is_control() {
            continue;
        }
        if c.is_whitespace() {
            if !last_space {
                q.push(' ');
            }
            last_space = true;
        } else {
            q.push(c);
            last_space = false;
        }
    }
    let q: String = q.trim().chars().take(MAX_QUERY_CHARS).collect();
    if q.chars().count() < 2 {
        return Err("Saisissez au moins 2 caractères.".to_string());
    }
    Ok(q)
}

/// Encodage percent minimal pour construire l'URL de recherche YouTube.
pub fn urlencode(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for b in input.as_bytes() {
        let byte = *b;
        let c = byte as char;
        if c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '~') {
            out.push(c);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

// ---------------------------------------------------------------------------
// Cible yt-dlp
// ---------------------------------------------------------------------------

/// Onglet de recherche : vidéos (`ytsearchN:`) ou playlists (filtre
/// `sp=EgIQAw%3D%3D` appliqué à la page de résultats YouTube).
fn target_url(tab: &str, query: &str, limit: u32) -> String {
    if tab == "playlist" {
        format!(
            "https://www.youtube.com/results?search_query={}&sp=EgIQAw%253D%253D",
            urlencode(query)
        )
    } else {
        format!("ytsearch{limit}:{query}")
    }
}

/// Arguments de recherche. Le frontend ne fournit jamais d'options : la
/// commande est construite ici, la requête est placée après `--` pour
/// qu'aucun contenu utilisateur ne puisse être interprété comme un flag.
pub fn search_args(bin: &PathBuf, query: &str, tab: &str, limit: u32) -> Vec<String> {
    let mut args = vec![
        "-J".to_string(),
        "--flat-playlist".to_string(),
        "--skip-download".to_string(),
        "--no-warnings".to_string(),
        "--ignore-errors".to_string(),
        "--socket-timeout".to_string(),
        SOCKET_TIMEOUT.to_string(),
        "--retries".to_string(),
        "1".to_string(),
        "--extractor-retries".to_string(),
        "1".to_string(),
        "--playlist-end".to_string(),
        limit.to_string(),
    ];
    // Même runtime JS que l'analyse/téléchargement (si deno.exe est présent).
    if crate::paths::has_js_runtime(bin) {
        let deno = crate::paths::deno(bin);
        args.push("--js-runtimes".to_string());
        args.push(format!("deno:{}", deno.to_string_lossy()));
    }
    args.push("--".to_string());
    args.push(target_url(tab, query, limit));
    args
}

// ---------------------------------------------------------------------------
// Analyse de la sortie
// ---------------------------------------------------------------------------

#[derive(Deserialize, Default)]
struct ThumbnailJson {
    #[serde(default)]
    url: String,
    #[serde(default)]
    width: Option<u32>,
}

#[derive(Deserialize, Default)]
struct EntryJson {
    #[serde(default)]
    id: String,
    #[serde(default)]
    title: String,
    #[serde(default)]
    url: Option<String>,
    #[serde(default)]
    duration: Option<f64>,
    #[serde(default)]
    channel: Option<String>,
    #[serde(default)]
    uploader: Option<String>,
    #[serde(default)]
    view_count: Option<u64>,
    #[serde(default)]
    thumbnails: Option<Vec<ThumbnailJson>>,
}

#[derive(Deserialize, Default)]
struct SearchInfo {
    #[serde(default)]
    entries: Option<Vec<EntryJson>>,
}

/// Un identifiant de vidéo YouTube fait 11 caractères base64url ; les
/// identifiants de playlist commencent par PL/UU/OL/RD/LL.
pub fn is_video_id(id: &str) -> bool {
    id.len() == 11
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// Miniature la plus légère proposée par yt-dlp (utilisée pour les playlists,
/// pour lesquelles `i.ytimg.com/vi/<id>` n'est pas valide).
fn lightest_thumb(thumbs: &Option<Vec<ThumbnailJson>>) -> Option<String> {
    thumbs
        .as_ref()?
        .iter()
        .filter(|t| !t.url.is_empty())
        .min_by_key(|t| t.width.unwrap_or(u32::MAX))
        .map(|t| t.url.clone())
}

/// Convertit la sortie JSON de yt-dlp en résultats exploitables : dédoublonnage,
/// exclusion des entrées hors périmètre (chaînes), miniatures allégées.
pub fn parse_entries(raw: &[u8], limit: u32) -> Result<Vec<SearchItem>, String> {
    let info: SearchInfo =
        serde_json::from_slice(raw).map_err(|e| format!("Réponse YouTube illisible : {e}"))?;
    let entries = info
        .entries
        .ok_or_else(|| "Réponse YouTube vide.".to_string())?;

    let mut seen: HashSet<String> = HashSet::with_capacity(entries.len());
    let mut out: Vec<SearchItem> = Vec::new();

    for e in entries {
        let id = e.id.trim().to_string();
        if id.is_empty() || !seen.insert(id.clone()) {
            continue;
        }
        let raw_url = e.url.clone().unwrap_or_default();
        if raw_url.contains("/channel/") || raw_url.contains("youtube.com/@") {
            continue;
        }

        let is_video = is_video_id(&id);
        let (kind, url) = if is_video {
            let url = if raw_url.starts_with("https://") {
                raw_url.clone()
            } else {
                format!("https://www.youtube.com/watch?v={id}")
            };
            ("video".to_string(), url)
        } else if raw_url.contains("/playlist?list=") {
            ("playlist".to_string(), raw_url.clone())
        } else {
            continue;
        };

        let thumbnail = if is_video {
            // 320x180 : le plus petit format standard, suffisant pour une ligne.
            format!("https://i.ytimg.com/vi/{id}/mqdefault.jpg")
        } else {
            lightest_thumb(&e.thumbnails).unwrap_or_default()
        };

        let title = {
            let t = e.title.trim();
            if t.is_empty() {
                id.clone()
            } else {
                t.to_string()
            }
        };
        let channel = e
            .channel
            .clone()
            .filter(|s| !s.trim().is_empty())
            .or_else(|| e.uploader.clone())
            .map(|s| s.trim().to_string())
            .unwrap_or_else(|| if is_video { "YouTube" } else { "Playlist" }.to_string());

        out.push(SearchItem {
            id,
            title,
            channel,
            duration: if is_video { e.duration } else { None },
            thumbnail,
            url,
            kind,
            views: if is_video { e.view_count } else { None },
        });

        if out.len() >= limit as usize {
            break;
        }
    }

    Ok(out)
}

// ---------------------------------------------------------------------------
// Exécution
// ---------------------------------------------------------------------------

/// Lance une recherche yt-dlp. Le process est tué si le délai est dépassé ou si
/// une recherche plus récente a pris la main (jeton périmé).
pub fn search(
    bin: &PathBuf,
    query: &str,
    tab: &str,
    limit: u32,
    token: u64,
) -> Result<Vec<SearchItem>, String> {
    crate::ytdlp::wait_update();

    let mut cmd = crate::ytdlp::raw_command(bin);
    cmd.args(search_args(bin, query, tab, limit))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("yt-dlp indisponible : {e}"))?;

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let out_handle = std::thread::spawn(move || {
        let mut buf = Vec::new();
        if let Some(mut s) = stdout {
            let _ = s.by_ref().take(MAX_OUTPUT_BYTES).read_to_end(&mut buf);
        }
        buf
    });
    let err_handle = std::thread::spawn(move || {
        let mut buf = Vec::new();
        if let Some(s) = stderr {
            let _ = s.take(64 * 1024).read_to_end(&mut buf);
        }
        buf
    });

    let start = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => {}
            Err(e) => return Err(format!("yt-dlp : {e}")),
        }
        if start.elapsed() >= SEARCH_TIMEOUT {
            let _ = child.kill();
            return Err("Recherche trop longue : délai dépassé.".to_string());
        }
        if is_stale(token) {
            let _ = child.kill();
            return Err("Recherche annulée.".to_string());
        }
        std::thread::sleep(Duration::from_millis(120));
    };

    let out = out_handle.join().unwrap_or_default();
    let err = err_handle.join().unwrap_or_default();
    let stderr_text = String::from_utf8_lossy(&err).to_string();

    if !status.success() {
        return Err(last_error_line(&stderr_text));
    }

    let items = parse_entries(&out, limit)?;
    if items.is_empty() && !stderr_text.trim().is_empty() {
        return Err(last_error_line(&stderr_text));
    }
    Ok(items)
}

/// Extrait la dernière ligne d'erreur utile de yt-dlp (les traces "--ignore-errors"
/// précèdent le message final).
fn last_error_line(stderr: &str) -> String {
    let line = stderr
        .lines()
        .rev()
        .map(|l| l.trim())
        .find(|l| !l.is_empty())
        .unwrap_or("")
        .to_string();
    let line = line
        .strip_prefix("ERROR:")
        .unwrap_or(&line)
        .trim()
        .to_string();
    if line.is_empty() {
        "Recherche YouTube impossible.".to_string()
    } else {
        line
    }
}
