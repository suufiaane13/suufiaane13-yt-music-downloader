import { spawnSync } from "node:child_process";
import { mkdtempSync, existsSync, readdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const bin = join(root, "src-tauri", "bin");
const ytdlp = join(bin, "yt-dlp.exe");
const ffmpeg = join(bin, "ffmpeg.exe");

// Courte vidéo CC (Big Buck Bunny trailer excerpt via YouTube)
const URL = "https://www.youtube.com/watch?v=aqz-KE-bpKQ";

function run(cmd, args, cwd) {
  console.log(`> ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, {
    cwd,
    encoding: "utf8",
    timeout: 180_000,
    windowsHide: true,
  });
  if (r.stdout) process.stdout.write(r.stdout.slice(-2000));
  if (r.stderr) process.stderr.write(r.stderr.slice(-2000));
  if (r.status !== 0) {
    throw new Error(`Command failed (${r.status}): ${cmd}`);
  }
}

function main() {
  if (!existsSync(ytdlp) || !existsSync(ffmpeg)) {
    throw new Error(`Binaires manquants dans ${bin}`);
  }
  const out = mkdtempSync(join(tmpdir(), "ytmd-smoke-"));
  console.log("Dossier smoke:", out);

  try {
    run(ytdlp, [
      "-f",
      "bestaudio[ext=m4a]/bestaudio/best",
      "-x",
      "--audio-format",
      "mp3",
      "--audio-quality",
      "192K",
      "--ffmpeg-location",
      bin,
      "--no-playlist",
      "-o",
      join(out, "%(title).80s.%(ext)s"),
      URL,
    ], out);

    const mp3s = readdirSync(out).filter((f) => f.toLowerCase().endsWith(".mp3"));
    if (!mp3s.length) throw new Error("Aucun MP3 produit");
    console.log("OK MP3:", mp3s[0]);

    run(ytdlp, [
      "-f",
      "bv*[height<=360][ext=mp4]+ba[ext=m4a]/b[height<=360]",
      "--merge-output-format",
      "mp4",
      "--ffmpeg-location",
      bin,
      "--no-playlist",
      "-o",
      join(out, "video-%(title).60s.%(ext)s"),
      URL,
    ], out);

    const mp4s = readdirSync(out).filter((f) => f.toLowerCase().endsWith(".mp4"));
    if (!mp4s.length) throw new Error("Aucun MP4 produit");
    console.log("OK MP4:", mp4s[0]);
    console.log("SMOKE DOWNLOAD OK");
  } finally {
    try {
      rmSync(out, { recursive: true, force: true });
    } catch {
      /* keep for debug */
    }
  }
}

main();
