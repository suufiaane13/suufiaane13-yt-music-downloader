use std::collections::{HashMap, HashSet, VecDeque};
use std::path::PathBuf;
use std::sync::{Arc, Condvar, Mutex};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Emitter};

use crate::job::Job;
use crate::models::Task;
use crate::settings::{self, Settings};
use crate::ytdlp::{self, DownloadOpts, Progress, TrackError};

pub struct Inner {
    pub tasks: HashMap<String, Task>,
    pub order: Vec<String>,
    pub max_concurrent: u32,
    pub settings: Settings,
    pub bin_dir: PathBuf,
    pub jobs: HashMap<String, Arc<Mutex<Job>>>,
    /// Gouverneur GLOBAL de concurrence (tâches simples + jobs confondus).
    pub gov: Arc<Gov>,
    /// video_id en cours de téléchargement (évite les courses même dossier).
    pub inflight: HashSet<String>,
}

/// État de la file d'attente, avec son propre mutex + condition (indépendant d'Inner).
pub struct QueueState {
    pub queue: VecDeque<String>,
    pub running: bool,
}

pub struct QueueSync {
    pub m: Mutex<QueueState>,
    pub cv: Condvar,
}

impl QueueSync {
    pub fn new() -> Self {
        Self {
            m: Mutex::new(QueueState {
                queue: VecDeque::new(),
                running: true,
            }),
            cv: Condvar::new(),
        }
    }

    pub fn notify(&self) {
        self.cv.notify_all();
    }
}

/// Sémaphore global : limite le nombre total de process yt-dlp actifs.
pub struct Gov {
    m: Mutex<(usize, u32)>, // (actifs, max_concurrent)
    cv: Condvar,
}

impl Gov {
    pub fn new(max_concurrent: u32) -> Self {
        Self {
            m: Mutex::new((0, max_concurrent.clamp(1, 16))),
            cv: Condvar::new(),
        }
    }

    /// Attend une place (bloque tant que la limite n'est pas repassée sous le max).
    pub fn acquire(&self) {
        let mut g = self.m.lock().unwrap();
        while (g.0 as u32) >= g.1 {
            g = self.cv.wait(g).unwrap();
        }
        g.0 += 1;
    }

    /// Comme `acquire`, mais abandonne si `stopped` devient vrai (ex. job annulé).
    /// Renvoie `true` si une place a été réservée, `false` si arrêt demandé.
    pub fn try_acquire(&self, stopped: impl Fn() -> bool) -> bool {
        let mut g = self.m.lock().unwrap();
        loop {
            if stopped() {
                return false;
            }
            if (g.0 as u32) < g.1 {
                g.0 += 1;
                return true;
            }
            g = self.cv.wait(g).unwrap();
        }
    }

    pub fn release(&self) {
        let mut g = self.m.lock().unwrap();
        g.0 = g.0.saturating_sub(1);
        self.cv.notify_all();
    }

    pub fn set_max(&self, max_concurrent: u32) {
        let mut g = self.m.lock().unwrap();
        g.1 = max_concurrent.clamp(1, 16);
        self.cv.notify_all();
    }

    /// Réveille les attenteurs (ex. après annulation d'un job).
    pub fn wake(&self) {
        self.cv.notify_all();
    }
}

pub struct Manager {
    pub inner: Arc<Mutex<Inner>>,
    pub qsync: Arc<QueueSync>,
    /// Cache des pochettes extraites (version + chemin + mtime).
    /// La version invalide le cache après un correctif du parseur APIC.
    pub covers: std::sync::Mutex<
        std::collections::HashMap<
            std::path::PathBuf,
            (u32, std::time::SystemTime, Option<String>),
        >,
    >,
}

const WORKER_THREADS: usize = 16;

impl Manager {
    pub fn new(settings: Settings, bin_dir: PathBuf) -> Self {
        let max = settings::effective_concurrency(&settings);
        let _ = std::fs::create_dir_all(&settings.output_dir);
        Self {
            inner: Arc::new(Mutex::new(Inner {
                tasks: HashMap::new(),
                order: Vec::new(),
                max_concurrent: max,
                settings,
                bin_dir,
                jobs: HashMap::new(),
                gov: Arc::new(Gov::new(max)),
                inflight: HashSet::new(),
            })),
            qsync: Arc::new(QueueSync::new()),
            covers: std::sync::Mutex::new(std::collections::HashMap::new()),
        }
    }

    pub fn start_workers(manager: Arc<Self>, app: AppHandle) {
        for _ in 0..WORKER_THREADS {
            let m = manager.clone();
            let a = app.clone();
            thread::spawn(move || m.worker_loop(&a));
        }
    }

    fn worker_loop(self: &Arc<Self>, app: &AppHandle) {
        loop {
            // 1) Prend une tâche (attend que la file soit non vide).
            let task_id = {
                let mut g = self.qsync.m.lock().unwrap();
                g = self
                    .qsync
                    .cv
                    .wait_while(g, |s| s.running && s.queue.is_empty())
                    .unwrap();
                if !g.running {
                    return;
                }
                let id = g.queue.pop_front().unwrap();
                id
            };

            // 2) Attend une place dans le gouverneur GLOBAL (jobs + file).
            let gov = self.inner.lock().unwrap().gov.clone();
            gov.acquire();

            self.run_task(app, &task_id);

            gov.release();
        }
    }

    pub fn emit_task(&self, app: &AppHandle, task: &Task) {
        let _ = app.emit("task-updated", task);
    }

    pub fn set_task<F: FnOnce(&mut Task)>(&self, app: &AppHandle, task_id: &str, f: F) {
        let updated = {
            let mut guard = self.inner.lock().unwrap();
            let Some(t) = guard.tasks.get_mut(task_id) else {
                return;
            };
            f(t);
            t.clone()
        };
        self.emit_task(app, &updated);
    }

    pub fn is_cancelled(&self, task_id: &str) -> bool {
        self.inner
            .lock()
            .unwrap()
            .tasks
            .get(task_id)
            .map(|t| t.status == "cancelled")
            .unwrap_or(true)
    }

    fn run_task(self: &Arc<Self>, app: &AppHandle, task_id: &str) {
        let (url, title, force, media, video_format) = {
            let guard = self.inner.lock().unwrap();
            match guard.tasks.get(task_id) {
                Some(t) if t.status != "cancelled" => (
                    t.url.clone(),
                    t.title.clone(),
                    t.force_redownload,
                    t.media.clone(),
                    t.video_format.clone(),
                ),
                _ => return,
            }
        };

        let (
            bin_dir,
            output_dir,
            audio_format,
            quality,
            embed_thumbnail,
            embed_metadata,
            profile,
            use_archive,
            auto_retry,
            max_concurrent,
        ) = {
            let guard = self.inner.lock().unwrap();
            let s = &guard.settings;
            (
                guard.bin_dir.clone(),
                s.output_dir.clone(),
                s.audio_format.clone(),
                s.quality.clone(),
                s.embed_thumbnail,
                s.embed_metadata,
                s.download_profile.clone(),
                s.use_archive,
                s.auto_retry,
                guard.max_concurrent,
            )
        };

        let video_id = ytdlp::extract_video_id(&url).unwrap_or_default();
        if !video_id.is_empty() {
            let mut guard = self.inner.lock().unwrap();
            if guard.inflight.contains(&video_id) {
                self.set_task(app, task_id, |t| {
                    t.status = "error".into();
                    t.error = Some(
                        "Ce média est déjà en cours de téléchargement.".into(),
                    );
                });
                return;
            }
            guard.inflight.insert(video_id.clone());
        }

        self.set_task(app, task_id, |t| {
            t.status = "downloading".into();
            t.speed_bytes = 0;
            t.speed_mbps = 0.0;
            t.eta = 0;
            t.force_redownload = false;
        });

        let started = SystemTime::now();
        let vid_ref = if video_id.is_empty() {
            None
        } else {
            Some(video_id.as_str())
        };
        let opts = DownloadOpts {
            output_dir: &output_dir,
            audio_format: &audio_format,
            quality: &quality,
            media: &media,
            video_format: &video_format,
            embed_thumbnail,
            embed_metadata,
            expected_title: Some(&title),
            force,
            video_id: vid_ref,
            profile: &profile,
            use_archive,
            auto_retry,
            max_concurrent,
        };

        let mgr_progress = self.clone();
        let id_progress = task_id.to_string();
        let mgr_stop = self.clone();
        let id_stop = id_progress.clone();
        let app_handle = app.clone();
        let last_emit = Arc::new(Mutex::new(Instant::now()));
        let result = ytdlp::download_track(
            &bin_dir,
            &opts,
            &url,
            started,
            move |p: &Progress| {
                let converting = p.pct >= 99.5;
                {
                    let mut last = last_emit.lock().unwrap();
                    if last.elapsed() < Duration::from_millis(100) {
                        return;
                    }
                    *last = Instant::now();
                }
                mgr_progress.set_task(&app_handle, &id_progress, |t| {
                    t.progress = p.pct;
                    t.speed_bytes = p.speed;
                    t.speed_mbps = p.speed as f64 / 1048576.0;
                    t.eta = p.eta;
                    if converting && t.status == "downloading" {
                        t.status = "converting".into();
                    }
                });
            },
            move || mgr_stop.is_cancelled(&id_stop),
        );

        if !video_id.is_empty() {
            self.inner.lock().unwrap().inflight.remove(&video_id);
        }

        let title_for_report = title.clone();
        match result {
            Ok(outcome) => {
                self.set_task(app, task_id, |t| {
                    t.status = "completed".into();
                    t.progress = 100.0;
                    t.speed_bytes = 0;
                    t.speed_mbps = 0.0;
                    t.eta = 0;
                    t.output_path = Some(outcome.path);
                    t.skipped = outcome.skipped;
                });
            }
            Err(TrackError {
                cancelled: true, ..
            }) => {
                self.set_task(app, task_id, |t| {
                    t.status = "cancelled".into();
                    t.speed_bytes = 0;
                    t.speed_mbps = 0.0;
                    t.eta = 0;
                });
            }
            Err(TrackError { message, .. }) => {
                let fallback = if message.trim().is_empty() {
                    format!("Échec du téléchargement de « {}", title_for_report)
                } else {
                    message
                };
                self.set_task(app, task_id, |t| {
                    t.status = "error".into();
                    t.error = Some(fallback);
                });
            }
        }
    }
}

/// Identifiant de tache simple (temps + compteur atomique).
pub fn new_task_id() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static SEQ: AtomicU64 = AtomicU64::new(0);
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let seq = SEQ.fetch_add(1, Ordering::SeqCst);
    format!("{:08x}{:04x}", now, seq & 0xFFFF)
}
