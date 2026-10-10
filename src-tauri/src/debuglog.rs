use std::collections::VecDeque;
use std::io::Write;
use std::sync::Mutex;

/// Lettre de debug de l'application. Écrite dans
/// `%APPDATA%\YTMusicDownloader\debug.log` et conservée en mémoire pour être
/// lisible dans l'interface (onglet Paramètres → Diagnostic moteur).
static RING: Mutex<VecDeque<String>> = Mutex::new(VecDeque::new());
static FILE_LOCK: Mutex<()> = Mutex::new(());

const MAX_LINES: usize = 500;

fn timestamp() -> String {
    let ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    format!("[{ms}ms]")
}

/// Écrit une ligne de log (temps système de l'app) sans horodatage humain.
pub fn log(msg: impl AsRef<str>) {
    let line = format!("{} {}", timestamp(), msg.as_ref());
    if let Ok(mut ring) = RING.lock() {
        ring.push_back(line.clone());
        while ring.len() > MAX_LINES {
            ring.pop_front();
        }
    }
    if let Ok(_g) = FILE_LOCK.lock() {
        if let Ok(dir) = std::env::var("APPDATA") {
            let dir = std::path::PathBuf::from(dir).join("YTMusicDownloader");
            let _ = std::fs::create_dir_all(&dir);
            if let Ok(mut f) = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(dir.join("debug.log"))
            {
                let _ = writeln!(f, "{line}");
            }
        }
    }
}

/// Les `n` dernières lignes de log (pour l'affichage dans les réglages).
pub fn tail(n: usize) -> Vec<String> {
    let ring = RING.lock().unwrap();
    ring.iter().rev().take(n.max(1)).cloned().rev().collect()
}
