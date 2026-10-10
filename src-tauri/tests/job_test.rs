use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use yt_music_downloader_lib::job;
use yt_music_downloader_lib::manager::Manager;
use yt_music_downloader_lib::settings::Settings;

fn tmp_bin() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("bin")
}

/// Lance un Playlist-Job réel (radio -> playlist complète) avec 3 segments,
/// vérifie que la résolution + la segmentation fonctionnent, puis s'arrête.
#[test]
fn job_parallel_segments() {
    let out = std::env::temp_dir().join("ymd-job-out");
    let _ = std::fs::remove_dir_all(&out);
    let _ = std::fs::create_dir_all(&out);

    let settings = Settings {
        output_dir: out.to_string_lossy().into_owned(),
        audio_format: "128".into(),
        quality: "best".into(),
        default_media: "audio".into(),
        video_format: "best".into(),
        max_concurrent: 3,
        embed_thumbnail: false,
        embed_metadata: false,
        user_first_name: String::new(),
        user_last_name: String::new(),
        update_url: String::new(),
        download_profile: "balanced".into(),
        auto_concurrent: false,
        use_archive: true,
        auto_retry: true,
    };

    let manager = Arc::new(Manager::new(settings, tmp_bin()));
    let last = Arc::new(Mutex::new(None));
    let last2 = last.clone();
    let notify: job::Notify = Arc::new(move |t| {
        *last2.lock().unwrap() = Some(t);
    });

    let url = "https://www.youtube.com/watch?v=KFB9HV-Shw8&list=RDKFB9HV-Shw8&start_radio=1";
    let id = job::start_job(&manager.inner, url, notify).expect("start_job");

    let deadline = std::time::Instant::now() + Duration::from_secs(150);
    loop {
        let snapshot = last.lock().unwrap().clone();
        let running = {
            let g = manager.inner.lock().unwrap();
            g.tasks.get(&id).cloned()
        };
        let task = snapshot.or(running);

        if let Some(t) = &task {
            println!(
                "job: {} done={}/{} failed={} status={}",
                t.title,
                t.job_done.unwrap_or(0),
                t.job_total.unwrap_or(0),
                t.job_failed.unwrap_or(0),
                t.status
            );
            if t.status == "completed" {
                assert!(t.job_total.unwrap_or(0) > 0, "total should be > 0");
                assert_eq!(t.job_done, Some(t.job_total.unwrap()), "all done");
                assert_eq!(t.job_failed, Some(0), "no failures");
                println!("JOB COMPLETED: {}", t.job_done.unwrap_or(0));
                return;
            }
            if t.status == "error" {
                panic!("job error: {}", t.error.as_deref().unwrap_or("?"));
            }
            if t.status == "cancelled" {
                panic!("job cancelled unexpectedly");
            }
            // Bientôt terminé ? Si quasi complet avec échecs, on considère l'échec.
            // (non applicable en échec speaker ici)
        }

        if std::time::Instant::now() > deadline {
            // Temps imparti dépassé : on annule proprement et on vérifie
            // que la segmentation a bien avancé (au moins 3 titres par les 3 segments).
            let done = last
                .lock()
                .unwrap()
                .as_ref()
                .map(|t| t.job_done.unwrap_or(0))
                .unwrap_or(0);
            let notify2: job::Notify = Arc::new(|_| {});
            let _ = job::cancel_job(&manager.inner, &id, notify2);
            assert!(
                done >= 3,
                "expected at least 3 parallel downloads, got {done}"
            );
            println!("JOB TIMEOUT after {done} downloads (cancel ok)");
            return;
        }

        std::thread::sleep(Duration::from_millis(500));
    }
}
