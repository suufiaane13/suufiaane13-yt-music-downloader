use std::collections::HashMap;
use std::sync::Arc;

use serde::Deserialize;
use tauri::{AppHandle, Emitter, State};

use crate::manager::{new_task_id, Manager};
use crate::models::{EngineCheck, Task};
use crate::settings::{Settings, SettingsPatch};
use crate::ytdlp::VideoInfo;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OwnedQuery {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub media: Option<String>,
}

#[tauri::command]
pub fn get_tasks(state: State<'_, Arc<Manager>>) -> Vec<Task> {
    let guard = state.inner.lock().unwrap();
    guard
        .order
        .iter()
        .filter_map(|id| guard.tasks.get(id))
        .cloned()
        .collect()
}

#[tauri::command]
pub fn get_settings(state: State<'_, Arc<Manager>>) -> Settings {
    state.inner.lock().unwrap().settings.clone()
}

/// Contrôle que les binaires du moteur (yt-dlp, ffmpeg, ffprobe) sont présents
/// dans le dossier `bin/`. Exécution immédiate : simple test de présence —
/// aucun verrou de mise à jour ici (la lecture de version, elle, en attend la
/// fin ; pas un simple `Stat` de fichier).
#[tauri::command]
pub fn check_engine(state: State<'_, Arc<Manager>>) -> EngineCheck {
    // Re-résout le dossier bin à chaque appel : si la première résolution au
    // boot a échoué (binaires pas encore copiés), elle se corrige d'elle-même.
    let bin = crate::paths::resolve_bin_dir();
    {
        let mut guard = state.inner.lock().unwrap();
        guard.bin_dir = bin.clone();
    }
    let yt = bin.join("yt-dlp.exe").is_file();
    let ff = bin.join("ffmpeg.exe").is_file();
    let fp = bin.join("ffprobe.exe").is_file();
    let js = crate::paths::has_js_runtime(&bin);
    crate::debuglog::log(format!(
        "check_engine -> {} | yt-dlp={} ffmpeg={} ffprobe={} js={}",
        bin.display(),
        yt,
        ff,
        fp,
        js
    ));
    EngineCheck {
        yt_dlp: yt,
        ffmpeg: ff,
        ffprobe: fp,
        js_runtime: js,
        bin_dir: bin.to_string_lossy().to_string(),
    }
}

#[tauri::command]
pub async fn set_settings(
    state: State<'_, Arc<Manager>>,
    patch: SettingsPatch,
) -> Result<(), String> {
    // Écriture disque + création du dossier de sortie : hors thread principal
    // pour ne pas geler la fenêtre (les réglages sont modifiés à la volée).
    let inner = state.inner.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut guard = inner.lock().unwrap();
        guard.settings.apply(patch);
        let s = guard.settings.clone();
        crate::settings::save(&s)?;
        let new_max = crate::settings::effective_concurrency(&s);
        guard.max_concurrent = new_max;
        guard.gov.set_max(new_max);
        let _ = std::fs::create_dir_all(&s.output_dir);
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Met à jour yt-dlp (self-update). Retourne la nouvelle version.
#[tauri::command]
pub async fn ytdlp_update(state: State<'_, Arc<Manager>>) -> Result<String, String> {
    let bin = crate::paths::resolve_bin_dir();
    {
        let mut guard = state.inner.lock().unwrap();
        guard.bin_dir = bin.clone();
    }
    crate::debuglog::log(format!(
        "ytdlp_update -> exe : {}",
        bin.join("yt-dlp.exe").display()
    ));
    let r = tauri::async_runtime::spawn_blocking(move || crate::ytdlp::update(&bin))
        .await
        .map_err(|e| e.to_string())?;
    match &r {
        Ok(v) => crate::debuglog::log(format!("ytdlp_update -> ok : {v}")),
        Err(e) => crate::debuglog::log(format!("ytdlp_update -> erreur : {e}")),
    }
    r
}

/// Dernières lignes du journal de diagnostic (pour l'onglet paramètres).
#[tauri::command]
pub fn get_debug_log(n: u32) -> Vec<String> {
    crate::debuglog::tail(n as usize)
}

/// Ouvre un emplacement dans l'Explorateur : un dossier est ouvert directement ;
/// pour un fichier, son dossier parent s'ouvre avec le fichier **sélectionné**
/// (`explorer /select,`). Accepte les chemins relatifs (résolus depuis le
/// dossier de travail) et les séparateurs mixtes `/` et `\`.
#[tauri::command]
pub fn open_path(path: String) -> Result<(), String> {
    use std::os::windows::process::CommandExt;

    let raw = path.trim();
    if raw.is_empty() {
        return Err("Chemin vide.".into());
    }
    let normalized = raw.replace('/', "\\");
    let candidate = std::path::PathBuf::from(&normalized);
    let abs = if candidate.is_absolute() {
        candidate
    } else {
        std::env::current_dir().unwrap_or_default().join(candidate)
    };

    let result = if abs.is_file() {
        // `raw_arg` transmet l'argument tel quel (quotes internes non échappées
        // par le runtime) : Explorer comprend `/select,"<chemin avec espaces>"`.
        std::process::Command::new("explorer")
            .raw_arg(format!("/select,\"{}\"", abs.to_string_lossy()))
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string())
    } else if abs.is_dir() {
        std::process::Command::new("explorer")
            .arg(abs.to_string_lossy().to_string())
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string())
    } else {
        Err(format!("Chemin introuvable : {}", abs.display()))
    };
    match &result {
        Ok(_) => crate::debuglog::log(format!("open_path -> {}", abs.display())),
        Err(e) => crate::debuglog::log(format!("open_path -> échec : {e}")),
    }
    result
}

#[tauri::command]
pub async fn analyze_url(
    _state: State<'_, Arc<Manager>>,
    url: String,
    max_entries: Option<u32>,
) -> Result<VideoInfo, String> {
    let bin = crate::paths::resolve_bin_dir();
    tauri::async_runtime::spawn_blocking(move || {
        crate::ytdlp::analyze(&bin, &url, Some(max_entries.unwrap_or(100)))
    })
    .await
    .map_err(|e| e.to_string())?
}

// ---------------------------------------------------------------------------
// Recherche YouTube (page « Explorer »)
// ---------------------------------------------------------------------------

/// Recherche une page de résultats YouTube (vidéos ou playlists).
///
/// Le cache local est interrogé d'abord : une requête identique est servie
/// immédiatement (< 100 ms) et fonctionne hors connexion. Sinon un unique
/// process yt-dlp est lancé (réservé en amont, timeout 12 s) et le résultat
/// est mémorisé. Une recherche plus récente annule la précédente.
#[tauri::command]
pub async fn search_youtube(
    query: String,
    tab: Option<String>,
    limit: Option<u32>,
) -> Result<crate::youtube_search::SearchPage, String> {
    let q = crate::youtube_search::sanitize_query(&query)?;
    // Type explicite `&'static str` : le closure passé à `spawn_blocking`
    // doit être `'static`, il ne peut donc pas emprunter le `Option<String>`.
    let tab: &'static str = match tab.as_deref() {
        Some("playlist") => "playlist",
        _ => "video",
    };
    let limit = limit.unwrap_or(20).clamp(
        crate::youtube_search::MIN_LIMIT,
        crate::youtube_search::MAX_LIMIT,
    );

    if let Some(items) = crate::search_cache::get(&q, limit) {
        return Ok(crate::youtube_search::SearchPage::new(
            q, items, true, 0, limit,
        ));
    }

    let bin = crate::paths::resolve_bin_dir();
    let q2 = q.clone();
    tauri::async_runtime::spawn_blocking(move || {
        // Jeton pris AVANT le verrou : une recherche plus récente invalide
        // celle-ci, même si elle attendait son tour.
        let token = crate::youtube_search::new_token();
        let _guard = crate::youtube_search::lock();
        let start = std::time::Instant::now();
        let items = crate::youtube_search::search(&bin, &q2, tab, limit, token)?;
        let elapsed_ms = start.elapsed().as_millis() as u64;
        crate::debuglog::log(format!(
            "search_youtube -> « {q2} » [{tab}] limit={limit} : {} résultat(s) en {elapsed_ms} ms",
            items.len()
        ));
        crate::search_cache::put(&q2, limit, items.clone());
        Ok(crate::youtube_search::SearchPage::new(
            q2, items, false, elapsed_ms, limit,
        ))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Annule la recherche en cours (le process yt-dlp est tué au tick suivant).
#[tauri::command]
pub fn cancel_search() {
    crate::youtube_search::cancel();
    crate::debuglog::log("cancel_search -> recherche annulée");
}

/// Ouvre un lien YouTube dans le navigateur du système. L'hôte est validé
/// dans une liste blanche : aucune autre destination n'est acceptée.
#[tauri::command]
pub fn open_url(url: String) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    let raw = url.trim();
    if raw.is_empty() {
        return Err("Lien vide.".into());
    }
    if !raw.starts_with("https://") || raw.contains('"') || raw.contains('\n') {
        return Err("Lien non autorisé.".into());
    }
    let rest = &raw["https://".len()..];
    let authority = rest
        .split(|c: char| c == '/' || c == '?' || c == '#')
        .next()
        .unwrap_or("");
    let host = authority
        .split(':')
        .next()
        .unwrap_or("")
        .to_ascii_lowercase();
    let allowed = matches!(
        host.as_str(),
        "youtube.com"
            | "www.youtube.com"
            | "m.youtube.com"
            | "music.youtube.com"
            | "youtu.be"
            | "www.youtu.be"
            | "youtube-nocookie.com"
            | "www.youtube-nocookie.com"
    );
    if !allowed {
        return Err("Lien non autorisé.".into());
    }

    std::process::Command::new("cmd")
        .args(["/C", "start", "", raw])
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Vide le cache local des recherches YouTube.
#[tauri::command]
pub fn clear_search_cache() {
    crate::search_cache::clear();
    crate::debuglog::log("clear_search_cache -> cache vidé");
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadItem {
    pub url: String,
    pub title: Option<String>,
    #[serde(default)]
    pub thumbnail: Option<String>,
    /// `video` pour un MP4, absent/`audio` pour un MP3.
    #[serde(default)]
    pub media: Option<String>,
    /// Hauteur max MP4 (`1080`, `720`, `480`) ; `best` par défaut.
    #[serde(default)]
    pub video_format: Option<String>,
}

#[tauri::command]
pub fn add_downloads(
    state: State<'_, Arc<Manager>>,
    app: AppHandle,
    items: Vec<DownloadItem>,
) -> Result<Vec<String>, String> {
    let mut ids = Vec::new();
    let mut created: Vec<Task> = Vec::new();

    {
        let mut guard = state.inner.lock().unwrap();
        for item in items {
            let url = item.url.trim();
            if url.is_empty() {
                continue;
            }
            let id = new_task_id();
            let mut task = Task::new(id.clone(), url.to_string(), item.title.unwrap_or_default());
            // Format figé sur la tâche : un changement de réglage ultérieur
            // (ou une relance) ne change pas la sortie attendue.
            task.media = crate::settings::normalize_media(item.media.as_deref());
            task.video_format =
                crate::settings::normalize_video_format(item.video_format.as_deref());
            task.thumbnail = item.thumbnail.clone();
            created.push(task.clone());
            guard.tasks.insert(id.clone(), task);
            guard.order.push(id.clone());
            ids.push(id);
        }
        // Perse : tâches actives conservées pour une reprise au démarrage.
        crate::history::save(&guard);
    }

    {
        let mut q = state.qsync.m.lock().unwrap();
        for id in &ids {
            q.queue.push_back(id.clone());
        }
    }
    state.qsync.notify();

    for t in &created {
        let _ = app.emit("task-updated", t);
    }
    Ok(ids)
}

#[tauri::command]
pub fn cancel_task(
    state: State<'_, Arc<Manager>>,
    app: AppHandle,
    task_id: String,
) -> Result<(), String> {
    // Si c'est un Playlist-Job, on passe par le moteur de job (kill des yt-dlp).
    {
        let guard = state.inner.lock().unwrap();
        if guard.jobs.contains_key(&task_id) {
            let notify: crate::job::Notify = Arc::new(move |t| {
                let _ = app.emit("task-updated", &t);
            });
            return crate::job::cancel_job(&state.inner, &task_id, notify);
        }
    }

    let updated = {
        let mut guard = state.inner.lock().unwrap();
        let Some(t) = guard.tasks.get_mut(&task_id) else {
            return Err("Tâche introuvable".to_string());
        };
        if !matches!(t.status.as_str(), "queued" | "downloading" | "converting") {
            return Err("Tâche non annulable".to_string());
        }
        t.status = "cancelled".into();
        t.clone()
    };
    let _ = app.emit("task-updated", &updated);
    Ok(())
}

#[tauri::command]
pub fn clear_completed(state: State<'_, Arc<Manager>>) -> Result<Vec<String>, String> {
    let mut guard = state.inner.lock().unwrap();
    let to_remove: Vec<String> = guard
        .tasks
        .iter()
        .filter(|(_, t)| t.status == "completed")
        .map(|(id, _)| id.clone())
        .collect();
    for id in &to_remove {
        guard.tasks.remove(id);
        guard.jobs.remove(id);
    }
    guard.order.retain(|id| !to_remove.contains(id));
    crate::history::save(&guard);
    Ok(to_remove)
}

/// Remet une tâche simple ÉCHOUÉE (error/cancelled) dans la file pour la relancer.
/// Pour un Playlist-Job, redirige vers le retry des morceaux en échec.
#[tauri::command]
pub fn retry_task(
    state: State<'_, Arc<Manager>>,
    app: AppHandle,
    task_id: String,
) -> Result<(), String> {
    // Playlist-Job : relance uniquement les morceaux en échec.
    {
        let guard = state.inner.lock().unwrap();
        if guard.jobs.contains_key(&task_id) {
            let notify: crate::job::Notify = Arc::new(move |t| {
                let _ = app.emit("task-updated", &t);
            });
            return crate::job::retry_failed(&state.inner, &task_id, notify);
        }
    }

    let updated = {
        let mut guard = state.inner.lock().unwrap();
        let queued = {
            let Some(t) = guard.tasks.get_mut(&task_id) else {
                return Err("Tâche introuvable".to_string());
            };
            if !matches!(t.status.as_str(), "error" | "cancelled") {
                return Err("Seules les tâches en échec peuvent être relancées".to_string());
            }
            t.status = "queued".into();
            t.progress = 0.0;
            t.speed_bytes = 0;
            t.speed_mbps = 0.0;
            t.eta = 0;
            t.error = None;
            t.clone()
        };
        crate::history::save(&guard);
        queued
    };

    {
        let mut q = state.qsync.m.lock().unwrap();
        q.queue.push_back(task_id.clone());
    }
    state.qsync.notify();

    let _ = app.emit("task-updated", &updated);
    Ok(())
}

/// Relance uniquement les éléments en échec : tâches simples en erreur et
/// morceaux en erreur des Playlist-Jobs. Les tâches actives et terminées avec
/// succès ne sont jamais remises en file.
#[tauri::command]
pub fn redownload_failed(state: State<'_, Arc<Manager>>, app: AppHandle) -> Result<u32, String> {
    let mut requeued: Vec<Task> = Vec::new();
    // (job_id, retry_all) : retry_all est nécessaire pour un job dont
    // l'analyse de playlist a échoué avant la création de ses entrées.
    let mut jobs: Vec<(String, bool)> = Vec::new();
    let mut count = 0u32;

    {
        let mut guard = state.inner.lock().unwrap();
        let job_keys: std::collections::HashSet<String> = guard.jobs.keys().cloned().collect();
        // Jobs dont des morceaux ont échoué : ils seront relancés par
        // `job::retry_failed` juste après cette section.
        let mut retry_failed_jobs: Vec<String> = Vec::new();

        for task in guard.tasks.values_mut() {
            if job_keys.contains(&task.id) {
                let failed_tracks = task.job_failed.unwrap_or(0);
                if failed_tracks > 0 {
                    count = count.saturating_add(failed_tracks);
                    retry_failed_jobs.push(task.id.clone());
                } else if task.status == "error" {
                    // Échec d'analyse/résolution : il n'y a pas encore de
                    // morceaux en échec à relancer, donc on rejoue le job.
                    count = count.saturating_add(1);
                    jobs.push((task.id.clone(), true));
                }
                continue;
            }

            if task.status == "error" {
                task.status = "queued".into();
                // Force : un fichier partiel ou un média déjà présent ne doit
                // pas faire passer la relance pour un succès (idempotence).
                task.force_redownload = true;
                task.progress = 0.0;
                task.speed_bytes = 0;
                task.speed_mbps = 0.0;
                task.eta = 0;
                task.error = None;
                task.output_path = None;
                task.skipped = false;
                count = count.saturating_add(1);
                requeued.push(task.clone());
            }
        }

        // Verrou du moteur : `inner` puis `job`, comme partout ailleurs.
        // Les morceaux en échec sont retéléchargés (et non ignorés) même si un
        // fichier du même nom traîne déjà dans le dossier de sortie.
        for id in &retry_failed_jobs {
            if let Some(job) = guard.jobs.get(id) {
                job.lock().unwrap().force_redownload = true;
            }
        }
        for id in retry_failed_jobs {
            jobs.push((id, false));
        }
        crate::history::save(&guard);
    }

    if !requeued.is_empty() {
        {
            let mut q = state.qsync.m.lock().unwrap();
            for task in &requeued {
                q.queue.push_back(task.id.clone());
            }
        }
        state.qsync.notify();
    }

    for (job_id, retry_all) in &jobs {
        let value = app.clone();
        let notify: crate::job::Notify = Arc::new(move |task| {
            let _ = value.emit("task-updated", &task);
        });
        let result = if *retry_all {
            crate::job::retry_all(&state.inner, job_id, notify)
        } else {
            crate::job::retry_failed(&state.inner, job_id, notify)
        };
        if let Err(error) = result {
            crate::debuglog::log(format!("redownload_failed -> {job_id} : {error}"));
        }
    }

    crate::history::save(&*state.inner.lock().unwrap());
    for task in &requeued {
        let _ = app.emit("task-updated", task);
    }

    Ok(count)
}

/// Annule TOUTES les tâches : celles en file (retirées de la file), celles en
/// cours (statut cancelled -> les workers tuent leur processus yt-dlp) et les
/// Playlist-Jobs (annulation du moteur de segment).
#[tauri::command]
pub fn cancel_all(state: State<'_, Arc<Manager>>, app: AppHandle) -> Result<(), String> {
    let mut job_ids: Vec<String> = Vec::new();
    let cancelled_tasks: Vec<crate::models::Task> = {
        let mut guard = state.inner.lock().unwrap();
        let job_keys: std::collections::HashSet<String> = guard.jobs.keys().cloned().collect();
        for t in guard.tasks.values_mut() {
            if matches!(t.status.as_str(), "queued" | "downloading" | "converting") {
                t.status = "cancelled".into();
                t.speed_bytes = 0;
                t.speed_mbps = 0.0;
                t.eta = 0;
                if job_keys.contains(&t.id) {
                    job_ids.push(t.id.clone());
                }
            }
        }
        // Vide la file d'attente : les tâches en attente ne seront pas lancées.
        {
            let mut q = state.qsync.m.lock().unwrap();
            q.queue.clear();
        }
        guard
            .tasks
            .values()
            .filter(|t| t.status == "cancelled")
            .cloned()
            .collect()
    };
    crate::history::save(&*state.inner.lock().unwrap());

    // Annule proprement les Playlist-Jobs (kill des process yt-dlp segments).
    for job_id in &job_ids {
        let value = app.clone();
        let notify: crate::job::Notify = Arc::new(move |t| {
            let _ = value.emit("task-updated", &t);
        });
        let _ = crate::job::cancel_job(&state.inner, job_id, notify);
    }

    // Réveille les workers bloqués dans le sémaphore global.
    state.inner.lock().unwrap().gov.wake();

    for t in &cancelled_tasks {
        let _ = app.emit("task-updated", t);
    }
    Ok(())
}

/// Démarre un Playlist-Job.
/// `media` : `video` pour MP4, absent/`audio` pour MP3.
/// `video_format` : hauteur max (`best`/`1080`/`720`/`480`).
/// L'interface envoie toujours les clés (valeur `null` acceptée par `Option`).
#[tauri::command]
pub fn start_playlist_job(
    state: State<'_, Arc<Manager>>,
    app: AppHandle,
    url: String,
    media: Option<String>,
    video_format: Option<String>,
) -> Result<String, String> {
    // Repli sur les réglages persistés : l'interface envoie toujours les deux
    // valeurs, mais un appel sans argument reste valide.
    let (default_media, default_video_format) = {
        let guard = state.inner.lock().unwrap();
        (
            guard.settings.default_media.clone(),
            guard.settings.video_format.clone(),
        )
    };
    let media = crate::settings::normalize_media(media.as_deref().or(Some(&default_media)));
    let video_format = crate::settings::normalize_video_format(
        video_format.as_deref().or(Some(&default_video_format)),
    );
    let notify: crate::job::Notify = Arc::new(move |task| {
        let _ = app.emit("task-updated", &task);
    });
    crate::job::start_job_with_media(&state.inner, &url, &media, &video_format, notify)
}

/// Relance les tâches non terminées (erreurs, annulées) en re-téléchargement
/// forcé. Les tâches **completed** sont exclues. Les actives restent inchangées.
/// Retourne le nombre de tâches relancées.
#[tauri::command]
pub fn redownload_all(state: State<'_, Arc<Manager>>, app: AppHandle) -> Result<u32, String> {
    let mut requeued: Vec<crate::models::Task> = Vec::new();
    let mut job_ids: Vec<String> = Vec::new();

    {
        let mut guard = state.inner.lock().unwrap();
        let job_keys: std::collections::HashSet<String> = guard.jobs.keys().cloned().collect();
        for t in guard.tasks.values_mut() {
            // En cours ou déjà terminés avec succès : ne pas toucher.
            if matches!(
                t.status.as_str(),
                "queued" | "downloading" | "converting" | "completed"
            ) {
                continue;
            }
            if job_keys.contains(&t.id) {
                // Jobs playlist terminés exclus ; seuls erreur / annulé.
                if t.status == "completed" {
                    continue;
                }
                job_ids.push(t.id.clone());
                continue;
            }
            t.status = "queued".into();
            t.force_redownload = true;
            t.progress = 0.0;
            t.speed_bytes = 0;
            t.speed_mbps = 0.0;
            t.eta = 0;
            t.error = None;
            t.output_path = None;
            t.skipped = false;
            requeued.push(t.clone());
        }
    }

    if !requeued.is_empty() {
        {
            let mut q = state.qsync.m.lock().unwrap();
            for t in &requeued {
                q.queue.push_back(t.id.clone());
            }
        }
        state.qsync.notify();
    }

    for job_id in &job_ids {
        let value = app.clone();
        let notify: crate::job::Notify = Arc::new(move |t| {
            let _ = value.emit("task-updated", &t);
        });
        let _ = crate::job::retry_all(&state.inner, job_id, notify);
    }

    crate::history::save(&*state.inner.lock().unwrap());

    for t in &requeued {
        let _ = app.emit("task-updated", t);
    }

    Ok((requeued.len() + job_ids.len()) as u32)
}

/// Annule un Playlist-Job (les téléchargements en cours sont tués via should_stop).
#[tauri::command]
pub fn cancel_job(
    state: State<'_, Arc<Manager>>,
    app: AppHandle,
    job_id: String,
) -> Result<(), String> {
    let notify: crate::job::Notify = Arc::new(move |task| {
        let _ = app.emit("task-updated", &task);
    });
    crate::job::cancel_job(&state.inner, &job_id, notify)
}

#[tauri::command]
pub fn retry_failed(
    state: State<'_, Arc<Manager>>,
    app: AppHandle,
    job_id: String,
) -> Result<(), String> {
    let notify: crate::job::Notify = Arc::new(move |task| {
        let _ = app.emit("task-updated", &task);
    });
    crate::job::retry_failed(&state.inner, &job_id, notify)
}

/// Indique quels titres sont déjà présents dans le dossier de sortie
/// (fichier local et/ou archive). Clé = video_id → chemin fichier.
#[tauri::command]
pub fn check_owned(
    state: State<'_, Arc<Manager>>,
    items: Vec<OwnedQuery>,
) -> HashMap<String, String> {
    let dir = state.inner.lock().unwrap().settings.output_dir.clone();
    let mut out = HashMap::new();
    for item in items {
        let id = item.id.trim();
        if id.is_empty() {
            continue;
        }
        let media = crate::settings::normalize_media(item.media.as_deref());
        if let Some(path) =
            crate::ytdlp::existing_media_for(&dir, &item.title, &media, Some(id))
        {
            out.insert(id.to_string(), path);
            continue;
        }
        // Archive seule : fichier peut avoir un titre différent.
        if crate::ytdlp::archive_has_id(&dir, id) {
            if let Some(path) = crate::ytdlp::existing_media_for(&dir, "", &media, Some(id)) {
                out.insert(id.to_string(), path);
            } else {
                out.insert(id.to_string(), format!("(archive) {id}"));
            }
        }
    }
    out
}

/// Liste les fichiers MP3/MP4 du dossier de sortie (page « Lecture »).
/// Scan non récursif. Durée MP3 via frames ; durée MP4 via ffprobe.
#[tauri::command]
pub fn list_music(state: State<'_, Arc<Manager>>) -> Vec<crate::models::MusicFile> {
    let (dir, bin_dir) = {
        let guard = state.inner.lock().unwrap();
        (guard.settings.output_dir.clone(), guard.bin_dir.clone())
    };
    let mut out = Vec::new();

    let entries = match std::fs::read_dir(&dir) {
        Ok(e) => e,
        Err(_) => return out,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();
        let kind = match ext.as_str() {
            "mp3" | "m4a" => "audio",
            "mp4" => "video",
            _ => continue,
        };
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or_default()
            .to_string();
        let lower = name.to_lowercase();
        if lower.contains(".temp.") {
            continue;
        }
        let size_bytes = entry.metadata().map(|m| m.len()).unwrap_or(0);
        let duration = if ext == "mp3" {
            mp3_duration::from_path(&path)
                .ok()
                .map(|d| d.as_secs_f64())
                .unwrap_or(0.0)
        } else {
            probe_duration(&bin_dir, &path).unwrap_or(0.0)
        };
        let cover = cached_cover(&state, &path, &bin_dir);
        out.push(crate::models::MusicFile {
            name,
            path: path.to_string_lossy().into_owned(),
            size_bytes,
            duration,
            kind: kind.into(),
            cover,
        });
    }

    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    out
}

/// Durée d'un fichier via ffprobe (secondes). Échec silencieux → `None`.
fn probe_duration(bin_dir: &std::path::Path, path: &std::path::Path) -> Option<f64> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let ffprobe = bin_dir.join("ffprobe.exe");
    if !ffprobe.is_file() {
        return None;
    }
    let out = std::process::Command::new(ffprobe)
        .args([
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            path.to_str()?,
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
    s.parse::<f64>().ok().filter(|d| d.is_finite() && *d >= 0.0)
}

/// Réordonne la file d'affichage (et la file d'attente pour les tâches encore `queued`).
#[tauri::command]
pub fn reorder_tasks(
    state: State<'_, Arc<Manager>>,
    ids: Vec<String>,
) -> Result<(), String> {
    if ids.is_empty() {
        return Ok(());
    }
    let mut guard = state.inner.lock().unwrap();
    let known: std::collections::HashSet<_> = guard.tasks.keys().cloned().collect();
    let mut new_order: Vec<String> = ids.into_iter().filter(|id| known.contains(id)).collect();
    for id in &guard.order {
        if !new_order.contains(id) {
            new_order.push(id.clone());
        }
    }
    guard.order = new_order.clone();
    {
        let mut q = state.qsync.m.lock().unwrap();
        let queued: Vec<String> = new_order
            .iter()
            .filter(|id| {
                guard
                    .tasks
                    .get(*id)
                    .map(|t| t.status == "queued")
                    .unwrap_or(false)
            })
            .cloned()
            .collect();
        q.queue = queued.into();
    }
    crate::history::save(&guard);
    Ok(())
}

/// Écrit une playlist M3U des MP3/MP4 du dossier de sortie. Retourne le chemin.
#[tauri::command]
pub fn export_m3u(state: State<'_, Arc<Manager>>) -> Result<String, String> {
    let dir = state.inner.lock().unwrap().settings.output_dir.clone();
    let out_path = std::path::Path::new(&dir).join("playlist.m3u");
    let mut lines = vec!["#EXTM3U".to_string()];
    let entries = std::fs::read_dir(&dir).map_err(|e| e.to_string())?;
    let mut files: Vec<std::path::PathBuf> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            p.is_file()
                && p.extension()
                    .and_then(|e| e.to_str())
                    .map(|e| {
                        let e = e.to_lowercase();
                        e == "mp3" || e == "m4a" || e == "mp4"
                    })
                    .unwrap_or(false)
        })
        .filter(|p| {
            let n = p
                .file_name()
                .and_then(|x| x.to_str())
                .unwrap_or("")
                .to_lowercase();
            !n.contains(".temp.")
        })
        .collect();
    files.sort_by(|a, b| {
        a.file_name()
            .unwrap_or_default()
            .to_ascii_lowercase()
            .cmp(&b.file_name().unwrap_or_default().to_ascii_lowercase())
    });
    for p in files {
        lines.push(p.to_string_lossy().into_owned());
    }
    std::fs::write(&out_path, lines.join("\n")).map_err(|e| e.to_string())?;
    Ok(out_path.to_string_lossy().into_owned())
}

/// Version de l'application (package).
#[tauri::command]
pub fn app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// Pochette d'un fichier, avec cache en mémoire indexé par (chemin, mtime).
/// Bump when cover parsing changes so stale (broken) data-URLs are discarded.
const COVER_CACHE_VER: u32 = 5;

fn cached_cover(
    state: &tauri::State<'_, Arc<crate::manager::Manager>>,
    path: &std::path::Path,
    bin_dir: &std::path::Path,
) -> Option<String> {
    let mtime = std::fs::metadata(path).and_then(|m| m.modified()).ok();
    let mut cache = state.covers.lock().unwrap();
    if let Some((ver, t, c)) = cache.get(path) {
        if *ver == COVER_CACHE_VER && mtime.as_ref().map(|x| x == t).unwrap_or(false) {
            return c.clone();
        }
    }
    let cover = extract_cover(path, Some(bin_dir));
    if let Some(t) = mtime {
        cache.insert(path.to_path_buf(), (COVER_CACHE_VER, t, cover.clone()));
    }
    cover
}

fn synchsafe32(bytes: &[u8]) -> usize {
    ((bytes[0] as usize & 0x7f) << 21)
        | ((bytes[1] as usize & 0x7f) << 14)
        | ((bytes[2] as usize & 0x7f) << 7)
        | (bytes[3] as usize & 0x7f)
}

/// Taille de frame ID3v2.3/2.4.
///
/// **Critique :** en ID3v2.3 la taille est un entier gros-boutiste classique
/// (pas synchsafe). Lire en synchsafe tronque les APIC PNG/JPEG (ex. 208190 →
/// 54974) → image sans `IEND` / incomplète à l'écran.
/// En v2.4 la taille est synchsafe ; on garde un repli BE pour les encodeurs
/// non conformes.
fn frame_len(version: u8, bytes: &[u8], remaining: usize) -> Option<usize> {
    if bytes.len() < 4 || remaining == 0 {
        return None;
    }
    let be = u32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]) as usize;
    if version == 3 {
        return (be > 0 && be <= remaining).then_some(be);
    }
    let sync = synchsafe32(bytes);
    if sync > 0 && sync <= remaining {
        // Si BE est aussi valide et plus grand, préférer BE (encodeurs flous).
        if be <= remaining && be > sync {
            return Some(be);
        }
        return Some(sync);
    }
    if be > 0 && be <= remaining {
        return Some(be);
    }
    None
}

/// Supprime l'unsynchronisation ID3 (séquence 0xFF 0x00 → 0xFF).
fn deunsync(data: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(data.len());
    let mut i = 0;
    while i < data.len() {
        out.push(data[i]);
        if data[i] == 0xFF && i + 1 < data.len() && data[i + 1] == 0x00 {
            i += 2;
        } else {
            i += 1;
        }
    }
    out
}

fn find_subslice(haystack: &[u8], needle: &[u8], from: usize) -> Option<usize> {
    if needle.is_empty() || haystack.len() < needle.len() {
        return None;
    }
    if from >= haystack.len() {
        return None;
    }
    haystack[from..]
        .windows(needle.len())
        .position(|w| w == needle)
        .map(|p| p + from)
}

/// Extrait la pochette (MP3 ID3 / M4A-MP4 covr / sidecar / frame ffmpeg) en data URL.
fn extract_cover(path: &std::path::Path, bin_dir: Option<&std::path::Path>) -> Option<String> {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let embedded = match ext.as_str() {
        "mp3" => extract_id3_cover(path),
        "m4a" | "mp4" => extract_mp4_cover(path),
        _ => None,
    };
    embedded
        .or_else(|| sidecar_cover(path))
        .or_else(|| {
            if ext == "mp4" {
                bin_dir.and_then(|b| ffmpeg_video_poster(b, path))
            } else {
                None
            }
        })
}

/// Frame JPEG via ffmpeg (repli pour MP4 sans atome covr ni sidecar).
fn ffmpeg_video_poster(bin_dir: &std::path::Path, path: &std::path::Path) -> Option<String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let ffmpeg = bin_dir.join("ffmpeg.exe");
    if !ffmpeg.is_file() {
        return None;
    }
    let out = std::process::Command::new(ffmpeg)
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-ss",
            "1",
            "-i",
            path.to_str()?,
            "-frames:v",
            "1",
            "-vf",
            "scale=480:-1",
            "-f",
            "image2pipe",
            "-vcodec",
            "mjpeg",
            "-",
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .ok()?;
    if !out.status.success() || out.stdout.len() < 24 {
        return None;
    }
    image_to_data_url(&out.stdout)
}

/// Image voisine écrite par yt-dlp (`titre.jpg` à côté du média).
fn sidecar_cover(path: &std::path::Path) -> Option<String> {
    let parent = path.parent()?;
    let stem = path.file_stem()?.to_str()?;
    for ext in ["jpg", "jpeg", "png", "webp"] {
        let candidate = parent.join(format!("{stem}.{ext}"));
        if candidate.is_file() {
            if let Some(url) = file_to_data_url(&candidate) {
                return Some(url);
            }
        }
    }
    None
}

fn file_to_data_url(path: &std::path::Path) -> Option<String> {
    let bytes = std::fs::read(path).ok()?;
    if bytes.len() < 24 {
        return None;
    }
    let mime = guess_image_mime(&bytes);
    use base64::Engine;
    Some(format!(
        "data:{mime};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}

fn image_to_data_url(image: &[u8]) -> Option<String> {
    if image.len() < 24 {
        return None;
    }
    let mime = guess_image_mime(image);
    use base64::Engine;
    Some(format!(
        "data:{mime};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(image)
    ))
}

/// Pochette MP4/M4A : atome `covr` (iTunes) — scan limité pour ne pas charger toute la vidéo.
fn extract_mp4_cover(path: &std::path::Path) -> Option<String> {
    use std::io::{Read, Seek, SeekFrom};
    let mut file = std::fs::File::open(path).ok()?;
    let len = file.metadata().ok()?.len() as usize;
    let head_n = len.min(6 * 1024 * 1024);
    let mut buf = vec![0u8; head_n];
    file.read_exact(&mut buf).ok()?;
    if let Some(url) = find_covr_in_bytes(&buf) {
        return Some(url);
    }
    if len > head_n {
        let tail_n = (2 * 1024 * 1024).min(len - head_n);
        let mut tail = vec![0u8; tail_n];
        file.seek(SeekFrom::End(-(tail_n as i64))).ok()?;
        file.read_exact(&mut tail).ok()?;
        if let Some(url) = find_covr_in_bytes(&tail) {
            return Some(url);
        }
    }
    None
}

fn find_covr_in_bytes(buf: &[u8]) -> Option<String> {
    let mut start = 0usize;
    while let Some(pos) = find_subslice(buf, b"covr", start) {
        start = pos + 4;
        let window_end = (pos + 512 * 1024).min(buf.len());
        let window = &buf[pos..window_end];
        if let Some(data_pos) = find_subslice(window, b"data", 0) {
            let payload = data_pos + 4 + 8;
            if payload < window.len() {
                if let Some(img) = trim_to_image(&window[payload..]) {
                    return image_to_data_url(img);
                }
            }
        }
        if let Some(img) = trim_to_image(window) {
            return image_to_data_url(img);
        }
    }
    None
}

fn trim_to_image(data: &[u8]) -> Option<&[u8]> {
    if let Some(i) = data.windows(3).position(|w| w == [0xFF, 0xD8, 0xFF]) {
        return Some(&data[i..]);
    }
    if let Some(i) = data.windows(4).position(|w| w == [0x89, b'P', b'N', b'G']) {
        return Some(&data[i..]);
    }
    if let Some(i) = data.windows(4).position(|w| w == *b"RIFF") {
        if i + 12 <= data.len() && &data[i + 8..i + 12] == b"WEBP" {
            return Some(&data[i..]);
        }
    }
    None
}

/// Extrait la pochette ID3v2 APIC/PIC d'un MP3.
/// Gère ID3v2.2 (PIC), v2.3 et v2.4, unsync, headers étendus, recherche aveugle.
fn extract_id3_cover(path: &std::path::Path) -> Option<String> {
    use std::io::Read;
    let mut file = std::fs::File::open(path).ok()?;
    let mut header = [0u8; 10];
    file.read_exact(&mut header).ok()?;
    if &header[0..3] != b"ID3" {
        return None;
    }
    let version = header[3];
    if !(2..=4).contains(&version) {
        return None;
    }
    let flags = header[5];
    let tag_size = synchsafe32(&header[6..10]);
    if tag_size == 0 {
        return None;
    }
    let mut tag = vec![0u8; tag_size];
    file.read_exact(&mut tag).ok()?;

    // Unsynchronisation au niveau du tag (obligatoire en v2.3, tolérée en v2.4).
    let body: &[u8];
    let unsynced: Vec<u8>;
    if flags & 0x80 != 0 {
        unsynced = deunsync(&tag);
        body = &unsynced;
    } else {
        body = &tag;
    }

    let mut off = 0usize;
    if flags & 0x40 != 0 {
        // Header étendu : v2.3 synchsafe (incluant ses 4 octets), v2.4 flou
        // (synchsafe ou gros-boutiste) — on retient la borne valide.
        if version == 3 {
            if let Some(s) = body.get(0..4).map(synchsafe32) {
                off = s;
            } else {
                return None;
            }
        } else {
            let sync = body.get(0..4).map(synchsafe32).unwrap_or(usize::MAX / 2);
            let be = u32::from_be_bytes([body[0], body[1], body[2], body[3]]) as usize;
            off = 4usize.saturating_add(sync.min(be));
        }
        if off > body.len() {
            return None;
        }
    }

    let frame_id: &[u8] = if version == 2 { b"PIC" } else { b"APIC" };
    let parse = |d: &[u8]| {
        if version == 2 {
            parse_pic22(d)
        } else {
            parse_apic(d)
        }
    };

    // 1) Balayage structuré : on garde la meilleure APIC (couverture avant > icône).
    let mut best: Option<CoverFrame> = None;

    if version == 2 {
        while off + 6 <= body.len() {
            let id = &body[off..off + 3];
            if id == [0u8; 3] {
                break;
            }
            let size =
                u32::from_be_bytes([0, body[off + 3], body[off + 4], body[off + 5]]) as usize;
            let total = 6 + size;
            if off + total > body.len() {
                break;
            }
            if id == b"PIC" {
                if let Some(f) = parse(&body[off + 6..off + total]) {
                    keep_better_cover(&mut best, f);
                }
            }
            off += total;
        }
    } else {
        while off + 10 <= body.len() {
            let id = &body[off..off + 4];
            if id == [0u8; 4] {
                break;
            }
            let Some(size) = frame_len(version, &body[off + 4..off + 8], body.len() - off - 10)
            else {
                break;
            };
            let data = &body[off + 10..off + 10 + size];
            if id == frame_id {
                let d: &[u8];
                let cleaned: Vec<u8>;
                if version == 4 {
                    let ff = u16::from_be_bytes([body[off + 8], body[off + 9]]);
                    if ff & 0x02 != 0 {
                        cleaned = deunsync(data);
                        d = &cleaned;
                    } else {
                        d = data;
                    }
                } else {
                    d = data;
                }
                if let Some(f) = parse(d) {
                    keep_better_cover(&mut best, f);
                }
            }
            off += 10 + size;
        }
    }

    // 2) Repli : recherche aveugle si aucune frame valide.
    if best.is_none() {
        let mut start = 0usize;
        while let Some(pos) = find_subslice(body, frame_id, start) {
            start = pos + frame_id.len();
            let size = if version == 2 {
                body.get(pos + 3..pos + 6)
                    .map(|s| u32::from_be_bytes([0, s[0], s[1], s[2]]) as usize)
            } else {
                body.get(pos + 4..pos + 8)
                    .and_then(|s| frame_len(version, s, body.len().saturating_sub(pos + 10)))
            };
            if let Some(size) = size {
                let header = if version == 2 { 6 } else { 10 };
                let start_data = pos + header;
                if start_data < body.len() {
                    let d = &body[start_data..(start_data + size).min(body.len())];
                    if let Some(f) = parse(d) {
                        keep_better_cover(&mut best, f);
                    }
                }
            }
        }
    }
    best.map(|f| f.data_url)
}

fn keep_better_cover(slot: &mut Option<CoverFrame>, frame: CoverFrame) {
    let better = slot
        .as_ref()
        .map(|b| cover_score(frame.pic_type) > cover_score(b.pic_type))
        .unwrap_or(true);
    if better {
        *slot = Some(frame);
    }
}

/// Résultat d'une frame APIC/PIC : type ID3 + data URL.
struct CoverFrame {
    /// Type ID3 (3 = front cover, 0 = other, 1/2 = icônes…).
    pic_type: u8,
    data_url: String,
}

/// Frame APIC (ID3v2.3/2.4) : encodage, MIME\0, **type** (1 octet), description\0, image.
fn parse_apic(data: &[u8]) -> Option<CoverFrame> {
    if data.len() < 5 {
        return None;
    }
    let encoding = data[0];
    let mime_len = data[1..].iter().position(|&b| b == 0)?;
    let mime = std::str::from_utf8(&data[1..1 + mime_len])
        .ok()?
        .to_string();
    // Après le \0 du MIME : octet type de pochette (OBLIGATOIRE, distinct de la description).
    let mut p = 1 + mime_len + 1;
    if p >= data.len() {
        return None;
    }
    let pic_type = data[p];
    p += 1;
    // Description (encodage variable) puis données de l'image.
    if encoding == 0 || encoding == 3 {
        let end = data[p..].iter().position(|&b| b == 0)?;
        p += end + 1;
    } else {
        let end = (p..data.len().saturating_sub(1)).find(|&i| data[i] == 0 && data[i + 1] == 0)?;
        p = end + 2;
    }
    if p >= data.len() {
        return None;
    }
    let image = &data[p..];
    // JPEG/PNG/WebP : rejeter les payloads trop courts (frame tronquée).
    if image.len() < 24 {
        return None;
    }
    let mime = if mime.is_empty() {
        guess_image_mime(image).to_string()
    } else {
        mime
    };
    use base64::Engine;
    Some(CoverFrame {
        pic_type,
        data_url: format!(
            "data:{mime};base64,{}",
            base64::engine::general_purpose::STANDARD.encode(image)
        ),
    })
}

/// Frame PIC (ID3v2.2) : encodage, format 3 octets, type, description, données.
fn parse_pic22(data: &[u8]) -> Option<CoverFrame> {
    if data.len() < 6 {
        return None;
    }
    let encoding = data[0];
    let fmt = std::str::from_utf8(&data[1..4]).ok()?.to_ascii_uppercase();
    let mime = match fmt.as_str() {
        "PNG" => "image/png".to_string(),
        "GIF" => "image/gif".to_string(),
        _ => "image/jpeg".to_string(),
    };
    let pic_type = data[4];
    let mut p = 5usize; // après encodage + format + type
    if encoding == 0 || encoding == 3 {
        let end = data[p..].iter().position(|&b| b == 0)?;
        p += end + 1;
    } else {
        let end = (p..data.len().saturating_sub(1)).find(|&i| data[i] == 0 && data[i + 1] == 0)?;
        p = end + 2;
    }
    if p >= data.len() {
        return None;
    }
    let image = &data[p..];
    if image.len() < 24 {
        return None;
    }
    use base64::Engine;
    Some(CoverFrame {
        pic_type,
        data_url: format!(
            "data:{mime};base64,{}",
            base64::engine::general_purpose::STANDARD.encode(image)
        ),
    })
}

fn guess_image_mime(image: &[u8]) -> &'static str {
    if image.starts_with(&[0x89, b'P', b'N', b'G']) {
        "image/png"
    } else if image.len() > 12 && &image[0..4] == b"RIFF" && &image[8..12] == b"WEBP" {
        "image/webp"
    } else if image.starts_with(b"GIF8") {
        "image/gif"
    } else {
        "image/jpeg"
    }
}

/// Score pour choisir la meilleure APIC : couverture avant > autre > icônes.
fn cover_score(pic_type: u8) -> i32 {
    match pic_type {
        3 => 100, // Front cover
        0 => 50,  // Other
        4 => 40,  // Back cover
        1 | 2 => 1, // Icons (trop petites)
        _ => 20,
    }
}

#[cfg(test)]
mod cover_tests {
    use super::*;

    /// Construit un payload APIC minimal : JPEG FF D8 … FF D9.
    fn apic_payload(pic_type: u8, desc: &[u8], jpeg: &[u8]) -> Vec<u8> {
        let mut v = Vec::new();
        v.push(0); // latin-1
        v.extend_from_slice(b"image/jpeg");
        v.push(0);
        v.push(pic_type);
        v.extend_from_slice(desc);
        v.push(0);
        v.extend_from_slice(jpeg);
        v
    }

    #[test]
    fn parse_apic_ne_mange_pas_le_type_de_pochette() {
        // JPEG minimal valide (signature + padding).
        let mut jpeg = vec![0xFFu8, 0xD8, 0xFF, 0xD9];
        jpeg.resize(32, 0x00);
        // Type 0 (= Other) : l'ancien parseur prenait ce 0 pour la fin de description
        // et tronquait / décalait l'image.
        let raw = apic_payload(0, b"", &jpeg);
        let frame = parse_apic(&raw).expect("APIC type 0");
        assert_eq!(frame.pic_type, 0);
        assert!(frame.data_url.contains("image/jpeg"));
        // La data URL doit contenir le JPEG complet (base64 de 32 octets).
        let b64 = frame.data_url.split(',').nth(1).unwrap();
        use base64::Engine;
        let decoded = base64::engine::general_purpose::STANDARD
            .decode(b64)
            .unwrap();
        assert_eq!(decoded, jpeg);

        let raw3 = apic_payload(3, b"cover", &jpeg);
        let front = parse_apic(&raw3).expect("APIC type 3");
        assert_eq!(front.pic_type, 3);
        assert!(cover_score(3) > cover_score(1));
    }

    #[test]
    fn frame_len_v23_ne_tronque_pas_apic_png() {
        // Cas réel (Mghayer) : octets taille = 00 03 2D 3E → BE 208190.
        // Synchsafe des mêmes octets → ~55000 → PNG sans IEND (image coupée).
        let bytes = [0x00u8, 0x03, 0x2D, 0x3E];
        let remaining = 300_000usize;
        let be = u32::from_be_bytes(bytes) as usize;
        let sync = synchsafe32(&bytes);
        assert_eq!(be, 208_190);
        assert!(sync < be, "sync={sync} be={be}");
        assert_eq!(frame_len(3, &bytes, remaining), Some(be));
        // v2.4 : si BE valide et plus grand, on le préfère (encodeurs flous).
        assert_eq!(frame_len(4, &bytes, remaining), Some(be));
    }

    #[test]
    fn parse_covr_jpeg_dans_atome_mp4() {
        let mut jpeg = vec![0xFFu8, 0xD8, 0xFF, 0xD9];
        jpeg.resize(40, 0xAA);
        let mut atom = Vec::new();
        atom.extend_from_slice(b"covr");
        atom.extend_from_slice(b"data");
        atom.extend_from_slice(&[0, 0, 0, 13]); // type jpeg
        atom.extend_from_slice(&[0, 0, 0, 0]); // locale
        atom.extend_from_slice(&jpeg);
        let url = find_covr_in_bytes(&atom).expect("covr");
        assert!(url.starts_with("data:image/jpeg;base64,"));
    }

    #[test]
    fn extract_covers_from_music_dir() {
        let dir = {
            let from_env = std::env::var("USERPROFILE")
                .ok()
                .map(|p| std::path::PathBuf::from(p).join("Music").join("YT-Music-Downloader"));
            from_env
                .filter(|p| p.is_dir())
                .unwrap_or_else(|| {
                    std::path::PathBuf::from(r"C:\Users\Moha\Music\YT-Music-Downloader")
                })
        };
        if !dir.is_dir() {
            return; // Machine sans ce dossier : test neutre.
        }
        let mut total = 0usize;
        let mut ok = 0usize;
        let mut failed = Vec::new();
        for e in std::fs::read_dir(&dir).unwrap().flatten() {
            let path = e.path();
            let ext = path
                .extension()
                .and_then(|x| x.to_str())
                .unwrap_or("")
                .to_ascii_lowercase();
            if ext != "mp3" && ext != "m4a" {
                continue;
            }
            let name = path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_ascii_lowercase();
            if name.ends_with(".temp.mp3") {
                continue;
            }
            total += 1;
            match extract_cover(&path, None) {
                Some(data) if data.starts_with("data:") => {
                    // PNG complet doit contenir IEND en base64 décodé.
                    if let Some(b64) = data.split(',').nth(1) {
                        use base64::Engine;
                        if let Ok(bytes) =
                            base64::engine::general_purpose::STANDARD.decode(b64)
                        {
                            if bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
                                assert!(
                                    bytes.windows(4).any(|w| w == b"IEND"),
                                    "PNG tronqué (pas de IEND) dans {}",
                                    path.display()
                                );
                            }
                        }
                    }
                    ok += 1;
                }
                _ => failed.push(
                    path.file_name()
                        .unwrap_or_default()
                        .to_string_lossy()
                        .into_owned(),
                ),
            }
        }
        println!("covers ok {ok}/{total}");
        for f in &failed {
            println!("FAIL {f}");
        }
        assert_eq!(ok, total, "some covers failed: {failed:?}");
    }
} // build: player-bar responsive + covers corrosion.
