use std::collections::VecDeque;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant, SystemTime};

use crate::manager::Inner;
use crate::models::{JobTrack, Task};
use crate::ytdlp::{self, DownloadOpts, Progress};

const THROTTLE: Duration = Duration::from_millis(250);
const RECENT_MAX: usize = 6;

/// Sink d'evenements (l'app le branche sur l'event `task-updated` de Tauri).
pub type Notify = Arc<dyn Fn(Task) + Send + Sync>;

#[derive(Clone, Copy, PartialEq)]
pub enum EntryStatus {
    Pending,
    Running,
    Done,
    Failed,
}

pub struct JobEntry {
    pub id: String,
    pub title: String,
    pub status: EntryStatus,
    pub error: Option<String>,
}

pub struct Job {
    pub id: String,
    pub url: String,
    pub title: String,
    /// Type de média figé au lancement : les relances (retry) conservent le
    /// même format, même si le réglage global change entre-temps.
    pub media: String,
    /// Résolution MP4 figée au lancement (`best`, `1080`, `720`, `480`).
    pub video_format: String,
    pub entries: Vec<JobEntry>,
    pub cursor: usize,
    pub retry: VecDeque<usize>,
    pub done: usize,
    pub failed: usize,
    pub running: usize,
    pub cancelled: AtomicBool,
    pub started: SystemTime,
    pub last_emit: Mutex<Instant>,
    pub current: Vec<String>,
    pub speeds: Vec<u64>,
    pub recent: VecDeque<JobTrack>,
    pub avg_track_ms: f64,
    /// Force le re-téléchargement de tous les morceaux (« tout retélécharger »),
    /// même ceux déjà présents sur disque.
    pub force_redownload: bool,
    /// Nombre de segments parallèles (pour ETA réaliste).
    pub parallel_slots: usize,
}

impl Job {
    fn snapshot(&self) -> Task {
        let total = self.entries.len();
        let pending = self
            .entries
            .iter()
            .filter(|e| e.status == EntryStatus::Pending || e.status == EntryStatus::Running)
            .count();
        let done = self.done.min(total);
        let failed = self.failed;

        let progress = if total == 0 {
            0.0
        } else {
            (done as f64 / total as f64) * 100.0
        };

        let status = if self.cancelled.load(Ordering::Relaxed) {
            "cancelled".to_string()
        } else if total > 0 && self.running == 0 && pending == 0 {
            "completed".to_string()
        } else {
            "downloading".to_string()
        };

        let slots = self.parallel_slots.max(1) as f64;
        let eta_secs = if self.avg_track_ms > 0.0 {
            ((pending as f64 * self.avg_track_ms) / slots / 1000.0) as u64
        } else {
            0
        };

        let active: Vec<String> = self
            .current
            .iter()
            .filter(|s| !s.is_empty())
            .take(3)
            .cloned()
            .collect();
        let job_current = if !active.is_empty() {
            Some(active.join(" • "))
        } else if self.entries.is_empty() && !self.cancelled.load(Ordering::Relaxed) {
            Some("Récupération de la playlist...".to_string())
        } else {
            None
        };

        let speed: u64 = self.speeds.iter().sum();

        Task {
            id: self.id.clone(),
            url: self.url.clone(),
            title: if self.title.is_empty() {
                "Playlist".to_string()
            } else {
                self.title.clone()
            },
            media: self.media.clone(),
            video_format: self.video_format.clone(),
            status,
            progress,
            speed_bytes: speed,
            speed_mbps: speed as f64 / 1048576.0,
            eta: eta_secs,
            error: if failed > 0 {
                Some(format!("{failed} téléchargement(s) en échec"))
            } else {
                None
            },
            output_path: None,
            thumbnail: None,
            skipped: false,
            force_redownload: self.force_redownload,
            job_total: Some(total as u32),
            job_done: Some(done as u32),
            job_failed: Some(failed as u32),
            job_current,
            job_eta: Some(eta_secs),
            job_speed: Some(speed),
            job_tracks: {
                let v: Vec<JobTrack> = self.recent.iter().rev().cloned().collect();
                Some(v)
            },
        }
    }
}

/// Emet l'etat courant du job (snapshot -> moteur + sink).
fn push_state(inner: &Arc<Mutex<Inner>>, job_id: &str, notify: &Notify) {
    let snapshot = {
        let g = inner.lock().unwrap();
        let Some(job) = g.jobs.get(job_id) else {
            return;
        };
        let job = job.lock().unwrap();
        job.snapshot()
    };
    let mut g = inner.lock().unwrap();
    if let Some(t) = g.tasks.get_mut(job_id) {
        *t = snapshot.clone();
    }
    drop(g);
    notify(snapshot);
}

/// Démarre un Playlist-Job.
///
/// Phase 1 : résolution complète de la playlist (flat, sans limite).
/// Phase 2 : téléchargement en segments parallèles (max_concurrent segments),
/// rééquilibré par curseur partagé.
/// Démarre un Playlist-Job en mode audio (compatibilité : appel historique).
pub fn start_job(inner: &Arc<Mutex<Inner>>, url: &str, notify: Notify) -> Result<String, String> {
    start_job_with_media(inner, url, "audio", "best", notify)
}

/// Démarre un Playlist-Job en figeant le format choisi par l'utilisateur.
/// `media` vaut `audio` ou `video`, `video_format` la hauteur maximale.
///
/// Phase 1 : résolution complète de la playlist (flat, sans limite).
/// Phase 2 : téléchargement en segments parallèles (max_concurrent segments),
/// rééquilibré par curseur partagé.
pub fn start_job_with_media(
    inner: &Arc<Mutex<Inner>>,
    url: &str,
    media: &str,
    video_format: &str,
    notify: Notify,
) -> Result<String, String> {
    let media = crate::settings::normalize_media(Some(media));
    let video_format = crate::settings::normalize_video_format(Some(video_format));
    let id = crate::manager::new_task_id();

    let task = Task {
        id: id.clone(),
        url: url.to_string(),
        title: "Playlist".to_string(),
        media: media.clone(),
        video_format: video_format.clone(),
        status: "downloading".into(),
        progress: 0.0,
        speed_bytes: 0,
        speed_mbps: 0.0,
        eta: 0,
        error: None,
        output_path: None,
        thumbnail: None,
        skipped: false,
        force_redownload: false,
        job_total: Some(0),
        job_done: Some(0),
        job_failed: Some(0),
        job_current: Some("Récupération de la playlist...".into()),
        job_eta: Some(0),
        job_speed: Some(0),
        job_tracks: Some(vec![]),
    };

    {
        let mut g = inner.lock().unwrap();
        let job = Arc::new(Mutex::new(Job {
            id: id.clone(),
            url: url.to_string(),
            title: "Playlist".into(),
            media,
            video_format,
            entries: Vec::new(),
            cursor: 0,
            retry: VecDeque::new(),
            done: 0,
            failed: 0,
            running: 0,
            cancelled: AtomicBool::new(false),
            started: SystemTime::now(),
            last_emit: Mutex::new(Instant::now()),
            current: Vec::new(),
            speeds: Vec::new(),
            recent: VecDeque::new(),
            avg_track_ms: 0.0,
            force_redownload: false,
            parallel_slots: 1,
        }));
        g.jobs.insert(id.clone(), job);
        g.tasks.insert(id.clone(), task.clone());
        g.order.push(id.clone());
    }
    notify(task);

    let url_owned = url.to_string();
    let id_owned = id.clone();
    let inner2 = inner.clone();
    let notify2 = notify.clone();

    thread::spawn(move || resolve_and_run(inner2, notify2, url_owned, id_owned));

    Ok(id)
}

/// Résout la playlist puis lance les segments de téléchargement. Appelée au
/// démarrage d'un job ET lors d'un re-téléchargement forcé dont les morceaux
/// n'avaient pas encore été résolus.
fn resolve_and_run(inner: Arc<Mutex<Inner>>, notify: Notify, url: String, id: String) {
    let bin2 = inner.lock().unwrap().bin_dir.clone();
    // Résolution annulable : if `cancelled` est posé pendant l'analyse,
    // le process yt-dlp est tué (au lieu de laisser la résolution des
    // milliers de titres finir en arrière-plan).
    let stop = {
        let inner = inner.clone();
        let id = id.clone();
        move || {
            inner
                .lock()
                .unwrap()
                .jobs
                .get(&id)
                .map(|j| j.lock().unwrap().cancelled.load(Ordering::Relaxed))
                .unwrap_or(true)
        }
    };
    let resolved = ytdlp::analyze_cancelable(&bin2, &url, None, stop);

    match resolved {
        Ok(info) => {
            let entries: Vec<JobEntry> = if let Some(list) = info.entries {
                list.into_iter()
                    .map(|e| JobEntry {
                        // Préférer l'id YouTube (archive / noms uniques).
                        id: if !e.id.is_empty() {
                            e.id
                        } else {
                            e.url
                        },
                        title: e.title,
                        status: EntryStatus::Pending,
                        error: None,
                    })
                    .collect()
            } else {
                let single_url = info.url.clone().unwrap_or_else(|| url.clone());
                let vid = info.id.clone();
                vec![JobEntry {
                    id: if !vid.is_empty() { vid } else { single_url },
                    title: info.title.clone(),
                    status: EntryStatus::Pending,
                    error: None,
                }]
            };

            let title = if info.title.is_empty() {
                "Playlist".into()
            } else {
                info.title
            };

            let job = {
                let g = inner.lock().unwrap();
                g.jobs.get(&id).expect("job présent").clone()
            };
            let segments = {
                let g = inner.lock().unwrap();
                let max = g.max_concurrent.clamp(1, 16) as usize;
                max.min(entries.len().max(1))
            };

            {
                let mut j = job.lock().unwrap();
                j.title = title;
                j.entries = entries;
                j.parallel_slots = segments;
                j.current = vec![String::new(); segments];
                j.speeds = vec![0u64; segments];
            }

            push_state(&inner, &id, &notify);
            spawn_segments(&inner, job, segments, notify);
        }
        Err(e) => {
            let mut cancelled = false;
            {
                let g = inner.lock().unwrap();
                if let Some(j) = g.jobs.get(&id) {
                    let j = j.lock().unwrap();
                    j.cancelled.store(true, Ordering::Relaxed);
                    cancelled = true;
                }
            }
            let t = {
                let mut g = inner.lock().unwrap();
                if let Some(t) = g.tasks.get_mut(&id) {
                    if cancelled {
                        // Annulé volontairement pendant la résolution :
                        // PAS une erreur.
                        t.status = "cancelled".into();
                        t.error = None;
                    } else {
                        t.status = "error".into();
                        t.error = Some(format!("Analyse de la playlist impossible : {e}"));
                    }
                    Some(t.clone())
                } else {
                    None
                }
            };
            if let Some(t) = t {
                notify(t);
            }
        }
    }
}

fn spawn_segments(inner: &Arc<Mutex<Inner>>, job: Arc<Mutex<Job>>, n: usize, notify: Notify) {
    let (bin_dir, settings_snapshot) = {
        let g = inner.lock().unwrap();
        (g.bin_dir.clone(), g.settings.clone())
    };
    for slot in 0..n {
        let inner = inner.clone();
        let bin = bin_dir.clone();
        let settings = settings_snapshot.clone();
        let jobc = job.clone();
        let notify = notify.clone();
        thread::spawn(move || {
            segment_worker(inner, bin, settings, jobc, slot, notify);
        });
    }
}

fn segment_worker(
    inner: Arc<Mutex<Inner>>,
    bin_dir: PathBuf,
    settings: crate::settings::Settings,
    job: Arc<Mutex<Job>>,
    slot: usize,
    notify: Notify,
) {
    {
        let mut j = job.lock().unwrap();
        j.running += 1;
    }
    let job_id = {
        let j = job.lock().unwrap();
        j.id.clone()
    };
    push_state(&inner, &job_id, &notify);

    loop {
        // Prend le morceau suivant (file retry d'abord, puis curseur partagé)
        let next = {
            let mut j = job.lock().unwrap();
            if j.cancelled.load(Ordering::Relaxed) {
                break;
            }
            let i = if let Some(i) = j.retry.pop_front() {
                Some(i)
            } else if j.cursor < j.entries.len() {
                let i = j.cursor;
                j.cursor += 1;
                Some(i)
            } else {
                None
            };
            match i {
                Some(i) => {
                    let already = matches!(
                        j.entries.get(i).map(|e| e.status),
                        Some(EntryStatus::Done) | Some(EntryStatus::Running)
                    );
                    if already {
                        continue;
                    }
                    j.entries[i].status = EntryStatus::Running;
                    j.speeds[slot] = 0;
                    j.current[slot] = j.entries[i].title.clone();
                    Some((i, j.entries[i].id.clone(), j.entries[i].title.clone()))
                }
                None => break,
            }
        };
        let Some((idx, entry_id, title)) = next else {
            break;
        };

        // Attend une place dans le gouverneur GLOBAL de concurrence
        // (file de tâches simples + segments de jobs partagent la même limite).
        {
            let gov = inner.lock().unwrap().gov.clone();
            if !gov.try_acquire(|| job.lock().unwrap().cancelled.load(Ordering::Relaxed)) {
                push_state(&inner, &job_id, &notify);
                break;
            }
        }

        push_state(&inner, &job_id, &notify);

        let started = SystemTime::now();
        let url = ytdlp::entry_url(&entry_id);
        let video_id = ytdlp::extract_video_id(&entry_id)
            .or_else(|| ytdlp::extract_video_id(&url))
            .unwrap_or_default();

        if !video_id.is_empty() {
            let mut g = inner.lock().unwrap();
            if g.inflight.contains(&video_id) {
                let mut j = job.lock().unwrap();
                if let Some(e) = j.entries.get_mut(idx) {
                    e.status = EntryStatus::Failed;
                    e.error = Some("Déjà en cours de téléchargement.".into());
                }
                j.failed += 1;
                j.current[slot].clear();
                push_state(&inner, &job_id, &notify);
                continue;
            }
            g.inflight.insert(video_id.clone());
        }

        let (force, media, video_format) = {
            let j = job.lock().unwrap();
            (j.force_redownload, j.media.clone(), j.video_format.clone())
        };
        let max_concurrent = inner.lock().unwrap().max_concurrent;
        let opts = DownloadOpts {
            output_dir: &settings.output_dir,
            audio_format: &settings.audio_format,
            quality: &settings.quality,
            media: &media,
            video_format: &video_format,
            embed_thumbnail: settings.embed_thumbnail,
            embed_metadata: settings.embed_metadata,
            expected_title: Some(&title),
            force,
            video_id: if video_id.is_empty() {
                None
            } else {
                Some(video_id.as_str())
            },
            profile: &settings.download_profile,
            use_archive: settings.use_archive,
            auto_retry: settings.auto_retry,
            max_concurrent,
        };

        let job_progress = job.clone();
        let job_stop = job.clone();
        let inner2 = inner.clone();
        let notify2 = notify.clone();
        let id2 = job_id.clone();

        let result = ytdlp::download_track(
            &bin_dir,
            &opts,
            &url,
            started,
            move |p: &Progress| {
                let emit = {
                    let mut j = job_progress.lock().unwrap();
                    if slot < j.speeds.len() {
                        j.speeds[slot] = p.speed;
                    }
                    let mut le = j.last_emit.lock().unwrap();
                    let do_it = le.elapsed() >= THROTTLE;
                    if do_it {
                        *le = Instant::now();
                    }
                    do_it
                };
                if emit {
                    push_state(&inner2, &id2, &notify2);
                }
            },
            move || {
                let j = job_stop.lock().unwrap();
                j.cancelled.load(Ordering::Relaxed)
            },
        );

        if !video_id.is_empty() {
            inner.lock().unwrap().inflight.remove(&video_id);
        }

        let elapsed_ms = started
            .elapsed()
            .map(|d| d.as_millis() as f64)
            .unwrap_or(0.0);

        match result {
            Ok(_outcome) => {
                let mut j = job.lock().unwrap();
                if let Some(e) = j.entries.get_mut(idx) {
                    e.status = EntryStatus::Done;
                }
                j.done += 1;
                j.current[slot].clear();
                j.recent.push_front(JobTrack {
                    title: title.clone(),
                    status: "ok".into(),
                    error: None,
                });
                if j.recent.len() > RECENT_MAX {
                    j.recent.truncate(RECENT_MAX);
                }
                j.avg_track_ms = if j.avg_track_ms > 0.0 {
                    j.avg_track_ms * 0.85 + elapsed_ms * 0.15
                } else {
                    elapsed_ms
                };
            }
            Err(e) => {
                let mut j = job.lock().unwrap();
                if e.cancelled {
                    // Annulation volontaire : ce n'est PAS un échec.
                    j.current[slot].clear();
                } else {
                    if let Some(en) = j.entries.get_mut(idx) {
                        en.status = EntryStatus::Failed;
                        en.error = Some(e.message.clone());
                    }
                    j.failed += 1;
                    j.current[slot].clear();
                    j.recent.push_front(JobTrack {
                        title: title.clone(),
                        status: "error".into(),
                        error: Some(e.message),
                    });
                    if j.recent.len() > RECENT_MAX {
                        j.recent.truncate(RECENT_MAX);
                    }
                }
            }
        }

        // Rend la place du gouverneur global.
        inner.lock().unwrap().gov.release();

        push_state(&inner, &job_id, &notify);
    }

    {
        let mut j = job.lock().unwrap();
        j.running = j.running.saturating_sub(1);
    }
    push_state(&inner, &job_id, &notify);
}

/// Annule un Playlist-Job (les téléchargements en cours sont tués via should_stop).
pub fn cancel_job(inner: &Arc<Mutex<Inner>>, job_id: &str, notify: Notify) -> Result<(), String> {
    let exists = inner.lock().unwrap().jobs.contains_key(job_id);
    if !exists {
        return Err("Job introuvable".into());
    }

    {
        let g = inner.lock().unwrap();
        let j = g.jobs.get(job_id).unwrap();
        let mut j = j.lock().unwrap();
        j.cancelled.store(true, Ordering::Relaxed);
        j.running = 0;
        j.avg_track_ms = 0.0;
    }

    let task = {
        let g = inner.lock().unwrap();
        let j = g.jobs.get(job_id).unwrap();
        let j = j.lock().unwrap();
        j.snapshot()
    };
    let mut g = inner.lock().unwrap();
    if let Some(t) = g.tasks.get_mut(job_id) {
        *t = task.clone();
    }
    drop(g);
    notify(task);
    // Réveille les segments éventuellement bloqués dans le gouverneur global.
    inner.lock().unwrap().gov.wake();
    Ok(())
}

/// Relance les morceaux en échec.
pub fn retry_failed(inner: &Arc<Mutex<Inner>>, job_id: &str, notify: Notify) -> Result<(), String> {
    let exists = inner.lock().unwrap().jobs.contains_key(job_id);
    if !exists {
        return Err("Job introuvable".into());
    }

    // Job dont la résolution n'a jamais abouti : il n'y a aucun morceau en
    // échec à relancer, on rejoue donc l'analyse puis tout le téléchargement.
    let needs_resolve = {
        let g = inner.lock().unwrap();
        let j = g.jobs.get(job_id).unwrap();
        let j = j.lock().unwrap();
        j.entries.is_empty()
    };
    if needs_resolve {
        return retry_all(inner, job_id, notify);
    }

    let count;
    {
        let g = inner.lock().unwrap();
        let j = g.jobs.get(job_id).unwrap();
        let mut j = j.lock().unwrap();
        j.cancelled.store(false, Ordering::Relaxed);
        let mut indices: Vec<usize> = Vec::new();
        for (i, e) in j.entries.iter_mut().enumerate() {
            if e.status == EntryStatus::Failed {
                e.status = EntryStatus::Pending;
                e.error = None;
                indices.push(i);
            }
        }
        for i in indices {
            j.retry.push_back(i);
        }
        j.failed = 0;
        count = j.retry.len();
    }

    let task = {
        let g = inner.lock().unwrap();
        let j = g.jobs.get(job_id).unwrap();
        let j = j.lock().unwrap();
        j.snapshot()
    };
    let mut g = inner.lock().unwrap();
    if let Some(t) = g.tasks.get_mut(job_id) {
        *t = task.clone();
    }
    drop(g);
    notify(task);

    if count > 0 {
        let job = inner.lock().unwrap().jobs.get(job_id).cloned();
        if let Some(j) = job {
            let segments = {
                let g = inner.lock().unwrap();
                let max = g.max_concurrent.clamp(1, 16) as usize;
                let len = j.lock().unwrap().entries.len().max(1);
                let n = max.min(len);
                j.lock().unwrap().parallel_slots = n;
                n
            };
            spawn_segments(inner, j, segments, notify);
        }
    }
    Ok(())
}

/// Relance TOUT un Playlist-Job en re-téléchargement forcé : tous les morceaux
/// repassent en attente (même ceux déjà présents sur disque) et sont re-tirés
/// à neuf. Si la résolution n'avait jamais abouti, elle est relancée.
pub fn retry_all(inner: &Arc<Mutex<Inner>>, job_id: &str, notify: Notify) -> Result<(), String> {
    let (count, needs_resolve) = {
        let g = inner.lock().unwrap();
        if !g.jobs.contains_key(job_id) {
            return Err("Job introuvable".into());
        }
        let j = g.jobs.get(job_id).unwrap();
        let mut j = j.lock().unwrap();
        j.cancelled.store(false, Ordering::Relaxed);
        j.force_redownload = true;
        j.avg_track_ms = 0.0;

        if j.entries.is_empty() {
            // Résolution jamais achevée (échec/annulation) : on re-résout.
            j.retry.clear();
            (0, true)
        } else {
            let max = g.max_concurrent.clamp(1, 16) as usize;
            let n = max.min(j.entries.len().max(1));
            j.retry.clear();
            for i in 0..j.entries.len() {
                let e = &mut j.entries[i];
                e.status = EntryStatus::Pending;
                e.error = None;
                j.retry.push_back(i);
            }
            j.done = 0;
            j.failed = 0;
            j.parallel_slots = n;
            j.current = vec![String::new(); n];
            j.speeds = vec![0u64; n];
            let count = j.retry.len();
            (count, false)
        }
    };

    let task = {
        let g = inner.lock().unwrap();
        let j = g.jobs.get(job_id).unwrap();
        let j = j.lock().unwrap();
        j.snapshot()
    };
    {
        let mut g = inner.lock().unwrap();
        if let Some(t) = g.tasks.get_mut(job_id) {
            *t = task.clone();
        }
    }
    let job_url = task.url.clone();
    notify(task);

    if needs_resolve {
        let url = job_url;
        let id = job_id.to_string();
        let inner2 = inner.clone();
        thread::spawn(move || resolve_and_run(inner2, notify, url, id));
    } else if count > 0 {
        let job = inner.lock().unwrap().jobs.get(job_id).cloned();
        if let Some(j) = job {
            let segments = j.lock().unwrap().parallel_slots.max(1);
            spawn_segments(inner, j, segments, notify);
        }
    }
    Ok(())
}
