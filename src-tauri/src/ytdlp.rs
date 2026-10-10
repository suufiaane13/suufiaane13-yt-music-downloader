use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, SystemTime};

use serde::{Deserialize, Serialize};

use crate::paths;

/// Une seule analyse playlist lourde à la fois (évite 2× `-J` en parallèle).
static ANALYZE_LOCK: Mutex<()> = Mutex::new(());

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Vrai pendant une mise à jour de yt-dlp (`-U`) : les commandes qui spawnent
/// yt-dlp.exe attendent la fin pour éviter de lancer le binaire pendant son
/// remplacement sur le disque.
static UPDATE_IN_PROGRESS: AtomicBool = AtomicBool::new(false);

/// Attend la fin d'une éventuelle mise à jour de yt-dlp en cours (max 10 s).
pub fn wait_update() {
    let start = std::time::Instant::now();
    let mut waited = 0u32;
    while UPDATE_IN_PROGRESS.load(Ordering::Relaxed) {
        if waited >= 200 {
            crate::debuglog::log(format!(
                "wait_update -> abandonné après {} ms (mise à jour encore en cours)",
                start.elapsed().as_millis()
            ));
            break;
        }
        std::thread::sleep(Duration::from_millis(50));
        waited += 1;
    }
    if waited > 0 {
        crate::debuglog::log(format!(
            "wait_update -> a attendu {} ms",
            start.elapsed().as_millis()
        ));
    }
}

/// Construit une Command sans fenetre console (important : yt-dlp/ffmpeg
/// sont des executables console).
pub fn raw_command(bin: &PathBuf) -> Command {
    let mut cmd = Command::new(paths::ytdlp(bin));
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
}

fn player_args() -> Vec<String> {
    vec![
        "--extractor-args".to_string(),
        "youtube:player_client=android,ios,tv".to_string(),
    ]
}

fn js_runtime_args(bin: &PathBuf) -> Vec<String> {
    let deno = paths::deno(bin);
    if deno.is_file() {
        vec![
            "--js-runtimes".to_string(),
            format!("deno:{}", deno.to_string_lossy()),
        ]
    } else {
        Vec::new()
    }
}

fn base_args(bin: &PathBuf) -> Vec<String> {
    let mut args = player_args();
    args.extend(js_runtime_args(bin));
    args.extend(vec![
        "--no-warnings".to_string(),
        "--ffmpeg-location".to_string(),
        bin.to_string_lossy().into_owned(),
    ]);
    args
}

/// L'analyse et l'audio conservent le client historique utilisé par
/// l'application. Pour la vidéo, on laisse yt-dlp choisir ses clients : les
/// clients android/ios/tv ne propose pas toujours les flux HD nécessaires au
/// merge MP4.
fn download_base_args(bin: &PathBuf, media: &str) -> Vec<String> {
    if media == "video" {
        let mut args = js_runtime_args(bin);
        args.extend(vec![
            "--no-warnings".to_string(),
            "--ffmpeg-location".to_string(),
            bin.to_string_lossy().into_owned(),
        ]);
        args
    } else {
        base_args(bin)
    }
}

/// Extrait l'id YouTube d'une URL (watch, youtu.be, shorts) ou d'un id brut.
pub fn extract_video_id(url_or_id: &str) -> Option<String> {
    let s = url_or_id.trim();
    if s.is_empty() {
        return None;
    }
    if !s.contains("://") && !s.contains('/') && s.len() >= 6 && s.len() <= 20 {
        return Some(s.to_string());
    }
    if let Some(rest) = s.strip_prefix("https://youtu.be/") {
        let id = rest.split(['?', '&', '/']).next().unwrap_or("");
        if !id.is_empty() {
            return Some(id.to_string());
        }
    }
    if let Some(rest) = s.strip_prefix("http://youtu.be/") {
        let id = rest.split(['?', '&', '/']).next().unwrap_or("");
        if !id.is_empty() {
            return Some(id.to_string());
        }
    }
    for marker in ["v=", "/shorts/", "/embed/", "/live/"] {
        if let Some(pos) = s.find(marker) {
            let start = pos + marker.len();
            let id = s[start..].split(['?', '&', '/', '#']).next().unwrap_or("");
            if !id.is_empty() {
                return Some(id.to_string());
            }
        }
    }
    None
}

pub fn archive_path(output_dir: &str) -> PathBuf {
    PathBuf::from(output_dir).join(".ytmd-archive.txt")
}

/// Messages d'erreur stables et compréhensibles (UI FR).
pub fn humanize_error(raw: &str) -> String {
    let lower = raw.to_lowercase();
    if lower.contains("private video") || lower.contains("login required") {
        return "Vidéo privée ou connexion requise.".into();
    }
    if lower.contains("video unavailable") || lower.contains("has been removed") {
        return "Vidéo indisponible ou supprimée.".into();
    }
    if lower.contains("429") || lower.contains("too many requests") {
        return "Trop de requêtes YouTube — nouvel essai automatique…".into();
    }
    if lower.contains("timed out") || lower.contains("timeout") || lower.contains("temporarily") {
        return "Délai dépassé — nouvel essai…".into();
    }
    if lower.contains("sign in to confirm")
        || lower.contains("confirm you’re not a bot")
        || lower.contains("confirm you're not a bot")
    {
        return "YouTube demande une vérification anti-bot.".into();
    }
    if lower.contains("requested format is not available") || lower.contains("no video formats") {
        return "Format audio/vidéo introuvable pour ce média.".into();
    }
    if lower.contains("ffmpeg") && (lower.contains("error") || lower.contains("failed")) {
        return "Échec de la conversion ffmpeg.".into();
    }
    let trimmed: String = raw.chars().take(280).collect();
    if trimmed.trim().is_empty() {
        "Le téléchargement a échoué.".into()
    } else {
        trimmed
    }
}

pub fn is_retryable_error(msg: &str) -> bool {
    let lower = msg.to_lowercase();
    lower.contains("429")
        || lower.contains("too many requests")
        || lower.contains("timed out")
        || lower.contains("timeout")
        || lower.contains("temporarily")
        || lower.contains("connection reset")
        || lower.contains("unable to download")
        || lower.contains("http error 5")
        || lower.contains("network is unreachable")
        || lower.contains("ssl")
        || lower.contains("eof")
}

// ---------------------------------------------------------------------------
// Analyse (meta only, extraction plate -> instantanee)
// ---------------------------------------------------------------------------

#[derive(Deserialize, Default)]
struct EntryJson {
    #[serde(default)]
    id: String,
    #[serde(default)]
    title: String,
    #[serde(default)]
    duration: Option<f64>,
    #[serde(default)]
    url: Option<String>,
    #[serde(default)]
    thumbnail: Option<String>,
}

#[derive(Deserialize, Default)]
struct InfoJson {
    #[serde(default)]
    id: String,
    #[serde(default)]
    title: String,
    #[serde(default)]
    uploader: String,
    #[serde(default)]
    duration: Option<f64>,
    #[serde(default)]
    thumbnail: Option<String>,
    #[serde(default)]
    webpage_url: Option<String>,
    #[serde(default)]
    entries: Option<Vec<EntryJson>>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct VideoEntry {
    pub id: String,
    pub title: String,
    pub duration: Option<f64>,
    pub url: String,
    pub thumbnail: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct VideoInfo {
    #[serde(rename = "type")]
    pub kind: String,
    pub id: String,
    pub title: String,
    pub uploader: String,
    pub duration: Option<f64>,
    pub thumbnail: Option<String>,
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entries: Option<Vec<VideoEntry>>,
}

/// Arguments d'analyse (meta seulement, extraction plate -> force rapide).
fn analyze_args(bin: &PathBuf, url: &str, max_entries: Option<u32>) -> Vec<String> {
    let mut args: Vec<String> = vec!["-J".to_string(), "--flat-playlist".to_string()];
    if let Some(n) = max_entries {
        args.push("--playlist-end".to_string());
        args.push(n.to_string());
    }
    args.extend(base_args(bin));
    args.push(url.to_string());
    args
}

/// Parse la sortie JSON de yt-dlp (`-J`) en `VideoInfo`.
fn json_to_info(raw: &[u8], url: &str) -> Result<VideoInfo, String> {
    let info: InfoJson =
        serde_json::from_slice(raw).map_err(|e| format!("Erreur de decodage JSON: {e}"))?;

    if let Some(entries) = info.entries {
        let list: Vec<VideoEntry> = entries
            .into_iter()
            .filter(|e| !e.id.is_empty())
            .map(|e| {
                let id = e.id.clone();
                let raw_url = e.url.unwrap_or_default();
                let url = if raw_url.is_empty() || !raw_url.starts_with("http") {
                    format!("https://www.youtube.com/watch?v={id}")
                } else {
                    raw_url
                };
                let thumbnail =
                    if e.thumbnail.is_some() && !e.thumbnail.as_deref().unwrap_or("").is_empty() {
                        e.thumbnail.unwrap()
                    } else {
                        format!("https://i.ytimg.com/vi/{id}/hqdefault.jpg")
                    };
                VideoEntry {
                    id,
                    title: e.title,
                    duration: e.duration,
                    url,
                    thumbnail,
                }
            })
            .collect();

        // Dédoublonnage : certaines playlists (mix, rediffusions, radios)
        // listent la même vidéo plusieurs fois. On garde la première
        // occurrence et on préserve l'ordre d'origine.
        let mut seen = std::collections::HashSet::with_capacity(list.len());
        let list: Vec<VideoEntry> = list
            .into_iter()
            .filter(|e| seen.insert(e.id.clone()))
            .collect();

        Ok(VideoInfo {
            kind: "playlist".into(),
            id: info.id,
            title: if info.title.is_empty() {
                "Playlist".into()
            } else {
                info.title
            },
            uploader: info.uploader,
            duration: None,
            thumbnail: None,
            url: Some(url.to_string()),
            entries: Some(list),
        })
    } else {
        Ok(VideoInfo {
            kind: "video".into(),
            id: info.id,
            title: info.title,
            uploader: info.uploader,
            duration: info.duration,
            thumbnail: info.thumbnail,
            url: Some(info.webpage_url.unwrap_or_else(|| url.to_string())),
            entries: None,
        })
    }
}

pub fn analyze(bin: &PathBuf, url: &str, max_entries: Option<u32>) -> Result<VideoInfo, String> {
    let _lock = ANALYZE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    wait_update();
    let mut cmd = raw_command(bin);
    cmd.args(analyze_args(bin, url, max_entries))
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let out = cmd.output().map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(humanize_error(String::from_utf8_lossy(&out.stderr).trim()));
    }

    json_to_info(&out.stdout, url)
}

/// Analyse annulable : le process yt-dlp est tué si `should_stop` devient vrai
/// (ex. annulation d'un Playlist-Job pendant la résolution). Utilisée par le
/// moteur de job pour ne pas laisser une résolution de plusieurs dizaines de
/// secondes tourner en arrière-plan après une annulation.
pub fn analyze_cancelable<F>(
    bin: &PathBuf,
    url: &str,
    max_entries: Option<u32>,
    mut should_stop: F,
) -> Result<VideoInfo, String>
where
    F: FnMut() -> bool + Send + 'static,
{
    let _lock = ANALYZE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    wait_update();
    let mut cmd = raw_command(bin);
    cmd.args(analyze_args(bin, url, max_entries))
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => return Err(e.to_string()),
    };

    let mut stdout = child.stdout.take();
    let mut stderr = child.stderr.take();
    let mut out_done = stdout.is_none();
    let mut err_done = stderr.is_none();

    let (tx, rx) = std::sync::mpsc::channel::<MsgAnalysis>();

    let stdout_handle = {
        let tx = tx.clone();
        std::thread::spawn(move || {
            if let Some(r) = stdout.take() {
                let buf = BufReader::new(r);
                for line in buf.lines().map_while(Result::ok) {
                    if tx.send(MsgAnalysis::StdoutLine(line)).is_err() {
                        break;
                    }
                }
            }
            let _ = tx.send(MsgAnalysis::StdoutDone);
        })
    };
    let stderr_handle = {
        let tx = tx.clone();
        std::thread::spawn(move || {
            if let Some(r) = stderr.take() {
                let buf = BufReader::new(r);
                for line in buf.lines().map_while(Result::ok) {
                    if tx.send(MsgAnalysis::StderrLine(line)).is_err() {
                        break;
                    }
                }
            }
            let _ = tx.send(MsgAnalysis::StderrDone);
        })
    };

    let mut stdout_buf = String::new();
    let mut stderr_tail: Vec<String> = Vec::new();
    let mut cancelled = false;

    loop {
        if should_stop() {
            cancelled = true;
            kill_tree(&mut child);
        }
        if out_done && err_done {
            break;
        }
        match rx.recv_timeout(std::time::Duration::from_millis(200)) {
            Ok(MsgAnalysis::StdoutLine(l)) => stdout_buf.push_str(&l),
            Ok(MsgAnalysis::StderrLine(l)) => {
                stderr_tail.push(l);
                if stderr_tail.len() > 200 {
                    stderr_tail.remove(0);
                }
            }
            Ok(MsgAnalysis::StdoutDone) => out_done = true,
            Ok(MsgAnalysis::StderrDone) => err_done = true,
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => continue,
        }
    }

    let _ = stdout_handle.join().ok();
    let _ = stderr_handle.join().ok();

    let status = child.wait();
    if cancelled {
        return Err("Annulé".to_string());
    }

    if let Ok(st) = status {
        if st.success() {
            return json_to_info(stdout_buf.as_bytes(), url);
        }
    }

    let msg = stderr_tail
        .last()
        .cloned()
        .filter(|l| !l.trim().is_empty())
        .unwrap_or_else(|| "L'analyse de la playlist a échoué.".to_string())
        .chars()
        .take(300)
        .collect();
    Err(msg)
}

enum MsgAnalysis {
    StdoutLine(String),
    StderrLine(String),
    StdoutDone,
    StderrDone,
}

// ---------------------------------------------------------------------------
// Telechargement
// ---------------------------------------------------------------------------

#[derive(Clone, Debug)]
pub struct Progress {
    pub pct: f64,
    pub downloaded: u64,
    pub total: u64,
    pub speed: u64,
    pub eta: u64,
}

pub fn parse_progress_line(line: &str) -> Option<Progress> {
    let trimmed = line.trim();
    if !(trimmed.starts_with('[') && trimmed.ends_with(']')) {
        return None;
    }
    let inner = &trimmed[1..trimmed.len() - 1];
    let parts: Vec<&str> = inner.split('|').collect();
    if parts.len() < 5 {
        return None;
    }
    // `%(progress.percentage)s` est parfois "NA" (fragments) : on le calcule
    // depuis les octets. `%(progress.speed)s` est un flottant brut.
    let raw_pct = parts[0].parse::<f64>().unwrap_or(f64::NAN);
    let downloaded = parts[1].parse::<u64>().unwrap_or(0);
    let total = parts[2].parse::<u64>().unwrap_or(0);
    let speed = parts[3].parse::<f64>().unwrap_or(0.0).max(0.0) as u64;
    let eta = parts[4].parse::<u64>().unwrap_or(0);
    let pct = if raw_pct.is_finite() && raw_pct > 0.0 {
        raw_pct
    } else if total > 0 {
        (downloaded as f64 / total as f64) * 100.0
    } else {
        0.0
    };
    Some(Progress {
        pct,
        downloaded,
        total,
        speed,
        eta,
    })
}

pub struct DownloadOpts<'a> {
    pub output_dir: &'a str,
    pub audio_format: &'a str,
    pub quality: &'a str,
    /// `audio` produit un MP3/M4A ; `video` produit un MP4.
    pub media: &'a str,
    /// Hauteur maximale vidéo (`best`, `1080`, `720`, `480`).
    pub video_format: &'a str,
    pub embed_thumbnail: bool,
    pub embed_metadata: bool,
    /// Titre attendu : skip local si le fichier existe déjà.
    pub expected_title: Option<&'a str>,
    /// Force le re-téléchargement (ignore archive + fichiers existants).
    pub force: bool,
    pub video_id: Option<&'a str>,
    /// `fast` | `balanced` | `quality`
    pub profile: &'a str,
    pub use_archive: bool,
    pub auto_retry: bool,
    pub max_concurrent: u32,
}

/// Comportement effectif dérivé du profil (+ overrides utilisateur).
struct ProfileFx {
    keep_m4a: bool,
    embed_metadata: bool,
    audio_fragments: &'static str,
    video_fragments: &'static str,
    audio_chunk: &'static str,
    video_chunk: &'static str,
    ffmpeg_audio_threads: u32,
}

fn profile_fx(opts: &DownloadOpts<'_>) -> ProfileFx {
    let conc = opts.max_concurrent.max(1);
    match opts.profile {
        "fast" => ProfileFx {
            keep_m4a: true,
            embed_metadata: false,
            audio_fragments: "16",
            video_fragments: "8",
            audio_chunk: "10M",
            video_chunk: "8M",
            ffmpeg_audio_threads: 1,
        },
        "quality" => ProfileFx {
            keep_m4a: false,
            embed_metadata: opts.embed_metadata,
            audio_fragments: "8",
            video_fragments: "4",
            audio_chunk: "5M",
            video_chunk: "5M",
            ffmpeg_audio_threads: if conc >= 6 { 1 } else { 2 },
        },
        _ => ProfileFx {
            keep_m4a: false,
            embed_metadata: opts.embed_metadata,
            audio_fragments: "16",
            video_fragments: "4",
            audio_chunk: "10M",
            video_chunk: "5M",
            ffmpeg_audio_threads: if conc >= 6 { 1 } else { 2 },
        },
    }
}

fn output_template(output_dir: &str) -> String {
    // Id YouTube dans le nom : unicité + idempotence fiable.
    format!(
        "{dir}/%(title).80B [%(id)s].%(ext)s",
        dir = output_dir.trim_end_matches(['/', '\\'])
    )
}

pub fn download_args(bin: &PathBuf, opts: &DownloadOpts, url: &str) -> Vec<String> {
    let is_video = opts.media == "video";
    let fx = profile_fx(opts);
    let mut args: Vec<String> = vec![
        "--progress".to_string(),
        "--newline".to_string(),
        "--quiet".to_string(),
        "--retries".to_string(),
        "3".to_string(),
        "--fragment-retries".to_string(),
        "3".to_string(),
        "--socket-timeout".to_string(),
        "30".to_string(),
        "--concurrent-fragments".to_string(),
        if is_video {
            fx.video_fragments
        } else {
            fx.audio_fragments
        }
        .to_string(),
        "--http-chunk-size".to_string(),
        if is_video {
            fx.video_chunk
        } else {
            fx.audio_chunk
        }
        .to_string(),
        "--format".to_string(),
    ];

    if is_video {
        let height = match opts.video_format {
            "1080" => "[height<=1080]",
            "720" => "[height<=720]",
            "480" => "[height<=480]",
            _ => "",
        };
        let selector = if height.is_empty() {
            "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b".to_string()
        } else {
            format!("bv*{height}[ext=mp4]+ba[ext=m4a]/b{height}[ext=mp4]/b{height}")
        };
        args.push(selector);
        args.push("--output".to_string());
        args.push(output_template(opts.output_dir));
        args.push("--merge-output-format".to_string());
        args.push("mp4".to_string());
        args.push("--remux-video".to_string());
        args.push("mp4".to_string());
        args.push("--postprocessor-args".to_string());
        args.push("Merger:-threads 1".to_string());
    } else if fx.keep_m4a {
        // Profil rapide : pas de ré-encodage MP3 (gros gain CPU).
        args.push(if opts.quality == "worst" {
            "worstaudio/worst".into()
        } else {
            "bestaudio[ext=m4a]/bestaudio/best".into()
        });
        args.push("--output".to_string());
        args.push(output_template(opts.output_dir));
    } else {
        let mkbps = match opts.audio_format {
            "128" => "128K",
            "192" => "192K",
            "256" => "256K",
            _ => "320K",
        };
        args.push(if opts.quality == "worst" {
            "worstaudio/worst".into()
        } else {
            "bestaudio[ext=m4a]/bestaudio/best".into()
        });
        args.push("--output".to_string());
        args.push(output_template(opts.output_dir));
        args.push("--extract-audio".to_string());
        args.push("--audio-format".to_string());
        args.push("mp3".to_string());
        args.push("--audio-quality".to_string());
        args.push(mkbps.to_string());
        args.push("--postprocessor-args".to_string());
        args.push(format!(
            "FFmpegExtractAudio:-threads {}",
            fx.ffmpeg_audio_threads
        ));
    }

    // Pochette : simple conversion JPG + embed (pas de crop -> aucun filtre
    // ffmpeg requis, évite "filter not found" sur certains builds).
    args.push("--convert-thumbnails".into());
    args.push("jpg".into());
    args.push("--postprocessor-args".into());
    args.push("ThumbnailsConvertor+ffmpeg_o:-c:v mjpeg".into());
    if is_video {
        args.push("--write-thumbnail".into());
        args.push("--embed-thumbnail".into());
    } else {
        args.push("--embed-thumbnail".into());
    }
    if fx.embed_metadata {
        args.push("--embed-metadata".into());
    }
    if opts.use_archive && !opts.force {
        args.push("--download-archive".into());
        args.push(archive_path(opts.output_dir).to_string_lossy().into_owned());
        args.push("--no-overwrites".into());
    }
    args.push("--no-playlist".into());
    args.push("--progress-template".into());
    args.push(
        "download:[%(progress.percentage)s|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.speed)s|%(progress.eta)s]"
            .into(),
    );
    args.push("--print".into());
    args.push("after_move:filepath".into());
    args.extend(download_base_args(bin, opts.media));
    args.push(url.to_string());
    args
}

/// Nettoie un nom de fichier (reprend le comportement Python).
/// Vérifie que le fichier d'entrée est valide avant post-traitement.
/// Utilise ffprobe pour détecter un fichier corrompu / tronqué.
/// Retourne true si le fichier est lisible ; false sinon (avec log).
pub fn validate_file_before_postprocess(bin_dir: &PathBuf, file_path: &str) -> bool {
    if file_path.is_empty() {
        return true;
    }
    let p = std::path::Path::new(file_path);
    if !p.exists() || p.metadata().map(|m| m.len()).unwrap_or(0) == 0 {
        crate::debuglog::log(format!("validate -> fichier manquant ou vide : {}", file_path));
        return false;
    }
    let ffprobe = bin_dir.join("ffprobe.exe");
    if !ffprobe.is_file() {
        return true;
    }
    let mut cmd = Command::new(ffprobe);
    cmd.args(["-v", "error", "-show_format", "-show_streams", "-print_format", "json", file_path]);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
    match cmd.output() {
        Ok(out) => {
            let ok = out.status.success() && out.stdout.len() > 10;
            if !ok {
                crate::debuglog::log(format!("validate -> ffprobe échec pour {} ({} octets stdout, status={:?})", file_path, out.stdout.len(), out.status));
            } else {
                crate::debuglog::log(format!("validate -> OK : {}", file_path));
            }
            ok
        }
        Err(e) => {
            crate::debuglog::log(format!("validate -> erreur ffprobe : {}", e));
            true
        }
    }
}

pub fn sanitize_filename(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .filter(|c| !matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'))
        .collect();
    let cleaned = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    let trimmed = cleaned.trim();
    if trimmed.is_empty() {
        "untitled".to_string()
    } else {
        trimmed.chars().take(200).collect()
    }
}

/// Cherche un média déjà téléchargé (titre classique ou `Titre [id].ext`).
pub fn existing_media_for(
    output_dir: &str,
    expected: &str,
    media: &str,
    video_id: Option<&str>,
) -> Option<String> {
    let name = sanitize_filename(expected);
    const AUDIO_EXTS: &[&str] = &["mp3", "m4a", "webm", "opus", "ogg", "flac", "wav", "aac"];
    const VIDEO_EXTS: &[&str] = &["mp4", "m4v", "mkv", "webm", "mov", "avi"];
    let exts = if media == "video" {
        VIDEO_EXTS
    } else {
        AUDIO_EXTS
    };
    if name != "untitled" {
        for ext in exts {
            let p = std::path::Path::new(output_dir).join(format!("{name}.{ext}"));
            if p.is_file() {
                return Some(p.to_string_lossy().into_owned());
            }
            if let Some(id) = video_id {
                let p2 = std::path::Path::new(output_dir).join(format!("{name} [{id}].{ext}"));
                if p2.is_file() {
                    return Some(p2.to_string_lossy().into_owned());
                }
            }
        }
    }
    // Scan léger par id si le titre a changé côté YouTube.
    if let Some(id) = video_id.filter(|s| !s.is_empty()) {
        let needle = format!("[{id}].");
        if let Ok(rd) = std::fs::read_dir(output_dir) {
            for e in rd.flatten() {
                let p = e.path();
                if !p.is_file() {
                    continue;
                }
                let fname = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
                let ext = p
                    .extension()
                    .and_then(|x| x.to_str())
                    .unwrap_or("")
                    .to_lowercase();
                if fname.contains(&needle) && exts.iter().any(|x| *x == ext) {
                    return Some(p.to_string_lossy().into_owned());
                }
            }
        }
    }
    None
}

pub fn archive_has_id(output_dir: &str, video_id: &str) -> bool {
    let path = archive_path(output_dir);
    let Ok(raw) = std::fs::read_to_string(path) else {
        return false;
    };
    let needle = format!("youtube {video_id}");
    raw.lines()
        .any(|l| l.trim() == needle || l.contains(&needle))
}

/// Lit les lignes d'une sortie (drain du pipe pour eviter blocage).
pub fn spawn_reader<R: std::io::Read + Send + 'static>(
    reader: Option<R>,
    mut on_line: impl FnMut(String) + Send + 'static,
    mut on_done: impl FnMut() + Send + 'static,
) {
    match reader {
        Some(r) => {
            std::thread::spawn(move || {
                let buf = BufReader::new(r);
                for line in buf.lines().map_while(Result::ok) {
                    on_line(line);
                }
                on_done();
            });
        }
        None => on_done(),
    }
}

/// Tue le processus enfant ET son arbre (sur Windows : `taskkill /T`).
/// yt-dlp lance ffmpeg pour la conversion : un simple `kill()` laisserait le
/// processeur de sortie tourner encore quelques secondes.
pub fn kill_tree(child: &mut std::process::Child) {
    #[cfg(windows)]
    {
        let pid = child.id();
        let _ = Command::new("taskkill")
            .args(["/F", "/T", "/PID", &pid.to_string()])
            .creation_flags(CREATE_NO_WINDOW)
            .output();
        return;
    }
    #[cfg(not(windows))]
    let _ = child.kill();
}

/// Supprime les fichiers partiels (`*.part`, `*.ytdl`, `*.temp`) d'un
/// téléchargement annulé afin de ne pas laisser de déchets dans le dossier de
/// sortie. N'affecte que les fichiers créés après `started` (et, si un titre
/// attendu est connu, ne touche que les noms correspondants).
pub fn cleanup_partials(output_dir: &str, expected: Option<&str>, started: SystemTime) {
    let base = expected
        .filter(|s| !s.trim().is_empty())
        .map(sanitize_filename);
    let dir = std::path::Path::new(output_dir);
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for e in entries.flatten() {
        let path = e.path();
        let Ok(meta) = e.metadata() else {
            continue;
        };
        if !meta.is_file() {
            continue;
        }
        let Ok(mtime) = meta.modified() else {
            continue;
        };
        if mtime < started {
            continue;
        }
        let ext = path
            .extension()
            .map(|x| x.to_string_lossy().to_lowercase())
            .unwrap_or_default();
        if !matches!(ext.as_str(), "part" | "ytdl" | "temp") {
            continue;
        }
        let remove = match &base {
            Some(b) => path
                .file_name()
                .map(|n| {
                    let name = n.to_string_lossy();
                    name.contains(b.as_str())
                })
                .unwrap_or(false),
            None => true,
        };
        if remove {
            let _ = std::fs::remove_file(&path);
        }
    }
}

// ---------------------------------------------------------------------------
// Telechargement d'un seul morceau (partage entre tache simple et Playlist-Job)
// ---------------------------------------------------------------------------

/// Erreur de telechargement. `cancelled` distingue une annulation volontaire.
#[derive(Debug)]
pub struct TrackError {
    pub message: String,
    pub cancelled: bool,
}

/// Resultat d'un téléchargement : chemin du fichier final + indicateur de
/// saut (fichier déjà présent, idempotence).
#[derive(Debug)]
pub struct DownloadOutcome {
    pub path: String,
    pub skipped: bool,
}

impl TrackError {
    fn cancelled() -> Self {
        Self {
            message: "Annulé".into(),
            cancelled: true,
        }
    }

    fn failed(msg: String) -> Self {
        Self {
            message: msg,
            cancelled: false,
        }
    }
}

/// Retrouve le fichier média le plus récent créé après `started` dans
/// `output_dir`. Le repli sans date permet de récupérer le chemin lorsque le
/// système de fichiers ne met pas le mtime à jour précisément.
pub fn find_newest_media(output_dir: &str, started: SystemTime, media: &str) -> Option<String> {
    fn newest_in(output_dir: &str, started: Option<SystemTime>, media: &str) -> Option<String> {
        let dir = std::path::Path::new(output_dir);
        let entries = std::fs::read_dir(dir).ok()?;
        let video = media == "video";
        let mut best: Option<(SystemTime, String)> = None;
        for e in entries.flatten() {
            let path = e.path();
            let ext = path
                .extension()
                .map(|x| x.to_string_lossy().to_lowercase())
                .unwrap_or_default();
            let allowed = if video {
                matches!(ext.as_str(), "mp4" | "m4v" | "mkv" | "webm" | "mov" | "avi")
            } else {
                matches!(
                    ext.as_str(),
                    "mp3" | "m4a" | "webm" | "opus" | "ogg" | "flac" | "wav" | "aac"
                )
            };
            if !allowed {
                continue;
            }
            let mtime = match e.metadata().and_then(|m| m.modified()) {
                Ok(m) => m,
                Err(_) => continue,
            };
            if let Some(s) = started {
                if mtime < s {
                    continue;
                }
            }
            let is_newer = match &best {
                Some((b, _)) => mtime > *b,
                None => true,
            };
            if is_newer {
                best = Some((mtime, path.to_string_lossy().into_owned()));
            }
        }
        best.map(|(_, p)| p)
    }

    newest_in(output_dir, Some(started), media).or_else(|| newest_in(output_dir, None, media))
}

/// Télécharge un morceau, parse la progression, supporte l'annulation + retry.
pub fn download_track(
    bin: &PathBuf,
    opts: &DownloadOpts,
    url: &str,
    started: SystemTime,
    mut on_progress: impl FnMut(&Progress) + Send + 'static,
    mut should_stop: impl FnMut() -> bool + Send + 'static,
) -> Result<DownloadOutcome, TrackError> {
    if !opts.force {
        if let Some(id) = opts.video_id {
            if opts.use_archive && archive_has_id(opts.output_dir, id) {
                if let Some(existing) = existing_media_for(
                    opts.output_dir,
                    opts.expected_title.unwrap_or(""),
                    opts.media,
                    Some(id),
                ) {
                    return Ok(DownloadOutcome {
                        path: existing,
                        skipped: true,
                    });
                }
            }
        }
        if let Some(t) = opts.expected_title {
            if !t.trim().is_empty() {
                if let Some(existing) =
                    existing_media_for(opts.output_dir, t, opts.media, opts.video_id)
                {
                    return Ok(DownloadOutcome {
                        path: existing,
                        skipped: true,
                    });
                }
            }
        }
    }

    let attempts = if opts.auto_retry { 3u32 } else { 1u32 };
    let mut last_err: Option<TrackError> = None;
    for attempt in 0..attempts {
        if should_stop() {
            return Err(TrackError::cancelled());
        }
        match download_track_once(bin, opts, url, started, &mut on_progress, &mut should_stop) {
            Ok(outcome) => return Ok(outcome),
            Err(e) if e.cancelled => return Err(e),
            Err(e) => {
                let retryable = is_retryable_error(&e.message);
                last_err = Some(TrackError::failed(humanize_error(&e.message)));
                if attempt + 1 < attempts && retryable && !should_stop() {
                    let wait_ms = match attempt {
                        0 => 2000,
                        1 => 5000,
                        _ => 15000,
                    };
                    let slices = wait_ms / 200;
                    for _ in 0..slices {
                        if should_stop() {
                            return Err(TrackError::cancelled());
                        }
                        std::thread::sleep(Duration::from_millis(200));
                    }
                    continue;
                }
                break;
            }
        }
    }
    Err(last_err.unwrap_or_else(|| TrackError::failed("Le téléchargement a échoué.".into())))
}

fn download_track_once(
    bin: &PathBuf,
    opts: &DownloadOpts,
    url: &str,
    started: SystemTime,
    on_progress: &mut (impl FnMut(&Progress) + Send + 'static),
    should_stop: &mut (impl FnMut() -> bool + Send + 'static),
) -> Result<DownloadOutcome, TrackError> {
    let args = download_args(bin, opts, url);
    wait_update();

    let mut child = match raw_command(bin)
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
    {
        Ok(c) => c,
        Err(e) => return Err(TrackError::failed(e.to_string())),
    };

    let mut stdout = child.stdout.take();
    let mut stderr = child.stderr.take();
    let mut out_done = stdout.is_none();
    let mut err_done = stderr.is_none();

    let (tx, rx) = std::sync::mpsc::channel::<Msg2>();

    let stderr_handle = {
        let tx = tx.clone();
        std::thread::spawn(move || {
            let stderr_taken = stderr.take();
            let mut tail: Vec<String> = Vec::new();
            if let Some(r) = stderr_taken {
                let buf = BufReader::new(r);
                for line in buf.lines().map_while(Result::ok) {
                    tail.push(line.clone());
                    if tail.len() > 200 {
                        tail.remove(0);
                    }
                    if let Some(p) = parse_progress_line(&line) {
                        if tx.send(Msg2::Progress(p)).is_err() {
                            break;
                        }
                    }
                }
            }
            let _ = tx.send(Msg2::StderrDone(tail));
        })
    };

    let stdout_handle = std::thread::spawn(move || {
        let stdout_taken = stdout.take();
        if let Some(r) = stdout_taken {
            let buf = BufReader::new(r);
            for line in buf.lines().map_while(Result::ok) {
                if let Some(p) = parse_progress_line(&line) {
                    if tx.send(Msg2::Progress(p)).is_err() {
                        break;
                    }
                } else if !line.trim().is_empty() && !line.trim().starts_with('[') {
                    if tx.send(Msg2::PrintedPath(line.trim().to_string())).is_err() {
                        break;
                    }
                }
            }
        }
        let _ = tx.send(Msg2::StdoutDone);
    });

    let mut stderr_tail: Vec<String> = Vec::new();
    let mut last_path: Option<String> = None;
    let mut cancelled = false;

    loop {
        if should_stop() {
            cancelled = true;
            kill_tree(&mut child);
        }
        if out_done && err_done {
            break;
        }
        match rx.recv_timeout(std::time::Duration::from_millis(200)) {
            Ok(Msg2::Progress(p)) => on_progress(&p),
            Ok(Msg2::PrintedPath(p)) => last_path = Some(p),
            Ok(Msg2::StdoutDone) => out_done = true,
            Ok(Msg2::StderrDone(tail)) => {
                stderr_tail = tail;
                err_done = true;
            }
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => continue,
        }
    }

    let _ = stderr_handle.join().ok();
    let _ = stdout_handle.join().ok();

    if cancelled {
        let _ = child.wait();
        cleanup_partials(opts.output_dir, opts.expected_title, started);
        return Err(TrackError::cancelled());
    }

    let status = if out_done && err_done {
        child.wait()
    } else {
        Ok(child.wait().unwrap_or_default())
    };

    if let Ok(st) = &status {
        if st.success() {
            if let Some(p) = last_path {
                if std::path::Path::new(&p).is_file() {
                    return Ok(DownloadOutcome {
                        path: p,
                        skipped: false,
                    });
                }
            }
            // Archive hit : yt-dlp exit 0 sans télécharger.
            if let Some(existing) = existing_media_for(
                opts.output_dir,
                opts.expected_title.unwrap_or(""),
                opts.media,
                opts.video_id,
            ) {
                return Ok(DownloadOutcome {
                    path: existing,
                    skipped: true,
                });
            }
            match find_newest_media(opts.output_dir, started, opts.media) {
                Some(p) => {
                    return Ok(DownloadOutcome {
                        path: p,
                        skipped: false,
                    })
                }
                None => {
                    return Err(TrackError::failed(
                        "Le fichier n'a pas été trouvé après le téléchargement.".into(),
                    ))
                }
            }
        }
    }

    let msg = stderr_tail
        .last()
        .cloned()
        .filter(|l| !l.trim().is_empty())
        .unwrap_or_else(|| "Le téléchargement a échoué.".to_string());
    Err(TrackError::failed(msg))
}

enum Msg2 {
    Progress(Progress),
    PrintedPath(String),
    StdoutDone,
    StderrDone(Vec<String>),
}

/// Construit l'URL de lecture d'un morceau d'une playlist plate (id -> watch URL).
pub fn entry_url(id: &str) -> String {
    if id.starts_with("http") {
        id.to_string()
    } else {
        format!("https://www.youtube.com/watch?v={id}")
    }
}

// ---------------------------------------------------------------------------
// Version / mise à jour de yt-dlp
// ---------------------------------------------------------------------------

/// Verrou global : une seule mise à jour à la fois (les concurrents attendent).
static UPDATE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Exécute une commande courte (version, mise à jour) en bornant sa durée :
/// un yt-dlp.exe verrouillé/l'hameçon d'une mise à jour avortée ne doit jamais
/// bloquer l'interface. En cas de dépassement, le processus est tué (arbre).
fn run_short(cmd: &mut Command, seconds: u64) -> Result<std::process::Output, String> {
    use std::io::Read;
    let mut child = cmd
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let deadline = std::time::Instant::now() + Duration::from_secs(seconds);

    let status = loop {
        match child.try_wait() {
            Ok(Some(s)) => break s,
            Ok(None) => {}
            Err(e) => return Err(e.to_string()),
        }
        if std::time::Instant::now() >= deadline {
            kill_tree(&mut child);
            let _ = child.wait();
            return Err(format!(
                "yt-dlp ne répond pas (délai de {} s dépassé).",
                seconds / 60 * 60 + seconds % 60
            ));
        }
        std::thread::sleep(Duration::from_millis(40));
    };

    let mut so = Vec::new();
    let mut se = Vec::new();
    if let Some(mut o) = stdout {
        let _ = o.read_to_end(&mut so);
    }
    if let Some(mut e) = stderr {
        let _ = e.read_to_end(&mut se);
    }
    Ok(std::process::Output {
        status,
        stdout: so,
        stderr: se,
    })
}

/// Lit la version de yt-dlp sans attendre de mise à jour éventuelle.
pub fn version(bin: &PathBuf) -> String {
    raw_version(bin)
}

/// Lit la version de yt-dlp sans attendre de mise à jour éventuelle.
fn raw_version(bin: &PathBuf) -> String {
    let exe = paths::ytdlp(bin);
    if !exe.is_file() {
        crate::debuglog::log(format!("raw_version -> {} : INTROUVABLE", exe.display()));
        return format!("yt-dlp introuvable dans : {}", bin.display());
    }
    match run_short(raw_command(bin).arg("--version"), 15) {
        Ok(o) if o.status.success() => {
            let v = String::from_utf8_lossy(&o.stdout).trim().to_string();
            crate::debuglog::log(format!(
                "raw_version -> {} : ok ('{}')",
                exe.display(),
                v.chars().take(60).collect::<String>()
            ));
            if v.is_empty() {
                "inconnue".into()
            } else {
                v
            }
        }
        Ok(o) => {
            let e = String::from_utf8_lossy(&o.stderr).trim().to_string();
            crate::debuglog::log(format!("raw_version -> {} : échec ({e})", exe.display()));
            if e.is_empty() {
                "erreur de lecture".into()
            } else {
                e
            }
        }
        Err(e) => {
            crate::debuglog::log(format!("raw_version -> {} : {e}", exe.display()));
            e
        }
    }
}

/// Met à jour yt-dlp via son self-update (`-U`). Retourne la nouvelle version.
pub fn update(bin: &PathBuf) -> Result<String, String> {
    let _guard = UPDATE_LOCK.lock().unwrap();
    crate::debuglog::log(format!("update() -> {}/yt-dlp.exe : début", bin.display()));
    UPDATE_IN_PROGRESS.store(true, Ordering::Relaxed);
    let result = (|| {
        let out = match run_short(raw_command(bin).arg("-U"), 90) {
            Ok(o) => o,
            Err(e) => {
                crate::debuglog::log(format!("update() -> erreur : {e}"));
                return Err(e);
            }
        };
        crate::debuglog::log(format!(
            "update() -> statut {} ({} octets)",
            out.status,
            out.stdout.len()
        ));
        if !out.status.success() {
            let msg = String::from_utf8_lossy(&out.stderr).trim().to_string();
            let e = if msg.is_empty() {
                "La mise à jour de yt-dlp a échoué.".to_string()
            } else {
                msg
            };
            crate::debuglog::log(format!("update() -> échec : {e}"));
            return Err(e);
        }
        // `-U` terminé : on interroge la version directement (le flag de mise à
        // jour est encore posé, mais le binaire est en place et ne bougera plus).
        Ok(raw_version(bin))
    })();
    UPDATE_IN_PROGRESS.store(false, Ordering::Relaxed);
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_ligne_progression_valide() {
        let p = parse_progress_line("[45.3|12345|987654|1234567|12]").unwrap();
        assert_eq!(p.pct, 45.3);
        assert_eq!(p.downloaded, 12345);
        assert_eq!(p.total, 987654);
        assert_eq!(p.speed, 1234567);
        assert_eq!(p.eta, 12);
    }

    #[test]
    fn parse_pct_na_est_derive_des_octets() {
        let p = parse_progress_line("[NA|5|10|0|3]").unwrap();
        assert_eq!(p.pct, 50.0);
    }

    #[test]
    fn parse_ligne_invalide_ignoree() {
        assert!(parse_progress_line("hello").is_none());
        assert!(parse_progress_line("[a|b|c|d]").is_none());
        assert!(parse_progress_line("").is_none());
    }

    #[test]
    fn sanitize_nom_fichier() {
        assert_eq!(sanitize_filename("a b<:c"), "a bc".to_string());
        assert_eq!(sanitize_filename("a  b  c"), "a b c".to_string());
        assert_eq!(sanitize_filename("<>\"/\\|?*"), "untitled".to_string());
        assert_eq!(sanitize_filename(&"x".repeat(300)).len(), 200);
    }

    #[test]
    fn json_playlist_dedoublonne_sans_touche_lordre() {
        let raw = r#"{"id":"PL1","title":"Mix","entries":[
            {"id":"A","title":"One","url":"https://x/A","thumbnail":"https://i.ytimg.com/vi/A/1.jpg"},
            {"id":"A","title":"One","url":"https://x/A"},
            {"id":"B","title":"Two","duration":90}
        ]}"#;
        let info = json_to_info(raw.as_bytes(), "http://u").unwrap();
        assert_eq!(info.kind, "playlist");
        let entries = info.entries.unwrap();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].id, "A");
        assert_eq!(entries[1].id, "B");
        // URL dupliquée non fournie -> reconstruite depuis l'id.
        assert_eq!(entries[1].url, "https://www.youtube.com/watch?v=B");
        assert_eq!(
            entries[1].thumbnail,
            "https://i.ytimg.com/vi/B/hqdefault.jpg"
        );
    }

    #[test]
    fn json_video_single() {
        let raw =
            r#"{"id":"V1","title":"Titre","uploader":"Chaîne","duration":150,"thumbnail":"t.jpg"}"#;
        let info = json_to_info(raw.as_bytes(), "http://u").unwrap();
        assert_eq!(info.kind, "video");
        assert_eq!(info.title, "Titre");
        assert_eq!(info.duration, Some(150.0));
        assert!(info.entries.is_none());
    }

    fn opts_audio(profile: &'static str) -> DownloadOpts<'static> {
        DownloadOpts {
            output_dir: "C:\\out",
            audio_format: "128",
            quality: "best",
            media: "audio",
            video_format: "best",
            embed_thumbnail: true,
            embed_metadata: false,
            expected_title: None,
            force: false,
            video_id: None,
            profile,
            use_archive: true,
            auto_retry: true,
            max_concurrent: 4,
        }
    }

    #[test]
    fn args_embed_et_qualite() {
        let bin = PathBuf::from("C:\\bin");
        let mut o = opts_audio("balanced");
        o.audio_format = "128";
        o.embed_thumbnail = true;
        o.embed_metadata = false;
        let mut args = download_args(&bin, &o, "http://x");
        assert!(args.iter().any(|a| a == "--embed-thumbnail"));
        assert!(!args.iter().any(|a| a == "--embed-metadata"));
        assert!(args.iter().any(|a| a == "--download-archive"));
        let qi = args.iter().position(|a| a == "--audio-quality").unwrap();
        assert_eq!(args[qi + 1], "128K");
        o.audio_format = "320";
        o.quality = "worst";
        o.embed_thumbnail = false;
        args = download_args(&bin, &o, "http://x");
        let fi = args.iter().position(|a| a == "--format").unwrap();
        assert_eq!(args[fi + 1], "worstaudio/worst");
        let qi = args.iter().position(|a| a == "--audio-quality").unwrap();
        assert_eq!(args[qi + 1], "320K");
    }

    #[test]
    fn args_profil_fast_garde_m4a() {
        let bin = PathBuf::from("C:\\bin");
        let args = download_args(&bin, &opts_audio("fast"), "http://x");
        assert!(!args.iter().any(|a| a == "--extract-audio"));
        // opts_audio a embed_thumbnail=true → pochettes aussi en profil rapide (m4a).
        assert!(args.iter().any(|a| a == "--embed-thumbnail"));
        assert!(args.iter().any(|a| a == "--convert-thumbnails"));
        assert!(args.iter().any(|a| a.contains("[%(id)s]")));
    }

    #[test]
    fn args_video_mp4() {
        let bin = PathBuf::from("C:\\bin");
        let args = download_args(
            &bin,
            &DownloadOpts {
                output_dir: "C:\\out",
                audio_format: "320",
                quality: "best",
                media: "video",
                video_format: "1080",
                embed_thumbnail: true,
                embed_metadata: true,
                expected_title: None,
                force: false,
                video_id: None,
                profile: "balanced",
                use_archive: false,
                auto_retry: true,
                max_concurrent: 4,
            },
            "http://x",
        );
        assert!(!args.iter().any(|a| a == "--extract-audio"));
        assert!(!args.iter().any(|a| a == "--audio-format"));
        assert!(args.iter().any(|a| a == "--embed-thumbnail"));
        assert!(args.iter().any(|a| a == "--write-thumbnail"));
        assert!(args.iter().any(|a| a == "--embed-metadata"));
        let mi = args
            .iter()
            .position(|a| a == "--merge-output-format")
            .unwrap();
        assert_eq!(args[mi + 1], "mp4");
        let fi = args.iter().position(|a| a == "--format").unwrap();
        let selector = &args[fi + 1];
        assert!(selector.contains("height<=1080"), "sélecteur: {selector}");
        let ext = args.iter().position(|a| a == "--extractor-args");
        assert!(ext.is_none(), "pas d'override player en vidéo");
        let cf = args
            .iter()
            .position(|a| a == "--concurrent-fragments")
            .unwrap();
        assert_eq!(args[cf + 1], "4");
    }

    #[test]
    fn args_video_meilleure_qualite_sans_borne() {
        let bin = PathBuf::from("C:\\bin");
        let args = download_args(
            &bin,
            &DownloadOpts {
                output_dir: "C:\\out",
                audio_format: "320",
                quality: "best",
                media: "video",
                video_format: "best",
                embed_thumbnail: false,
                embed_metadata: false,
                expected_title: None,
                force: false,
                video_id: None,
                profile: "balanced",
                use_archive: false,
                auto_retry: false,
                max_concurrent: 4,
            },
            "http://x",
        );
        let fi = args.iter().position(|a| a == "--format").unwrap();
        assert_eq!(args[fi + 1], "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b");
    }

    #[test]
    fn extract_video_id_variants() {
        assert_eq!(
            extract_video_id("https://www.youtube.com/watch?v=aqz-KE-bpKQ"),
            Some("aqz-KE-bpKQ".into())
        );
        assert_eq!(
            extract_video_id("https://youtu.be/aqz-KE-bpKQ?t=1"),
            Some("aqz-KE-bpKQ".into())
        );
        assert_eq!(extract_video_id("aqz-KE-bpKQ"), Some("aqz-KE-bpKQ".into()));
    }

    #[test]
    fn humanize_et_retryable() {
        assert!(is_retryable_error("HTTP Error 429: Too Many Requests"));
        assert!(!is_retryable_error("Private video"));
        assert!(humanize_error("HTTP Error 429").contains("Trop de requêtes"));
    }

    /// Un MP3 déjà présent ne doit jamais être réutilisé pour une tâche vidéo,
    /// et réciproquement.
    #[test]
    fn idempotence_separe_audio_et_video() {
        let dir = std::env::temp_dir().join(format!("ytmd-media-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let mp3 = dir.join("Chanson.mp3");
        let mp4 = dir.join("Clip.mp4");
        let _ = std::fs::write(&mp3, b"x");
        let _ = std::fs::write(&mp4, b"x");
        let d = dir.to_string_lossy();

        assert!(existing_media_for(&d, "Chanson", "audio", None).is_some());
        assert!(existing_media_for(&d, "Chanson", "video", None).is_none());
        assert!(existing_media_for(&d, "Clip", "video", None).is_some());
        assert!(existing_media_for(&d, "Clip", "audio", None).is_none());
        assert!(existing_media_for(&d, "Absent", "video", None).is_none());

        let _ = std::fs::remove_file(&mp3);
        let _ = std::fs::remove_file(&mp4);
        let _ = std::fs::remove_dir(&dir);
    }

    #[test]
    fn idempotence_trouve_le_fichier_existant() {
        let dir = std::env::temp_dir().join(format!("ytmd-test-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join("Some Song.mp3");
        let _ = std::fs::write(&path, b"x");
        let found = existing_media_for(&dir.to_string_lossy(), "Some Song", "audio", None);
        assert!(found.is_some());
        assert!(found.unwrap().ends_with("Some Song.mp3"));
        assert!(existing_media_for(&dir.to_string_lossy(), "Absent", "audio", None).is_none());
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_dir(&dir);
    }

    #[test]
    fn cleanup_partiels_cible_uniquement_le_titre() {
        let dir = std::env::temp_dir().join(format!("ytmd-clean-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let mine_part = dir.join("Title.mp3.part");
        let mine_ytdl = dir.join("Title.mp3.ytdl");
        let other_part = dir.join("Other.mp3.part");
        let complete = dir.join("Title.mp3");
        for p in [&mine_part, &mine_ytdl, &other_part, &complete] {
            let _ = std::fs::write(p, b"x");
        }
        let started = SystemTime::now() - Duration::from_secs(2);
        cleanup_partials(&dir.to_string_lossy(), Some("Title"), started);
        assert!(!mine_part.exists());
        assert!(!mine_ytdl.exists());
        assert!(other_part.exists());
        assert!(complete.exists());
        for p in [mine_part, mine_ytdl, other_part, complete] {
            let _ = std::fs::remove_file(p);
        }
        let _ = std::fs::remove_dir(&dir);
    }
}
