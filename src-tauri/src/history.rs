use std::fs;
use std::path::PathBuf;

use serde::Deserialize;

use crate::manager::Inner;
use crate::models::Task;

/// Enregistrement d'une tâche encore active ("queued" | "downloading" |
/// "converting") : sauvegardée pour être relancée au prochain démarrage.
/// Conservé uniquement pour relire le format historique de `queue.json`.
#[derive(Clone, Debug, Deserialize)]
pub struct QueueRecord {
    pub url: String,
    pub title: String,
    #[serde(default)]
    pub thumbnail: Option<String>,
}

fn queue_path() -> PathBuf {
    let appdata = std::env::var("APPDATA").unwrap_or_else(|_| ".".into());
    PathBuf::from(appdata)
        .join("YTMusicDownloader")
        .join("queue.json")
}

fn as_active(t: &Task) -> bool {
    matches!(t.status.as_str(), "queued" | "downloading" | "converting")
}

/// Construit la liste complète des tâches à persister.
///
/// - Les tâches **actives** sont remises à `queued` (elles seront relancées au
///   démarrage) sans leurs champs de progression ni de job.
/// - Les tâches **terminées / annulées** sont conservées telles quelles afin
///   d'être encore visibles au prochain lancement.
fn build_snapshot(inner: &Inner) -> Vec<Task> {
    let mut snapshot: Vec<Task> = Vec::with_capacity(inner.tasks.len());
    let mut seen = std::collections::HashSet::new();
    let mut push = |snapshot: &mut Vec<Task>, t: &Task| {
        if !seen.insert(t.id.clone()) {
            return;
        }
        if as_active(t) {
            let mut queued = Task::new(t.id.clone(), t.url.clone(), t.title.clone());
            queued.media = t.media.clone();
            queued.video_format = t.video_format.clone();
            queued.thumbnail = t.thumbnail.clone();
            // Marqueur Playlist-Job : au redémarrage on relance un vrai job
            // (et non un téléchargement simple avec `--no-playlist`).
            if t.job_total.is_some() || inner.jobs.contains_key(&t.id) {
                queued.job_total = Some(t.job_total.unwrap_or(0));
                queued.job_done = Some(0);
                queued.job_failed = Some(0);
                queued.job_current = Some("Reprise de la playlist…".into());
            }
            snapshot.push(queued);
        } else {
            snapshot.push(t.clone());
        }
    };
    for id in &inner.order {
        if let Some(t) = inner.tasks.get(id) {
            push(&mut snapshot, t);
        }
    }
    for t in inner.tasks.values() {
        push(&mut snapshot, t);
    }
    snapshot
}

/// Persiste la file d'attente (fichier supprimé si elle est vide).
pub fn save(inner: &Inner) {
    let snapshot = build_snapshot(inner);
    let path = queue_path();
    if snapshot.is_empty() {
        let _ = fs::remove_file(&path);
        return;
    }
    if let Some(dir) = path.parent() {
        let _ = fs::create_dir_all(dir);
    }
    if let Ok(json) = serde_json::to_string_pretty(&snapshot) {
        let _ = fs::write(path, json);
    }
}

/// Relit les tâches persistées du précédent lancement (y compris terminées et
/// annulées). Les anciennes tâches actives arrivent en statut `queued`.
pub fn load() -> Vec<Task> {
    let raw = match fs::read_to_string(queue_path()) {
        Ok(raw) => raw,
        Err(_) => return Vec::new(),
    };
    if let Ok(tasks) = serde_json::from_str::<Vec<Task>>(&raw) {
        return tasks
            .into_iter()
            .map(|mut t| {
                if as_active(&t) {
                    t.status = "queued".into();
                    t.progress = 0.0;
                    t.speed_bytes = 0;
                    t.speed_mbps = 0.0;
                    t.eta = 0;
                    t.error = None;
                    t.job_total = None;
                    t.job_done = None;
                    t.job_failed = None;
                    t.job_current = None;
                    t.job_eta = None;
                    t.job_speed = None;
                    t.job_tracks = None;
                }
                t
            })
            .collect();
    }
    // Format historique : seulement les tâches actives, remises en file.
    if let Ok(recs) = serde_json::from_str::<Vec<QueueRecord>>(&raw) {
        return recs
            .into_iter()
            .map(|r| {
                let mut t = Task::new(String::new(), r.url, r.title);
                t.thumbnail = r.thumbnail;
                t
            })
            .collect();
    }
    Vec::new()
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::sync::Arc;

    use crate::job::Job;
    use crate::manager::{Gov, Inner};
    use crate::models::Task;
    use crate::settings::Settings;

    fn sample_inner() -> Inner {
        let mut tasks = HashMap::new();
        tasks.insert(
            "a".into(),
            Task {
                id: "a".into(),
                url: "https://youtu.be/A".into(),
                title: "Titre A".into(),
                status: "queued".into(),
                ..Task::new("a".into(), String::new(), String::new())
            },
        );
        tasks.insert(
            "b".into(),
            Task {
                id: "b".into(),
                url: "https://youtu.be/B".into(),
                title: "Titre B".into(),
                status: "completed".into(),
                ..Task::new("b".into(), String::new(), String::new())
            },
        );
        tasks.insert(
            "c".into(),
            Task {
                id: "c".into(),
                url: "https://youtu.be/C".into(),
                title: "Titre C".into(),
                status: "converting".into(),
                ..Task::new("c".into(), String::new(), String::new())
            },
        );
        tasks.insert(
            "d".into(),
            Task {
                id: "d".into(),
                url: "https://youtu.be/D".into(),
                title: "Titre D".into(),
                status: "cancelled".into(),
                ..Task::new("d".into(), String::new(), String::new())
            },
        );
        Inner {
            tasks,
            order: vec!["a".into(), "c".into(), "b".into(), "d".into()],
            max_concurrent: 4,
            settings: Settings::default(),
            bin_dir: std::path::PathBuf::new(),
            jobs: HashMap::<String, Arc<std::sync::Mutex<Job>>>::new(),
            gov: Arc::new(Gov::new(4)),
            inflight: std::collections::HashSet::new(),
        }
    }

    #[test]
    fn snapshot_conserve_terminees_et_annulees() {
        let inner = sample_inner();
        let snap = super::build_snapshot(&inner);
        assert_eq!(snap.len(), 4, "toutes les tâches doivent être persistées");
        let statuses: Vec<_> = snap.iter().map(|t| t.status.as_str()).collect();
        assert!(statuses.contains(&"completed"));
        assert!(statuses.contains(&"cancelled"));
        assert_eq!(snap.iter().find(|t| t.id == "a").unwrap().status, "queued");
        assert_eq!(snap.iter().find(|t| t.id == "c").unwrap().status, "queued");
    }

    /// Un Playlist-Job actif doit garder un marqueur `job_total` pour être
    /// relancé comme job (et non comme téléchargement simple).
    #[test]
    fn playlist_job_actif_conserve_le_marqueur() {
        let mut inner = sample_inner();
        let t = inner.tasks.get_mut("c").unwrap();
        t.job_total = Some(12);
        t.job_done = Some(3);
        t.status = "downloading".into();

        let snap = super::build_snapshot(&inner);
        let c = snap.iter().find(|t| t.id == "c").unwrap();
        assert_eq!(c.status, "queued");
        assert_eq!(c.job_total, Some(12));
        assert_eq!(c.job_done, Some(0));
    }

    /// Une tâche vidéo remise en file au redémarrage doit repartir en MP4 :
    /// sans copie du format, tout l'historique vidéo rebasculerait en MP3.
    #[test]
    fn le_format_survit_a_la_remise_en_file() {
        let mut inner = sample_inner();
        let t = inner.tasks.get_mut("a").unwrap();
        t.media = "video".into();
        t.video_format = "720".into();

        let snap = super::build_snapshot(&inner);
        let a = snap.iter().find(|t| t.id == "a").unwrap();
        assert_eq!(a.status, "queued");
        assert_eq!(a.media, "video");
        assert_eq!(a.video_format, "720");

        // Et le round-trip JSON complet (Task dérive Deserialize).
        let json = serde_json::to_string(&snap).unwrap();
        let back: Vec<Task> = serde_json::from_str(&json).unwrap();
        assert_eq!(back.iter().find(|t| t.id == "a").unwrap().media, "video");
    }

    /// Une tâche enregistrée avant l'ajout du champ `media` doit rester
    /// chargeable (sinon l'historique entier est silencieusement reconstruit).
    #[test]
    fn tache_legacy_sans_format_recharge_en_audio() {
        let raw = r#"[{
            "id": "z",
            "url": "https://youtu.be/Z",
            "title": "Ancien",
            "status": "queued",
            "progress": 0.0,
            "speed_bytes": 0,
            "speed_mbps": 0.0,
            "eta": 0
        }]"#;
        let tasks: Vec<Task> = serde_json::from_str(raw).expect("tâche legacy");
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].media, "audio");
        assert_eq!(tasks[0].video_format, "best");
    }

    #[test]
    fn save_puis_load_roundtrip() {
        let inner = sample_inner();
        super::save(&inner);
        let loaded = super::load();
        assert_eq!(loaded.len(), 4, "l'historique complet doit être relu");
        assert!(loaded
            .iter()
            .any(|t| t.id == "d" && t.status == "cancelled"));
        assert!(loaded
            .iter()
            .any(|t| t.id == "b" && t.status == "completed"));
        assert!(loaded.iter().any(|t| t.id == "c" && t.status == "queued")); // active -> relancée
        let mut inner2 = sample_inner();
        for t in inner2.tasks.values_mut() {
            t.status = "completed".into();
        }
        let empty = Inner {
            tasks: HashMap::new(),
            order: Vec::new(),
            ..inner2
        };
        super::save(&empty);
        assert!(super::load().is_empty());
        let _ = std::fs::remove_file(super::queue_path());
    }
}
