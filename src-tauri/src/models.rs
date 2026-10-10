use serde::{Deserialize, Serialize};

/// Présence des binaires du moteur dans le dossier `bin/` (contrôle au boot).
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineCheck {
    pub yt_dlp: bool,
    pub ffmpeg: bool,
    pub ffprobe: bool,
    /// Runtime JS (Deno) pour une extraction YouTube fiable.
    pub js_runtime: bool,
    /// Dossier `bin/` effectivement utilisé par l'application (diagnostic).
    pub bin_dir: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobTrack {
    pub title: String,
    /// ok | error | downloading
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Fichier média présent dans le dossier de sortie (liste de la page Lecture).
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicFile {
    /// Nom du fichier (avec extension), trié pour l'affichage.
    pub name: String,
    /// Chemin absolu vers le fichier (utilisé pour `convertFileSrc`).
    pub path: String,
    /// Taille en octets.
    pub size_bytes: u64,
    /// Durée en secondes (MP3 via frames, MP4 via ffprobe).
    pub duration: f64,
    /// `audio` (MP3) ou `video` (MP4).
    pub kind: String,
    /// Pochette intégrée (frame ID3 APIC), en data URL base64.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover: Option<String>,
}

fn default_media() -> String {
    "audio".into()
}

fn default_video_format() -> String {
    "best".into()
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Task {
    pub id: String,
    pub url: String,
    pub title: String,
    /// Type de média snapshoté au lancement : `audio` (MP3) ou `video` (MP4).
    #[serde(default = "default_media")]
    pub media: String,
    /// Résolution vidéo snapshotée (`best`, `1080`, `720`, `480`).
    #[serde(default = "default_video_format")]
    pub video_format: String,
    pub status: String,
    pub progress: f64,
    pub speed_bytes: u64,
    pub speed_mbps: f64,
    pub eta: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thumbnail: Option<String>,
    /// `true` quand le fichier MP3 existait déjà : le téléchargement a été
    /// ignoré (idempotence), pas un vrai download terminé.
    #[serde(default)]
    pub skipped: bool,
    /// Interne : force le re-téléchargement de la tâche, même si le fichier
    /// existe déjà (propriété du moteur, non exposée au frontend).
    #[serde(default, skip)]
    pub force_redownload: bool,
    // Champs d'un Job Playlist (présents uniquement pour une tache Playlist-Job)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub job_total: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub job_done: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub job_failed: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub job_current: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub job_eta: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub job_speed: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub job_tracks: Option<Vec<JobTrack>>,
}

impl Task {
    pub fn new(id: String, url: String, title: String) -> Self {
        let title = if title.trim().is_empty() {
            url.clone()
        } else {
            title
        };
        Self {
            id,
            url,
            title,
            media: default_media(),
            video_format: default_video_format(),
            status: "queued".into(),
            progress: 0.0,
            speed_bytes: 0,
            speed_mbps: 0.0,
            eta: 0,
            error: None,
            output_path: None,
            thumbnail: None,
            skipped: false,
            force_redownload: false,
            job_total: None,
            job_done: None,
            job_failed: None,
            job_current: None,
            job_eta: None,
            job_speed: None,
            job_tracks: None,
        }
    }
}
