import { invoke } from "@tauri-apps/api/core";

export interface JobTrack {
  title: string;
  status: "ok" | "error" | "downloading";
  error?: string;
}

/** Type de média demandé au moteur : audio (MP3) ou video (MP4). */
export type MediaKind = "audio" | "video";

export interface Task {
  id: string;
  url: string;
  title: string;
  /** Format figé au lancement de la tâche (les réglages peuvent changer ensuite). */
  media?: MediaKind;
  /** Hauteur max MP4 figée au lancement : best | 1080 | 720 | 480. */
  video_format?: string;
  status: "queued" | "downloading" | "converting" | "completed" | "error" | "cancelled";
  progress: number;
  speed_bytes: number;
  speed_mbps: number;
  eta: number;
  error?: string;
  output_path?: string;
  thumbnail?: string;
  skipped?: boolean;
  job_total?: number;
  job_done?: number;
  job_failed?: number;
  job_current?: string;
  job_eta?: number;
  job_speed?: number;
  job_tracks?: JobTrack[];
}

export type DownloadProfile = "fast" | "balanced" | "quality";

export interface Settings {
  output_dir: string;
  audio_format: string;
  quality: string;
  /** Format proposé par défaut dans les pages de téléchargement. */
  default_media: MediaKind;
  /** Résolution maximale des téléchargements MP4. */
  video_format: string;
  max_concurrent: number;
  embed_thumbnail: boolean;
  embed_metadata: boolean;
  user_first_name: string;
  user_last_name: string;
  /** URL JSON `{ version, url }` pour vérifier les mises à jour de l'app. */
  update_url: string;
  /** Profil vitesse / qualité des téléchargements. */
  download_profile: DownloadProfile;
  /** Concurrence calculée selon CPU + profil. */
  auto_concurrent: boolean;
  /** Archive par video_id (skip fiable). */
  use_archive: boolean;
  /** Réessais automatiques sur erreurs transitoires. */
  auto_retry: boolean;
}

export interface EngineCheck {
  ytDlp: boolean;
  ffmpeg: boolean;
  ffprobe: boolean;
  jsRuntime: boolean;
  binDir: string;
}

export interface MusicFile {
  name: string;
  path: string;
  sizeBytes: number;
  duration: number;
  /** `audio` (MP3) ou `video` (MP4). */
  kind?: MediaKind;
  cover?: string | null;
}

export const DEFAULT_SETTINGS: Settings = {
  output_dir: "",
  audio_format: "320",
  quality: "best",
  default_media: "audio",
  video_format: "best",
  max_concurrent: 8,
  embed_thumbnail: true,
  embed_metadata: true,
  user_first_name: "",
  user_last_name: "",
  update_url: "",
  download_profile: "balanced",
  auto_concurrent: false,
  use_archive: true,
  auto_retry: true,
};

/** « Prénom Nom », ou chaîne vide si non renseigné. */
export function formatUserName(user: {
  user_first_name?: string | null;
  user_last_name?: string | null;
}): string {
  const first = (user.user_first_name ?? "").trim();
  const last = (user.user_last_name ?? "").trim();
  return [first, last].filter(Boolean).join(" ");
}

export function mediaKindOf(file: Pick<MusicFile, "kind" | "name" | "path">): MediaKind {
  if (file.kind === "video" || file.kind === "audio") return file.kind;
  const n = (file.name || file.path || "").toLowerCase();
  return n.endsWith(".mp4") ? "video" : "audio";
}

export interface VideoEntry {
  id: string;
  title: string;
  duration: number | null;
  url: string;
  thumbnail: string;
}

export interface VideoInfo {
  type: "video" | "playlist";
  id?: string;
  title: string;
  uploader: string;
  thumbnail?: string;
  duration?: number | null;
  url?: string;
  entries?: VideoEntry[];
}

export function fetchInfo(url: string): Promise<VideoInfo> {
  return invoke<VideoInfo>("analyze_url", { url });
}

// ---------------------------------------------------------------------------
// Recherche YouTube (page « Explorer »)
// ---------------------------------------------------------------------------

export type SearchTab = "video" | "playlist";

export interface SearchItem {
  id: string;
  title: string;
  channel: string;
  duration?: number | null;
  thumbnail: string;
  url: string;
  kind: "video" | "playlist";
  views?: number | null;
}

export interface SearchPage {
  query: string;
  items: SearchItem[];
  cached: boolean;
  elapsedMs: number;
  hasMore: boolean;
}

export function searchYoutube(query: string, tab: SearchTab, limit: number): Promise<SearchPage> {
  return invoke<SearchPage>("search_youtube", { query, tab, limit });
}

export function cancelSearch(): Promise<void> {
  return invoke<void>("cancel_search");
}

export function clearSearchCache(): Promise<void> {
  return invoke<void>("clear_search_cache");
}

/** Ouvre un lien YouTube dans le navigateur du système (hôte validé côté Rust). */
export function openExternalUrl(url: string): Promise<void> {
  return invoke<void>("open_url", { url });
}

export interface DownloadItem {
  url: string;
  title?: string;
  thumbnail?: string;
  /** Absent = MP3. Le moteur fige ce format sur la tâche. */
  media?: MediaKind;
  videoFormat?: string;
}

export function startDownload(
  url: string,
  title?: string,
  thumbnail?: string,
  media: MediaKind = "audio",
  videoFormat = "best"
): Promise<string[]> {
  return invoke<string[]>("add_downloads", {
    items: [{ url, title, thumbnail, media, videoFormat }],
  });
}

export function startBatchDownload(items: DownloadItem[]): Promise<string[]> {
  return invoke<string[]>("add_downloads", { items });
}

export function cancelTask(taskId: string): Promise<void> {
  return invoke("cancel_task", { taskId });
}

export function clearCompleted(): Promise<string[]> {
  return invoke<string[]>("clear_completed");
}

export function startPlaylistJob(
  url: string,
  media: MediaKind = "audio",
  videoFormat = "best"
): Promise<string> {
  return invoke<string>("start_playlist_job", { url, media, videoFormat });
}

export function cancelJob(jobId: string): Promise<void> {
  return invoke("cancel_job", { jobId });
}

export function retryTask(taskId: string): Promise<void> {
  return invoke("retry_task", { taskId });
}

export function cancelAll(): Promise<void> {
  return invoke("cancel_all");
}

export function retryFailed(jobId: string): Promise<void> {
  return invoke("retry_failed", { jobId });
}

export function redownloadAll(): Promise<number> {
  return invoke<number>("redownload_all");
}

/** Relance uniquement les téléchargements en échec (vidéos et morceaux de playlist). */
export function redownloadFailed(): Promise<number> {
  return invoke<number>("redownload_failed");
}

export function getSettings(): Promise<Settings> {
  return invoke<Settings>("get_settings");
}

export function checkEngine(): Promise<EngineCheck> {
  return invoke<EngineCheck>("check_engine");
}

export function updateSettings(patch: Partial<Settings>): Promise<void> {
  return invoke("set_settings", { patch });
}

export function getTasks(): Promise<Task[]> {
  return invoke<Task[]>("get_tasks");
}

export function ytdlpUpdate(): Promise<string> {
  return invoke<string>("ytdlp_update");
}

export function getDebugLog(n: number = 60): Promise<string[]> {
  return invoke<string[]>("get_debug_log", { n });
}

export function openPath(path: string): Promise<void> {
  return invoke<void>("open_path", { path });
}

export function listMusic(): Promise<MusicFile[]> {
  return invoke<MusicFile[]>("list_music");
}

/** video_id → chemin local (ou marqueur archive) pour les titres déjà présents. */
export function checkOwned(
  items: { id: string; title: string; media?: MediaKind }[]
): Promise<Record<string, string>> {
  return invoke<Record<string, string>>("check_owned", { items });
}

export function reorderTasks(ids: string[]): Promise<void> {
  return invoke<void>("reorder_tasks", { ids });
}

export function exportM3u(): Promise<string> {
  return invoke<string>("export_m3u");
}

export function appVersion(): Promise<string> {
  return invoke<string>("app_version");
}