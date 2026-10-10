use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

fn default_media() -> String {
    "audio".into()
}

fn default_video_format() -> String {
    "best".into()
}

fn default_profile() -> String {
    "balanced".into()
}

fn default_true() -> bool {
    true
}

/// Ne conserve que les deux modes pris en charge par le moteur.
pub fn normalize_media(value: Option<&str>) -> String {
    if value == Some("video") {
        "video".into()
    } else {
        "audio".into()
    }
}

/// Résolution maximale vidéo ; `best` laisse yt-dlp choisir.
pub fn normalize_video_format(value: Option<&str>) -> String {
    match value {
        Some("1080") | Some("720") | Some("480") => value.unwrap().into(),
        _ => "best".into(),
    }
}

/// Profil de téléchargement : `fast` | `balanced` | `quality`.
pub fn normalize_profile(value: Option<&str>) -> String {
    match value {
        Some("fast") | Some("quality") => value.unwrap().into(),
        _ => "balanced".into(),
    }
}

/// Concurrence effective (manuel ou auto selon CPU + profil).
pub fn effective_concurrency(s: &Settings) -> u32 {
    if !s.auto_concurrent {
        return s.max_concurrent.clamp(1, 16);
    }
    let cores = std::thread::available_parallelism()
        .map(|n| n.get() as u32)
        .unwrap_or(4)
        .clamp(2, 32);
    match s.download_profile.as_str() {
        "fast" => cores.clamp(4, 12),
        "quality" => (cores / 2).clamp(2, 6),
        _ => cores.saturating_sub(1).clamp(4, 10),
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Settings {
    pub output_dir: String,
    pub audio_format: String,
    pub quality: String,
    /// Format proposé par défaut dans les pages de téléchargement.
    #[serde(default = "default_media")]
    pub default_media: String,
    /// Résolution maximale pour les téléchargements MP4.
    #[serde(default = "default_video_format")]
    pub video_format: String,
    pub max_concurrent: u32,
    pub embed_thumbnail: bool,
    pub embed_metadata: bool,
    /// Prénom saisi pour le titulaire du projet (voir écran d'accueil).
    #[serde(default)]
    pub user_first_name: String,
    /// Nom saisi pour le titulaire du projet.
    #[serde(default)]
    pub user_last_name: String,
    /// URL d'un JSON distant `{ "version", "url" }` pour vérifier les mises à jour.
    #[serde(default)]
    pub update_url: String,
    /// `fast` | `balanced` | `quality` — arbitre vitesse vs qualité.
    #[serde(default = "default_profile")]
    pub download_profile: String,
    /// Si vrai, la concurrence est calculée selon CPU + profil.
    #[serde(default)]
    pub auto_concurrent: bool,
    /// Archive yt-dlp par video_id (skip fiable des déjà téléchargés).
    #[serde(default = "default_true")]
    pub use_archive: bool,
    /// Réessais automatiques sur erreurs réseau / YouTube transitoires.
    #[serde(default = "default_true")]
    pub auto_retry: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
pub struct SettingsPatch {
    pub output_dir: Option<String>,
    pub audio_format: Option<String>,
    pub quality: Option<String>,
    #[serde(default)]
    pub default_media: Option<String>,
    #[serde(default)]
    pub video_format: Option<String>,
    pub max_concurrent: Option<u32>,
    pub embed_thumbnail: Option<bool>,
    pub embed_metadata: Option<bool>,
    pub user_first_name: Option<String>,
    pub user_last_name: Option<String>,
    pub update_url: Option<String>,
    pub download_profile: Option<String>,
    pub auto_concurrent: Option<bool>,
    pub use_archive: Option<bool>,
    pub auto_retry: Option<bool>,
}

impl Settings {
    pub fn apply(&mut self, patch: SettingsPatch) {
        if let Some(v) = patch.output_dir {
            if !v.trim().is_empty() {
                self.output_dir = v.trim().to_string();
            }
        }
        if let Some(v) = patch.audio_format {
            self.audio_format = v;
        }
        if let Some(v) = patch.quality {
            self.quality = v;
        }
        if let Some(v) = patch.default_media {
            self.default_media = normalize_media(Some(&v));
        }
        if let Some(v) = patch.video_format {
            self.video_format = normalize_video_format(Some(&v));
        }
        if let Some(v) = patch.max_concurrent {
            self.max_concurrent = v.clamp(1, 16);
        }
        if let Some(v) = patch.embed_thumbnail {
            self.embed_thumbnail = v;
        }
        if let Some(v) = patch.embed_metadata {
            self.embed_metadata = v;
        }
        if let Some(v) = patch.user_first_name {
            self.user_first_name = v.trim().to_string();
        }
        if let Some(v) = patch.user_last_name {
            self.user_last_name = v.trim().to_string();
        }
        if let Some(v) = patch.update_url {
            self.update_url = v.trim().to_string();
        }
        if let Some(v) = patch.download_profile {
            self.download_profile = normalize_profile(Some(&v));
        }
        if let Some(v) = patch.auto_concurrent {
            self.auto_concurrent = v;
        }
        if let Some(v) = patch.use_archive {
            self.use_archive = v;
        }
        if let Some(v) = patch.auto_retry {
            self.auto_retry = v;
        }
    }
}

impl Default for Settings {
    fn default() -> Self {
        let output_dir = std::env::var("USERPROFILE")
            .map(|p| PathBuf::from(p).join("Music").join("YT-Music-Downloader"))
            .unwrap_or_else(|_| PathBuf::from(".").join("YT-Music-Downloader"))
            .to_string_lossy()
            .into_owned();

        Self {
            output_dir,
            audio_format: "320".into(),
            quality: "best".into(),
            default_media: default_media(),
            video_format: default_video_format(),
            max_concurrent: 8,
            embed_thumbnail: true,
            embed_metadata: true,
            user_first_name: String::new(),
            user_last_name: String::new(),
            update_url: String::new(),
            download_profile: default_profile(),
            auto_concurrent: false,
            use_archive: true,
            auto_retry: true,
        }
    }
}

fn config_path() -> PathBuf {
    let appdata = std::env::var("APPDATA").unwrap_or_else(|_| ".".into());
    PathBuf::from(appdata)
        .join("YTMusicDownloader")
        .join("config.json")
}

pub fn load() -> Settings {
    let path = config_path();
    if let Ok(raw) = fs::read_to_string(&path) {
        if let Ok(s) = serde_json::from_str::<Settings>(&raw) {
            return s;
        }
    }
    let def = Settings::default();
    let _ = save(&def);
    def
}

pub fn save(s: &Settings) -> Result<(), String> {
    let path = config_path();
    if let Some(dir) = path.parent() {
        let _ = fs::create_dir_all(dir);
    }
    let json = serde_json::to_string_pretty(s).map_err(|e| e.to_string())?;
    fs::write(path, json).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_ancien_se_charge_avec_defauts() {
        let legacy = r#"{
            "output_dir": "C:/Musique",
            "audio_format": "192",
            "quality": "best",
            "max_concurrent": 5,
            "embed_thumbnail": true,
            "embed_metadata": false,
            "user_first_name": "Moha",
            "user_last_name": "Z"
        }"#;
        let s: Settings = serde_json::from_str(legacy).expect("config legacy valide");
        assert_eq!(s.output_dir, "C:/Musique");
        assert_eq!(s.default_media, "audio");
        assert_eq!(s.video_format, "best");
        assert_eq!(s.download_profile, "balanced");
        assert!(s.use_archive);
        assert!(s.auto_retry);
        assert!(!s.auto_concurrent);
    }

    #[test]
    fn valeurs_inconnues_replaquees_sur_les_defauts() {
        assert_eq!(normalize_media(Some("video")), "video");
        assert_eq!(normalize_media(Some("VIDEO")), "audio");
        assert_eq!(normalize_media(Some("mp4")), "audio");
        assert_eq!(normalize_media(None), "audio");

        assert_eq!(normalize_video_format(Some("1080")), "1080");
        assert_eq!(normalize_video_format(Some("720")), "720");
        assert_eq!(normalize_video_format(Some("480")), "480");
        assert_eq!(normalize_video_format(Some("2160")), "best");
        assert_eq!(normalize_video_format(None), "best");

        assert_eq!(normalize_profile(Some("fast")), "fast");
        assert_eq!(normalize_profile(Some("quality")), "quality");
        assert_eq!(normalize_profile(Some("turbo")), "balanced");
        assert_eq!(normalize_profile(None), "balanced");
    }

    #[test]
    fn apply_ne_tient_pas_compte_d_une_valeur_invalide() {
        let mut s = Settings::default();
        s.apply(SettingsPatch {
            default_media: Some("video".into()),
            video_format: Some("720".into()),
            download_profile: Some("fast".into()),
            ..Default::default()
        });
        assert_eq!(s.default_media, "video");
        assert_eq!(s.video_format, "720");
        assert_eq!(s.download_profile, "fast");

        s.apply(SettingsPatch {
            default_media: Some("pirate".into()),
            video_format: Some("9999".into()),
            download_profile: Some("nope".into()),
            ..Default::default()
        });
        assert_eq!(s.default_media, "audio", "valeur inconnue -> repli sûr");
        assert_eq!(s.video_format, "best");
        assert_eq!(s.download_profile, "balanced");
    }

    #[test]
    fn effective_concurrency_respecte_le_plafond_manuel() {
        let mut s = Settings::default();
        s.auto_concurrent = false;
        s.max_concurrent = 3;
        assert_eq!(effective_concurrency(&s), 3);
    }
}
