use std::io::BufRead;
use std::path::PathBuf;
use std::process::Stdio;

use yt_music_downloader_lib::ytdlp;

fn bin() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("bin")
}

#[test]
fn smoke_analyze_video() {
    let info = ytdlp::analyze(&bin(), "https://www.youtube.com/watch?v=dQw4w9WgXcQ", None)
        .expect("analyze video");
    assert_eq!(info.kind, "video");
    assert!(!info.title.is_empty());
    println!("video: {} | {}", info.title, info.id);
}

#[test]
fn smoke_analyze_playlist() {
    let info = ytdlp::analyze(
        &bin(),
        "https://www.youtube.com/watch?v=KFB9HV-Shw8&list=RDKFB9HV-Shw8&start_radio=1",
        Some(5),
    )
    .expect("analyze playlist");
    assert_eq!(info.kind, "playlist");
    let entries = info.entries.expect("entries");
    assert!(!entries.is_empty());
    assert!(entries.len() <= 5);
    for e in &entries {
        assert!(!e.id.is_empty());
        assert!(e.thumbnail.starts_with("http"));
    }
    println!(
        "playlist: {} ({} entries) title[0]={}",
        info.title,
        entries.len(),
        entries[0].title
    );
}

#[test]
fn smoke_ytdlp_version() {
    let v = ytdlp::version(&bin());
    assert!(!v.is_empty(), "version should not be empty");
    println!("yt-dlp version: {v}");
}

#[test]
fn smoke_parse_progress() {
    let p = ytdlp::parse_progress_line("[45.3|123456|1000000|2345678|5]").unwrap();
    assert_eq!(p.pct, 45.3);
    assert_eq!(p.downloaded, 123456);
    assert_eq!(p.total, 1000000);
    assert_eq!(p.speed, 2345678);
    assert_eq!(p.eta, 5);
    assert!(ytdlp::parse_progress_line("normal text line").is_none());
}

#[test]
fn smoke_download() {
    let dir = std::env::temp_dir().join("ymd-smoke");
    let _ = std::fs::create_dir_all(&dir);

    let opts = ytdlp::DownloadOpts {
        output_dir: dir.to_str().unwrap(),
        audio_format: "128",
        quality: "best",
        media: "audio",
        video_format: "best",
        embed_thumbnail: true,
        embed_metadata: true,
        expected_title: None,
        force: false,
    };

    let args = ytdlp::download_args(&bin(), &opts, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    let mut child = ytdlp::raw_command(&bin())
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn");

    let stderr = child.stderr.take().expect("stderr");
    let (tx, rx) = std::sync::mpsc::channel::<f64>();
    std::thread::spawn(move || {
        let buf = std::io::BufReader::new(stderr);
        for line in buf.lines().map_while(Result::ok) {
            if let Some(p) = ytdlp::parse_progress_line(&line) {
                let _ = tx.send(p.pct);
            }
        }
    });

    let status = child.wait().expect("wait");
    assert!(status.success(), "yt-dlp exited with failure");
    drop(rx);

    let found = std::fs::read_dir(&dir)
        .unwrap()
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .any(|p| {
            p.extension()
                .map(|x| x.to_string_lossy().to_lowercase() == "mp3")
                .unwrap_or(false)
        });
    assert!(found, "no mp3 produced in {dir:?}");
    println!("mp3 OK in {dir:?}");
}

#[test]
fn smoke_download_track() {
    let dir = std::env::temp_dir().join("ymd-smoke-track");
    let _ = std::fs::remove_dir_all(&dir);
    let _ = std::fs::create_dir_all(&dir);
    let opts = ytdlp::DownloadOpts {
        output_dir: dir.to_str().unwrap(),
        audio_format: "128",
        quality: "best",
        media: "audio",
        video_format: "best",
        embed_thumbnail: true,
        embed_metadata: true,
        expected_title: None,
        force: false,
    };
    let started = std::time::SystemTime::now();
    let progress = std::sync::Arc::new(std::sync::Mutex::new(0.0f64));
    let p2 = progress.clone();
    let outcome = ytdlp::download_track(
        &bin(),
        &opts,
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        started,
        move |p: &ytdlp::Progress| {
            *p2.lock().unwrap() = p.pct;
        },
        || false,
    )
    .expect("download_track");
    assert!(
        std::path::Path::new(&outcome.path).exists(),
        "path exists: {}",
        outcome.path
    );
    assert!(*progress.lock().unwrap() > 0.0);
    println!("track: {}", outcome.path);
}
