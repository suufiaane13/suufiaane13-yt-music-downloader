import { test, expect } from "@playwright/test";
import { findInvoke, gotoApp } from "./tauri-mock";

/**
 * Parcours UI complet (mocks Tauri) :
 * vidéo MP3/MP4, playlist sélection + job, Explorer, Lecture mp3/m4a/mp4,
 * file téléchargements, profils Paramètres.
 */
test.describe("Parcours complet MP3 / MP4 / Playlists", () => {
  test("vidéo → téléchargement MP3", async ({ page }) => {
    await gotoApp(page);
    await page.getByTestId("nav-browse").click();
    const input = page.locator("[data-url-input]");
    await input.fill("https://www.youtube.com/watch?v=aqz-KE-bpKQ");
    await page.getByRole("button", { name: "Analyser" }).click();
    await expect(page.getByText("Analyzed Video")).toBeVisible({ timeout: 10_000 });

    await page.getByRole("group", { name: "Format de téléchargement" }).getByRole("button", { name: "MP3" }).click();
    await page.getByRole("button", { name: /Télécharger en MP3/i }).click();

    const adds = await findInvoke(page, "add_downloads");
    expect(adds.length).toBeGreaterThan(0);
    const items = (adds[adds.length - 1].args as { items: { media: string }[] }).items;
    expect(items[0].media).toBe("audio");
  });

  test("vidéo → téléchargement MP4 720p", async ({ page }) => {
    await gotoApp(page);
    await page.getByTestId("nav-browse").click();
    await page.locator("[data-url-input]").fill("https://youtu.be/dQw4w9WgXcQ");
    await page.getByRole("button", { name: "Analyser" }).click();
    await expect(page.getByText("Analyzed Video")).toBeVisible({ timeout: 10_000 });

    const formatGroup = page.getByRole("group", { name: "Format de téléchargement" });
    await formatGroup.getByRole("button", { name: "MP4" }).click();
    // Compact UI affiche "720" ; non-compact "720p".
    await page.getByRole("button", { name: /^720p?$/ }).first().click();
    await page.getByRole("button", { name: /Télécharger en MP4/i }).click();

    const adds = await findInvoke(page, "add_downloads");
    expect(adds.length).toBeGreaterThan(0);
    const items = (
      adds[adds.length - 1].args as { items: { media: string; videoFormat: string }[] }
    ).items;
    expect(items[0].media).toBe("video");
    expect(items[0].videoFormat).toBe("720");
  });

  test("playlist → sélection MP3 (add_downloads)", async ({ page }) => {
    await gotoApp(page);
    await page.getByTestId("nav-browse").click();
    await page
      .locator("[data-url-input]")
      .fill("https://www.youtube.com/playlist?list=PLmockfull");
    await page.getByRole("button", { name: "Analyser" }).click();
    await expect(page.getByText("Mock Full Playlist")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Track One")).toBeVisible();
    await expect(page.getByText("Track Two")).toBeVisible();

    await page.getByRole("group", { name: "Format de téléchargement" }).getByRole("button", { name: "MP3" }).click();
    await page.getByRole("button", { name: /Télécharger 3 titres en MP3/i }).click();

    const adds = await findInvoke(page, "add_downloads");
    expect(adds.length).toBeGreaterThan(0);
    const items = (adds[adds.length - 1].args as { items: unknown[] }).items;
    expect(items).toHaveLength(3);
  });

  test("playlist → job parallèle MP4 (start_playlist_job)", async ({ page }) => {
    await gotoApp(page);
    await page.getByTestId("nav-browse").click();
    await page
      .locator("[data-url-input]")
      .fill("https://www.youtube.com/playlist?list=PLjob");
    await page.getByRole("button", { name: "Analyser" }).click();
    await expect(page.getByText("Mock Full Playlist")).toBeVisible({ timeout: 10_000 });

    await page.getByRole("group", { name: "Format de téléchargement" }).getByRole("button", { name: "MP4" }).click();
    await page.getByRole("button", { name: /Tout en MP4/i }).click();

    const jobs = await findInvoke(page, "start_playlist_job");
    expect(jobs.length).toBeGreaterThan(0);
    const args = jobs[jobs.length - 1].args as {
      url: string;
      media: string;
      videoFormat: string;
    };
    expect(args.media).toBe("video");
    expect(args.url).toContain("playlist");
  });

  test("Explorer → recherche vidéo + playlist", async ({ page }) => {
    await gotoApp(page);
    await page.getByTestId("nav-explore").click();
    await page.getByPlaceholder(/Rechercher une chanson/i).fill("lofi");
    await page.getByRole("button", { name: /Rechercher/i }).click();
    await expect(page.getByText("Mock Track")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Mock Playlist Result")).toBeVisible();

    const searches = await findInvoke(page, "search_youtube");
    expect(searches.length).toBeGreaterThan(0);
  });

  test("Lecture → mp3 + m4a + mp4 + filtres + export M3U", async ({ page }) => {
    await gotoApp(page, {
      music: [
        {
          name: "Song.mp3",
          path: "C:\\Music\\Song.mp3",
          sizeBytes: 1000,
          duration: 120,
          kind: "audio",
        },
        {
          name: "Fast.m4a",
          path: "C:\\Music\\Fast.m4a",
          sizeBytes: 800,
          duration: 90,
          kind: "audio",
        },
        {
          name: "Clip.mp4",
          path: "C:\\Music\\Clip.mp4",
          sizeBytes: 5000,
          duration: 60,
          kind: "video",
        },
      ],
    });
    await page.getByTestId("nav-lecture").click();
    await expect(page.getByText("Song", { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Fast", { exact: true })).toBeVisible();
    await expect(page.getByText("Clip", { exact: true })).toBeVisible();

    await page.getByTestId("lecture-filter-audio").click();
    await expect(page.getByText("Song", { exact: true })).toBeVisible();
    await expect(page.getByText("Fast", { exact: true })).toBeVisible();
    await expect(page.getByText("Clip", { exact: true })).toHaveCount(0);

    await page.getByTestId("lecture-filter-video").click();
    await expect(page.getByText("Clip", { exact: true })).toBeVisible();
    await expect(page.getByText("Song", { exact: true })).toHaveCount(0);

    await page.getByTestId("lecture-filter-all").click();
    await page.getByTestId("export-m3u").click();
    const exports = await findInvoke(page, "export_m3u");
    expect(exports.length).toBeGreaterThan(0);
  });

  test("Téléchargements → file job playlist + filtres", async ({ page }) => {
    await gotoApp(page, {
      tasks: [
        {
          id: "t-audio",
          url: "https://youtu.be/a",
          title: "Audio Done",
          status: "completed",
          progress: 100,
          speed_bytes: 0,
          speed_mbps: 0,
          eta: 0,
          media: "audio",
          video_format: "best",
        },
        {
          id: "t-video",
          url: "https://youtu.be/b",
          title: "Video Fail",
          status: "error",
          progress: 40,
          speed_bytes: 0,
          speed_mbps: 0,
          eta: 0,
          media: "video",
          video_format: "720",
          error: "Format introuvable",
        },
        {
          id: "job-1",
          url: "https://www.youtube.com/playlist?list=PL",
          title: "Big Playlist",
          status: "downloading",
          progress: 35,
          speed_bytes: 1_000_000,
          speed_mbps: 1,
          eta: 120,
          media: "audio",
          video_format: "best",
          job_total: 100,
          job_done: 35,
          job_failed: 1,
          job_current: "Track 36",
        },
      ],
    });
    await page.getByTestId("nav-downloads").click();
    await expect(page.getByTestId("downloads-page")).toBeVisible();
    await expect(page.getByText("Audio Done").first()).toBeVisible();
    await expect(page.getByText("Video Fail").first()).toBeVisible();
    await expect(page.getByText("Big Playlist").first()).toBeVisible();

    await page.getByTestId("dl-search").fill("Playlist");
    await expect(page.getByText("Big Playlist").first()).toBeVisible();
    await expect(page.getByText("Audio Done")).toHaveCount(0);
  });

  test("Paramètres → profils Rapide / Équilibré / Qualité", async ({ page }) => {
    await gotoApp(page);
    await page.getByTestId("nav-settings").click();
    const profiles = page.getByTestId("download-profile");
    await expect(profiles).toBeVisible();
    await expect(profiles.getByRole("button", { name: /Rapide/i })).toBeVisible();
    await expect(profiles.getByRole("button", { name: /Équilibré/i })).toBeVisible();
    await expect(profiles.getByRole("button", { name: /Qualité/i })).toBeVisible();
    await profiles.getByRole("button", { name: /Rapide/i }).click();
    await page.getByRole("button", { name: /Enregistrer les réglages/i }).click();
    const sets = await findInvoke(page, "set_settings");
    expect(sets.length).toBeGreaterThan(0);
  });

  test("bannière JS manquant (deno)", async ({ page }) => {
    await gotoApp(page, {
      engine: { ytDlp: true, ffmpeg: true, ffprobe: true, jsRuntime: false },
    });
    await expect(page.getByTestId("engine-ok")).toBeVisible();
    await expect(page.getByTestId("engine-js-missing")).toBeVisible();
  });
});
