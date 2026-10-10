pub mod commands;
pub mod debuglog;
pub mod history;
pub mod job;
pub mod manager;
pub mod models;
pub mod paths;
pub mod search_cache;
pub mod settings;
pub mod youtube_search;
pub mod ytdlp;

use std::sync::Arc;

use tauri::menu::{MenuBuilder, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager as _};

use crate::manager::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    crate::debuglog::log("== démarrage de l'application ==");
    if let Ok(exe) = std::env::current_exe() {
        crate::debuglog::log(format!("exe : {}", exe.display()));
    }
    if let Ok(cwd) = std::env::current_dir() {
        crate::debuglog::log(format!("cwd : {}", cwd.display()));
    }
    for p in paths::probe() {
        crate::debuglog::log(format!(
            "candidat bin : {} | yt-dlp={} ffmpeg={} ffprobe={}",
            p.dir.display(),
            p.yt_dlp,
            p.ffmpeg,
            p.ffprobe
        ));
    }
    let settings = settings::load();
    let bin_dir =
        paths::bin_dir().unwrap_or_else(|| std::env::current_dir().unwrap_or_default().join("bin"));
    crate::debuglog::log(format!(
        "bin_dir retenu : {} | yt-dlp={} ffmpeg={} ffprobe={}",
        bin_dir.display(),
        bin_dir.join("yt-dlp.exe").is_file(),
        bin_dir.join("ffmpeg.exe").is_file(),
        bin_dir.join("ffprobe.exe").is_file()
    ));
    let manager = Arc::new(Manager::new(settings, bin_dir));
    let manager_save = manager.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .manage(manager.clone())
        // Fermer la fenêtre = masquer dans le bac (les téléchargements
        // continuent). « Quitter » du menu tray termine vraiment l'app.
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_tasks,
            commands::get_settings,
            commands::check_engine,
            commands::set_settings,
            commands::analyze_url,
            commands::search_youtube,
            commands::cancel_search,
            commands::clear_search_cache,
            commands::open_url,
            commands::add_downloads,
            commands::cancel_task,
            commands::clear_completed,
            commands::start_playlist_job,
            commands::cancel_job,
            commands::retry_failed,
            commands::retry_task,
            commands::redownload_all,
            commands::redownload_failed,
            commands::cancel_all,
            commands::ytdlp_update,
            commands::get_debug_log,
            commands::open_path,
            commands::list_music,
            commands::check_owned,
            commands::reorder_tasks,
            commands::export_m3u,
            commands::app_version,
        ])
        .setup(move |app| {
            // Reprend l'historique sauvegardé au précédent lancement : les
            // tâches terminales (terminées / annulées) sont réaffichées, les
            // tâches actives (statut `queued`) sont remises en file.
            // Les Playlist-Jobs actifs sont relancés via le moteur de job
            // (pas la file simple, qui force `--no-playlist`).
            let mut resume_jobs: Vec<(String, String, String)> = Vec::new();
            {
                let records = history::load();
                let mut guard = manager.inner.lock().unwrap();
                let mut q = manager.qsync.m.lock().unwrap();
                for mut task in records {
                    let id = if task.id.is_empty() {
                        let nid = crate::manager::new_task_id();
                        task.id = nid.clone();
                        nid
                    } else {
                        task.id.clone()
                    };
                    let is_playlist_job =
                        task.status == "queued" && task.job_total.is_some();
                    if is_playlist_job {
                        resume_jobs.push((
                            task.url.clone(),
                            task.media.clone(),
                            task.video_format.clone(),
                        ));
                        continue;
                    }
                    let requeue = task.status == "queued";
                    guard.tasks.insert(id.clone(), task);
                    guard.order.push(id.clone());
                    if requeue {
                        q.queue.push_back(id);
                    }
                }
                drop(q);
                drop(guard);
                manager.qsync.notify();
            }

            let handle = app.handle().clone();
            Manager::start_workers(manager.clone(), handle.clone());

            for (url, media, video_format) in resume_jobs {
                let notify: crate::job::Notify = {
                    let h = handle.clone();
                    Arc::new(move |t| {
                        let _ = h.emit("task-updated", &t);
                    })
                };
                if let Err(e) = crate::job::start_job_with_media(
                    &manager.inner,
                    &url,
                    &media,
                    &video_format,
                    notify,
                ) {
                    crate::debuglog::log(format!(
                        "reprise playlist échouée ({url}) : {e}"
                    ));
                }
            }

            // Icône dans la barre système : le téléchargement continue quand la
            // fenêtre est réduite dans le bac, puis un clic réaffiche l'app.
            let show = MenuItem::with_id(app, "show", "Afficher", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quitter", true, None::<&str>)?;
            let tray_menu = MenuBuilder::new(app).items(&[&show, &quit]).build()?;
            let icon = app
                .default_window_icon()
                .cloned()
                .ok_or("Icône de l'application introuvable")?;
            TrayIconBuilder::new()
                .icon(icon)
                .tooltip("YT Music Downloader")
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| {
                    let label = event.id().as_ref();
                    if label == "show" {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    } else if label == "quit" {
                        app.exit(0);
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        if let Some(w) = tray.app_handle().get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                })
                .build(app)?;

            // Mise à jour automatique et silencieuse de yt-dlp en
            // arrière-plan. `-U` ne télécharge que si une nouvelle version
            // existe ; en cas d'échec (hors ligne…) on ignore simplement.
            // Décalée de quelques secondes pour ne pas entrer en contention
            // avec le contrôle du moteur et la lecture de version au boot.
            {
                let bin = manager.inner.lock().unwrap().bin_dir.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_secs(5));
                    let _ = crate::ytdlp::update(&bin);
                });
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(move |_, event| {
            if let tauri::RunEvent::Exit = event {
                // Sauvegarde la file d'attente (historique complet : en cours,
                // terminées et annulées) au moment de quitter.
                let guard = manager_save.inner.lock().unwrap();
                crate::history::save(&guard);
            }
        });
}
