import type { Page } from "@playwright/test";

const DEFAULT_SETTINGS = {
  output_dir: "C:\\Music\\YT-Music-Downloader",
  audio_format: "320",
  quality: "best",
  default_media: "audio",
  video_format: "best",
  max_concurrent: 4,
  embed_thumbnail: false,
  embed_metadata: true,
  user_first_name: "Test",
  user_last_name: "USER",
  update_url: "",
  download_profile: "balanced",
  auto_concurrent: false,
  use_archive: true,
  auto_retry: true,
};

const ENGINE_OK = {
  ytDlp: true,
  ffmpeg: true,
  ffprobe: true,
  jsRuntime: true,
  binDir: "C:\\mock\\bin",
};

export type Overrides = {
  settings?: Partial<typeof DEFAULT_SETTINGS>;
  engine?: Partial<typeof ENGINE_OK> & { ytDlp?: boolean };
  tasks?: unknown[];
  music?: unknown[];
  searchItems?: unknown[];
};

/**
 * Injecte un mock Tauri minimal avant le chargement de React.
 * Enregistre chaque invoke dans `window.__YTMD_CALLS__` pour les assertions.
 */
export async function installTauriMock(page: Page, overrides: Overrides = {}) {
  const settings = { ...DEFAULT_SETTINGS, ...overrides.settings };
  const engine = { ...ENGINE_OK, ...overrides.engine };
  const tasks = overrides.tasks ?? [];
  const music = overrides.music ?? [];
  const searchItems = overrides.searchItems ?? [
    {
      id: "abc123",
      title: "Mock Track",
      channel: "Mock Channel",
      duration: 180,
      thumbnail: "",
      url: "https://www.youtube.com/watch?v=abc123",
      kind: "video",
      views: 1000,
    },
    {
      id: "PLmock",
      title: "Mock Playlist Result",
      channel: "Mock Channel",
      duration: null,
      thumbnail: "",
      url: "https://www.youtube.com/playlist?list=PLmock",
      kind: "playlist",
      views: null,
    },
  ];

  await page.addInitScript(
    ({ settings, engine, tasks, music, searchItems }) => {
      const calls: { cmd: string; args: unknown }[] = [];

      const handlers: Record<string, (args: any) => unknown> = {
        get_settings: () => settings,
        set_settings: (args: any) => {
          Object.assign(settings, args?.patch ?? args ?? {});
          return null;
        },
        get_tasks: () => tasks,
        check_engine: () => engine,
        list_music: () => music,
        check_owned: () => ({}),
        clear_completed: () => [],
        add_downloads: (args: any) => {
          const items = args?.items ?? [];
          return items.map((_: unknown, i: number) => `mock-task-${i + 1}`);
        },
        analyze_url: (args: any) => {
          const url = String(args?.url ?? "");
          const isPlaylist =
            url.includes("playlist") || url.includes("list=PL") || url.includes("/playlist");
          if (isPlaylist) {
            return {
              type: "playlist",
              id: "PLmockfull",
              title: "Mock Full Playlist",
              uploader: "Uploader",
              thumbnail: "",
              url: url || "https://www.youtube.com/playlist?list=PLmockfull",
              entries: [
                {
                  id: "vid1",
                  title: "Track One",
                  duration: 120,
                  url: "https://www.youtube.com/watch?v=vid1",
                  thumbnail: "",
                },
                {
                  id: "vid2",
                  title: "Track Two",
                  duration: 180,
                  url: "https://www.youtube.com/watch?v=vid2",
                  thumbnail: "",
                },
                {
                  id: "vid3",
                  title: "Track Three",
                  duration: 90,
                  url: "https://www.youtube.com/watch?v=vid3",
                  thumbnail: "",
                },
              ],
            };
          }
          return {
            type: "video",
            id: "abc123",
            title: "Analyzed Video",
            uploader: "Uploader",
            duration: 120,
            thumbnail: "",
            url: url || "https://www.youtube.com/watch?v=abc123",
          };
        },
        search_youtube: () => ({
          query: "test",
          items: searchItems,
          cached: false,
          elapsedMs: 12,
          hasMore: false,
        }),
        cancel_search: () => null,
        clear_search_cache: () => null,
        open_path: () => null,
        open_url: () => null,
        get_debug_log: () => ["mock log"],
        ytdlp_update: () => "2026.01.01",
        app_version: () => "1.0.0",
        export_m3u: () => "C:\\Music\\playlist.m3u",
        reorder_tasks: () => null,
        start_playlist_job: () => "job-playlist-1",
        cancel_task: () => null,
        cancel_all: () => null,
        retry_task: () => null,
        redownload_all: () => 0,
        redownload_failed: () => 0,
      };

      (window as any).__YTMD_CALLS__ = calls;

      (window as any).__TAURI_INTERNALS__ = {
        metadata: {
          currentWindow: { label: "main" },
          windows: [{ label: "main" }],
        },
        invoke: async (cmd: string, args?: unknown) => {
          if (typeof cmd === "string" && cmd.startsWith("plugin:")) {
            if (cmd.includes("is_maximized")) return false;
            if (cmd.includes("listen") || cmd.includes("unlisten")) return null;
            return null;
          }
          calls.push({ cmd, args });
          const h = handlers[cmd];
          if (!h) throw new Error(`Unmocked invoke: ${cmd}`);
          return h(args);
        },
        transformCallback: (cb: (v: unknown) => void) => {
          const id = Math.floor(Math.random() * 1e9);
          (window as any)[`_${id}`] = cb;
          return id;
        },
        unregisterCallback: () => {},
        convertFileSrc: (path: string) =>
          `https://asset.localhost/${encodeURIComponent(path)}`,
      };

      (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
        unregisterListener: () => {},
      };
    },
    { settings, engine, tasks, music, searchItems }
  );
}

export async function gotoApp(page: Page, overrides?: Overrides) {
  await installTauriMock(page, overrides);
  await page.goto("/");
  await page.waitForTimeout(1200);
}

/** Invokes enregistrés depuis le dernier chargement. */
export async function getInvokes(page: Page) {
  return page.evaluate(() => (window as any).__YTMD_CALLS__ as { cmd: string; args: unknown }[]);
}

export async function findInvoke(page: Page, cmd: string) {
  const calls = await getInvokes(page);
  return calls.filter((c) => c.cmd === cmd);
}
