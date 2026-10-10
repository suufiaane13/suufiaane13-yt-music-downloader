use std::collections::HashSet;
use std::path::PathBuf;

/// Construit la liste des emplacements candidats pour `bin/`, dans l'ordre de
/// priorité (sans éliminer les doublons ici).
fn candidates() -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            out.push(dir.join("bin"));
            out.push(dir.to_path_buf());
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        out.push(cwd.join("bin"));
        out.push(cwd.clone());
        if let Some(parent) = cwd.parent() {
            out.push(parent.join("bin"));
        }
    }
    out
}

/// Résultat d'inspection d'un dossier candidat (pour le diagnostic).
pub struct BinProbe {
    pub dir: PathBuf,
    pub yt_dlp: bool,
    pub ffmpeg: bool,
    pub ffprobe: bool,
}

impl BinProbe {
    fn check(dir: &PathBuf) -> Self {
        Self {
            dir: dir.clone(),
            yt_dlp: dir.join("yt-dlp.exe").is_file(),
            ffmpeg: dir.join("ffmpeg.exe").is_file(),
            ffprobe: dir.join("ffprobe.exe").is_file(),
        }
    }
    pub fn complete(&self) -> bool {
        self.yt_dlp && self.ffmpeg && self.ffprobe
    }
}

/// Inspecte tous les emplacements candidats (diagnostic : l'ordre est celui de
/// la priorité, les doublons sont supprimés).
pub fn probe() -> Vec<BinProbe> {
    let mut seen = HashSet::new();
    candidates()
        .into_iter()
        .filter(|d| seen.insert(d.clone()))
        .map(|d| BinProbe::check(&d))
        .collect()
}

/// Folder containing the bundled binaries (yt-dlp.exe, ffmpeg.exe, ffprobe.exe).
///
/// On préfère le premier dossier contenant les TROIS binaires (dans l'ordre de
/// priorité des emplacements), sinon le premier contenant au moins yt-dlp.exe.
/// Evalué à chaque appel : si un premier lancement a échoué (binaires pas
/// encore copiés), l'app se corrige d'elle-même au démarrage suivant.
pub fn bin_dir() -> Option<PathBuf> {
    let all = probe();
    all.iter()
        .find(|p| p.complete())
        .map(|p| p.dir.clone())
        .or_else(|| all.iter().find(|p| p.yt_dlp).map(|p| p.dir.clone()))
}

/// Résout le dossier `bin/`, avec repli explicite sur `cwd/bin`.
pub fn resolve_bin_dir() -> PathBuf {
    bin_dir().unwrap_or_else(|| std::env::current_dir().unwrap_or_default().join("bin"))
}

pub fn ytdlp(bin: &PathBuf) -> PathBuf {
    bin.join("yt-dlp.exe")
}

/// Deno embarqué (optionnel) pour `--js-runtimes` de yt-dlp.
pub fn deno(bin: &PathBuf) -> PathBuf {
    bin.join("deno.exe")
}

pub fn has_js_runtime(bin: &PathBuf) -> bool {
    deno(bin).is_file()
}
