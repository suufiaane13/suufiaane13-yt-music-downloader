import { memo, useEffect, useRef, useState, type CSSProperties } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  Settings as SettingsType,
  EngineCheck,
  appVersion,
  checkEngine,
  getDebugLog,
  openPath,
  updateSettings,
  ytdlpUpdate,
  type DownloadProfile,
  type MediaKind,
} from "../services/api";
import { toastSuccess, toastError, toastWarning } from "./Toasts";
import { useCompact } from "../hooks/useCompact";

interface Props {
  settings: SettingsType;
  onSettingsChange: (s: SettingsType) => void;
  engine?: EngineCheck | null;
}

const FORMAT_OPTIONS = [
  { value: "128", label: "128", desc: "Léger" },
  { value: "192", label: "192", desc: "Standard" },
  { value: "256", label: "256", desc: "Haut" },
  { value: "320", label: "320", desc: "Max" },
];

const VIDEO_FORMAT_OPTIONS = [
  { value: "best", label: "Meilleure", desc: "yt-dlp choisit" },
  { value: "1080", label: "1080p", desc: "Full HD" },
  { value: "720", label: "720p", desc: "HD" },
  { value: "480", label: "480p", desc: "Léger" },
];

const PROFILE_OPTIONS: { value: DownloadProfile; label: string; desc: string }[] = [
  { value: "fast", label: "Rapide", desc: "M4A, sans embeds — playlists longues" },
  { value: "balanced", label: "Équilibré", desc: "MP3 + métadonnées" },
  { value: "quality", label: "Qualité", desc: "MP3 max + options fichiers" },
];

export default memo(function Settings({ settings, onSettingsChange, engine }: Props) {
  const [dirDraft, setDirDraft] = useState(settings.output_dir);
  const [concDraft, setConcDraft] = useState(settings.max_concurrent);
  const [fmtDraft, setFmtDraft] = useState(settings.audio_format);
  const [mediaDraft, setMediaDraft] = useState<MediaKind>(settings.default_media);
  const [videoFmtDraft, setVideoFmtDraft] = useState(settings.video_format);
  const [thumbDraft, setThumbDraft] = useState(settings.embed_thumbnail);
  const [metaDraft, setMetaDraft] = useState(settings.embed_metadata);
  const [profileDraft, setProfileDraft] = useState<DownloadProfile>(
    settings.download_profile || "balanced"
  );
  const [autoConcDraft, setAutoConcDraft] = useState(!!settings.auto_concurrent);
  const [archiveDraft, setArchiveDraft] = useState(settings.use_archive !== false);
  const [retryDraft, setRetryDraft] = useState(settings.auto_retry !== false);
  const [firstDraft, setFirstDraft] = useState(settings.user_first_name);
  const [lastDraft, setLastDraft] = useState(settings.user_last_name);
  const [updateUrlDraft, setUpdateUrlDraft] = useState(settings.update_url || "");
  const [version, setVersion] = useState("…");
  const [checkingAppUpdate, setCheckingAppUpdate] = useState(false);
  const { compact, setCompact } = useCompact();
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [engineFresh, setEngineFresh] = useState<EngineCheck | null>(null);
  const [rechecking, setRechecking] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [debugOpen, setDebugOpen] = useState(false);
  const [debugLines, setDebugLines] = useState<string[] | null>(null);
  const [debugLoading, setDebugLoading] = useState(false);
  const saveTimer = useRef<number | null>(null);

  // Reste synchronisé sur le contrôle périodique du moteur (poll 5 s) tout en
  // acceptant une vérification manuelle via « Re-vérifier ».
  useEffect(() => {
    setEngineFresh(engine ?? null);
  }, [engine]);

  // Recalque les brouillons sur les réglages appliqués (après une
  // sauvegarde ou un rechargement).
  useEffect(() => {
    setDirDraft(settings.output_dir);
    setConcDraft(settings.max_concurrent);
    setFmtDraft(settings.audio_format);
    setMediaDraft(settings.default_media);
    setVideoFmtDraft(settings.video_format);
    setThumbDraft(settings.embed_thumbnail);
    setMetaDraft(settings.embed_metadata);
    setProfileDraft(settings.download_profile || "balanced");
    setAutoConcDraft(!!settings.auto_concurrent);
    setArchiveDraft(settings.use_archive !== false);
    setRetryDraft(settings.auto_retry !== false);
    setFirstDraft(settings.user_first_name);
    setLastDraft(settings.user_last_name);
    setUpdateUrlDraft(settings.update_url || "");
  }, [settings]);

  useEffect(() => {
    void appVersion()
      .then(setVersion)
      .catch(() => setVersion("1.0.0"));
  }, []);

  const recheckEngine = async () => {
    setRechecking(true);
    try {
      setEngineFresh(await checkEngine());
    } catch {
      toastError("Vérification impossible", "Impossible de joindre l'application native.");
    } finally {
      setRechecking(false);
    }
  };

  useEffect(() => {
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, []);

  const save = async (patch: Partial<SettingsType>) => {
    setSaving(true);
    try {
      await updateSettings(patch);
      onSettingsChange({ ...settings, ...patch });
      setSavedAt(Date.now());
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => setSavedAt(null), 1500);
      toastSuccess("Réglages enregistrés");
    } catch {
      toastError("Enregistrement impossible", "Les réglages n'ont pas pu être appliqués.");
    } finally {
      setSaving(false);
    }
  };

  // Choix du dossier via la boîte native — aucun enregistrement automatique.
  const pickDir = async () => {
    const dir = await open({
      directory: true,
      multiple: false,
      title: "Choisir un dossier de sortie",
      defaultPath: dirDraft || undefined,
    });
    if (typeof dir === "string") setDirDraft(dir);
  };

  const openOutputDir = async () => {
    if (!settings.output_dir) return;
    try {
      await openPath(settings.output_dir);
    } catch {
      toastError("Ouverture impossible", "Le dossier de sortie ne peut pas être ouvert.");
    }
  };

  // Sauvegarde globale « Enregistrer les réglages » : tout est appliqué ici,
  // jamais automatiquement au fil de l'eau.
  const dirty =
    dirDraft !== settings.output_dir ||
    concDraft !== settings.max_concurrent ||
    fmtDraft !== settings.audio_format ||
    mediaDraft !== settings.default_media ||
    videoFmtDraft !== settings.video_format ||
    thumbDraft !== settings.embed_thumbnail ||
    metaDraft !== settings.embed_metadata ||
    profileDraft !== (settings.download_profile || "balanced") ||
    autoConcDraft !== !!settings.auto_concurrent ||
    archiveDraft !== (settings.use_archive !== false) ||
    retryDraft !== (settings.auto_retry !== false) ||
    firstDraft !== settings.user_first_name ||
    lastDraft !== settings.user_last_name ||
    updateUrlDraft !== (settings.update_url || "");

  const saveAll = () => {
    const patch: Partial<SettingsType> = {};
    if (dirDraft !== settings.output_dir) patch.output_dir = dirDraft;
    if (concDraft !== settings.max_concurrent) patch.max_concurrent = concDraft;
    if (fmtDraft !== settings.audio_format) patch.audio_format = fmtDraft;
    if (mediaDraft !== settings.default_media) patch.default_media = mediaDraft;
    if (videoFmtDraft !== settings.video_format) patch.video_format = videoFmtDraft;
    if (thumbDraft !== settings.embed_thumbnail) patch.embed_thumbnail = thumbDraft;
    if (metaDraft !== settings.embed_metadata) patch.embed_metadata = metaDraft;
    if (profileDraft !== (settings.download_profile || "balanced")) {
      patch.download_profile = profileDraft;
    }
    if (autoConcDraft !== !!settings.auto_concurrent) patch.auto_concurrent = autoConcDraft;
    if (archiveDraft !== (settings.use_archive !== false)) patch.use_archive = archiveDraft;
    if (retryDraft !== (settings.auto_retry !== false)) patch.auto_retry = retryDraft;
    if (firstDraft !== settings.user_first_name) patch.user_first_name = firstDraft;
    if (lastDraft !== settings.user_last_name) patch.user_last_name = lastDraft;
    if (updateUrlDraft !== (settings.update_url || "")) patch.update_url = updateUrlDraft;
    if (Object.keys(patch).length > 0) save(patch);
  };

  const checkAppUpdate = async () => {
    const url = updateUrlDraft.trim() || settings.update_url.trim();
    if (!url || (!url.startsWith("https://") && !url.startsWith("http://"))) {
      toastWarning("URL non autorisée", "L'URL doit commencer par http:// ou https://.");
      return;
    }
    setCheckingAppUpdate(true);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { version?: string; url?: string };
      const remote = (data.version || "").trim();
      const download = (data.url || "").trim();
      if (!remote) throw new Error("JSON invalide (version manquante)");
      if (remote === version) {
        toastSuccess("À jour", `Version actuelle ${version}`);
      } else {
        toastSuccess("Mise à jour disponible", `${remote} (vous avez ${version})`);
        if (download.startsWith("https://") || download.startsWith("http://")) {
          window.open(download, "_blank", "noopener,noreferrer");
        }
      }
    } catch (e) {
      toastError("Vérification impossible", String(e));
    } finally {
      setCheckingAppUpdate(false);
    }
  };

  const runUpdate = async () => {
    setUpdating(true);
    setUpdateError(null);
    try {
      await ytdlpUpdate();
      setUpdatedAt(Date.now());
      toastSuccess("yt-dlp mis à jour");
    } catch (e: any) {
      const msg = typeof e === "string" ? e : "Mise à jour impossible.";
      setUpdateError(msg);
      toastError("Mise à jour impossible", msg);
    } finally {
      setUpdating(false);
    }
  };

  const concurrentPct = ((concDraft - 1) / 15) * 100;

  const loadDebug = async () => {
    setDebugLoading(true);
    try {
      const lines = await getDebugLog(80);
      setDebugLines(lines);
      if (lines.length === 0) setDebugLines(["Journal vide — relancez l'application."]);
    } catch {
      setDebugLines(["Diagnostic indisponible — redémarrez l'application."]);
    } finally {
      setDebugLoading(false);
    }
  };

  const toggleDebug = (open: boolean) => {
    setDebugOpen(open);
    if (open && debugLines === null) loadDebug();
  };

  const copyDebug = () => {
    if (!debugLines) return;
    navigator.clipboard
      .writeText(debugLines.join("\n"))
      .then(() => toastSuccess("Diagnostic copié", "Collez-le tel quel si vous me le partagez."))
      .catch(() => toastError("Copie impossible", "Impossible d'accéder au presse-papiers."));
  };

  return (
    <div className="max-w-2xl mx-auto space-y-3 pb-0">
      <section className="rounded-lg border border-dark-600/50 bg-dark-800/50 overflow-hidden">
        <SectionHeader
          icon={<UserIcon />}
          title="Identité"
          desc="Prénom et nom affichés dans l'application"
        />
        <div className="p-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-dark-100 block mb-1.5">Prénom</label>
              <input
                type="text"
                value={firstDraft}
                onChange={(e) => setFirstDraft(e.target.value)}
                placeholder="Ex. : Soufiane"
                spellCheck={false}
                className="field"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-dark-100 block mb-1.5">Nom</label>
              <input
                type="text"
                value={lastDraft}
                onChange={(e) => setLastDraft(e.target.value)}
                placeholder="Ex. : HAJJI"
                spellCheck={false}
                className="field"
              />
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-dark-600/50 bg-dark-800/50 overflow-hidden">
        <SectionHeader
          icon={<DownloadIcon />}
          title="Téléchargements"
          desc="Dossier de sortie, format (MP3 / MP4) et parallélisme"
        />

        <div className="p-4 space-y-5">
          <div>
            <label className="text-xs font-medium text-dark-100 block mb-1.5">Dossier de sortie</label>
            <div className="flex items-stretch gap-2">
              <div className="relative flex-1 min-w-0">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-dark-300 pointer-events-none">
                  <FolderIcon />
                </span>
                <input
                  type="text"
                  value={dirDraft}
                  readOnly
                  onClick={pickDir}
                  className="field pl-10 cursor-pointer"
                  placeholder="Choisir le dossier de sortie…"
                  title={dirDraft || "Choisir un dossier de sortie"}
                  spellCheck={false}
                />
              </div>
              <button
                onClick={pickDir}
                className="btn-ghost h-11 px-4 shrink-0"
                title="Choisir un dossier via la boîte native"
              >
                <FolderOpenIcon />
                Parcourir
              </button>
            </div>
            <p className="text-[11px] text-dark-500 mt-1.5">
              Les MP3 et les MP4 sont enregistrés ici. Appliqué au clic sur « Enregistrer les
              réglages ».
            </p>
          </div>

          <div>
            <label className="text-xs font-medium text-dark-100 block mb-1.5">
              Format par défaut
            </label>
            <div className="grid grid-cols-2 gap-1.5">
              {(["audio", "video"] as MediaKind[]).map((kind) => (
                <button
                  key={kind}
                  onClick={() => setMediaDraft(kind)}
                  className={`py-2 rounded-lg border text-center transition-colors ${
                    mediaDraft === kind
                      ? kind === "video"
                        ? "border-violet-500/60 bg-violet-500/15 text-white"
                        : "border-accent-500/60 bg-accent-500/15 text-white"
                      : "border-dark-500/70 bg-dark-700/60 text-dark-200 hover:border-dark-400 hover:bg-dark-700"
                  }`}
                >
                  <div className="text-[13px] font-semibold">{kind === "audio" ? "MP3" : "MP4"}</div>
                  <div className="text-[10px] opacity-60">
                    {kind === "audio" ? "Audio seul" : "Vidéo + audio"}
                  </div>
                </button>
              ))}
            </div>
            <p className="text-[11px] text-dark-500 mt-1.5">
              Format proposé à l'ouverture des pages de téléchargement. Il reste modifiable titre par
              titre avant chaque lancement.
            </p>
          </div>

          <div>
            <label className="text-xs font-medium text-dark-100 block mb-1.5">Qualité audio (MP3)</label>
            <div className="grid grid-cols-4 gap-1.5">
              {FORMAT_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setFmtDraft(opt.value)}
                  className={`py-2 rounded-lg border text-center transition-colors ${
                    fmtDraft === opt.value
                      ? "border-accent-500/60 bg-accent-500/15 text-white"
                      : "border-dark-500/70 bg-dark-700/60 text-dark-200 hover:border-dark-400 hover:bg-dark-700"
                  }`}
                >
                  <div className="text-[13px] font-semibold tnum">{opt.label}</div>
                  <div className="text-[10px] opacity-60">{opt.desc} · kbps</div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-dark-100 block mb-1.5">Qualité vidéo (MP4)</label>
            <div className="grid grid-cols-4 gap-1.5">
              {VIDEO_FORMAT_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setVideoFmtDraft(opt.value)}
                  className={`py-2 rounded-lg border text-center transition-colors ${
                    videoFmtDraft === opt.value
                      ? "border-violet-500/60 bg-violet-500/15 text-white"
                      : "border-dark-500/70 bg-dark-700/60 text-dark-200 hover:border-dark-400 hover:bg-dark-700"
                  }`}
                >
                  <div className="text-[13px] font-semibold">{opt.label}</div>
                  <div className="text-[10px] opacity-60">{opt.desc}</div>
                </button>
              ))}
            </div>
            <p className="text-[11px] text-dark-500 mt-1.5">
              Hauteur maximale du flux vidéo. ffmpeg fusionne la vidéo et l'audio : sur un appareil
              peu puissant, préférez une résolution plus basse ou moins de téléchargements
              simultanés.
            </p>
          </div>

          <div>
            <label className="text-xs font-medium text-dark-100 block mb-1.5">
              Profil de téléchargement
            </label>
            <div className="grid grid-cols-3 gap-1.5" data-testid="download-profile">
              {PROFILE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setProfileDraft(opt.value)}
                  className={`py-2 px-1.5 rounded-lg border text-center transition-colors ${
                    profileDraft === opt.value
                      ? "border-accent-500/60 bg-accent-500/15 text-white"
                      : "border-dark-500/70 bg-dark-700/60 text-dark-200 hover:border-dark-400 hover:bg-dark-700"
                  }`}
                >
                  <div className="text-[13px] font-semibold">{opt.label}</div>
                  <div className="text-[10px] opacity-60 leading-snug mt-0.5">{opt.desc}</div>
                </button>
              ))}
            </div>
            <p className="text-[11px] text-dark-500 mt-1.5">
              Rapide conserve l&apos;audio en M4A (idéal pour 2×100 titres). Équilibré / Qualité
              convertissent en MP3.
            </p>
          </div>

          <div>
            <label className="flex items-center justify-between text-xs font-medium text-dark-100 mb-2">
              Téléchargements simultanés
              <span className="badge bg-accent-500/15 text-accent-300 border border-accent-500/25 tnum">
                {autoConcDraft ? "Auto" : concDraft}
              </span>
            </label>
            <input
              type="range"
              min={1}
              max={16}
              value={concDraft}
              disabled={autoConcDraft}
              onChange={(e) => setConcDraft(parseInt(e.target.value, 10))}
              className="w-full disabled:opacity-40"
              style={{ "--p": `${concurrentPct}%` } as CSSProperties}
            />
            <div className="flex justify-between text-[10px] text-dark-500 tnum mt-1">
              <span>1 simultané</span>
              <span>16 simultanés</span>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-dark-600/50 bg-dark-800/50 overflow-hidden">
        <SectionHeader icon={<UserIcon />} title="Interface" desc="Densité d'affichage et mises à jour de l'application" />
        <div className="p-4 space-y-3">
          <FileToggleRow
            icon={<InfoIcon />}
            label="Mode compact"
            desc="Réduit paddings et largeur de la barre latérale"
            checked={compact}
            onChange={setCompact}
          />
          <div>
            <label className="block text-[10px] font-semibold tracking-wider text-dark-400 uppercase mb-1.5">
              URL de mise à jour (JSON)
            </label>
            <input
              value={updateUrlDraft}
              onChange={(e) => setUpdateUrlDraft(e.target.value)}
              placeholder="https://…/latest.json"
              className="field h-9 text-[12px]"
              data-testid="settings-update-url"
            />
            <p className="mt-1 text-[10.5px] text-dark-500">
              Format attendu : {"{"} "version": "1.0.1", "url": "https://…" {"}"}
            </p>
          </div>
          <div className="flex items-center justify-between gap-3">
            <p className="text-[12px] text-dark-200">
              Version de l'app : <span className="text-white tnum">{version}</span>
            </p>
            <button
              type="button"
              className="btn-primary h-9 px-3.5"
              data-testid="check-app-update"
              disabled={checkingAppUpdate}
              onClick={() => void checkAppUpdate()}
            >
              {checkingAppUpdate ? "Vérification…" : "Vérifier les mises à jour"}
            </button>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-dark-600/50 bg-dark-800/50 overflow-hidden">
        <SectionHeader
          icon={<TerminalIcon />}
          title="Moteur"
          desc="Présence et mise à jour de yt-dlp, ffmpeg et ffprobe"
          right={
            updatedAt && !updateError ? (
              <span className="inline-flex items-center gap-1 text-[10.5px] font-medium text-green-400">
                <CheckIcon />
                yt-dlp mis à jour
              </span>
            ) : undefined
          }
        />
        <div className="p-4 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-white">yt-dlp</p>
              <p className="text-[11px] text-dark-400 truncate">
                Moteur YouTube, extraction MP3 et fusion MP4
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={recheckEngine}
                disabled={rechecking}
                className="btn-ghost h-9"
                title="Contrôler à nouveau la présence des binaires"
              >
                <RefreshIcon spin={rechecking} />
                {rechecking ? "Vérification..." : "Re-vérifier"}
              </button>
              <button onClick={runUpdate} disabled={updating} className="btn-primary h-9 px-3.5">
                <RefreshIcon spin={updating} />
                {updating ? "Mise à jour..." : "Mettre à jour"}
              </button>
            </div>
          </div>
          {engineFresh && (
            <div className="space-y-1 pt-1">
              <div className="flex items-center gap-3">
                <BinDot ok={engineFresh.ytDlp} label="yt-dlp" />
                <BinDot ok={engineFresh.ffmpeg} label="ffmpeg" />
                <BinDot ok={engineFresh.ffprobe} label="ffprobe" />
                <BinDot ok={!!engineFresh.jsRuntime} label="deno (JS)" />
              </div>
              <p className="text-[10px] text-dark-500 truncate" title={engineFresh.binDir}>
                Vérifié depuis : {engineFresh.binDir}
              </p>
            </div>
          )}
        </div>
      </section>

      <section className="rounded-lg border border-dark-600/50 bg-dark-800/50 overflow-hidden">
        <SectionHeader
          icon={<BugIcon />}
          title="Diagnostic moteur"
          desc="Journal de démarrage (résolution des binaires)"
          right={
            <button
              onClick={copyDebug}
              disabled={!debugLines || debugLines.length === 0}
              className="btn-ghost h-8 px-3 text-[11px]"
              title="Copier le journal dans le presse-papiers"
            >
              Copier
            </button>
          }
        />
        <div className="p-3">
          <button
            onClick={() => toggleDebug(!debugOpen)}
            className="w-full text-left text-[11.5px] text-dark-200 hover:text-white transition-colors"
          >
            {debugOpen ? "Masquer le journal de diagnostic" : "Voir le journal de démarrage (résolution du moteur)…"}
          </button>
          {debugOpen && (
            <div className="mt-2">
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <p className="text-[10px] text-dark-500 truncate">
                  Copie complète aussi dans %APPDATA%\YTMusicDownloader\debug.log
                </p>
                <button onClick={loadDebug} disabled={debugLoading} className="btn-ghost h-7 px-3 text-[11px]" title="Recharger le journal">
                  <RefreshIcon spin={debugLoading} />
                  Recharger
                </button>
              </div>
              <pre className="max-h-64 overflow-auto rounded-lg bg-dark-950/80 border border-dark-700/50 p-2.5 text-[10px] leading-relaxed text-green-300/90 font-mono whitespace-pre-wrap break-all">
                {debugLoading && debugLines === null
                  ? "Chargement…"
                  : debugLines?.join("\n") || "Journal vide."}
              </pre>
            </div>
          )}
        </div>
      </section>

      <div className="sticky bottom-0 z-10 bg-dark-900/95 backdrop-blur border-t border-dark-700/60 pt-2.5 pb-1.5 px-1">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[10.5px] text-dark-400">
            {dirty
              ? "Modifications en attente — utilisez le bouton pour les appliquer."
              : "Réglages synchronisés avec le moteur."}
          </p>
          <div className="flex items-center gap-3 shrink-0">
            <SaveIndicator saving={saving} savedAt={savedAt} dirty={dirty} />
            <button onClick={saveAll} disabled={!dirty} className="btn-primary h-9 px-4 text-[13px]">
              <SaveIcon />
              Enregistrer les réglages
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});

function SectionHeader({
  icon,
  title,
  desc,
  right,
}: {
  icon: React.ReactNode;
  title: string;
  desc?: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 border-b border-dark-700/50">
      <span className="w-8 h-8 rounded-lg bg-gradient-to-br from-accent-500 to-accent-700 flex items-center justify-center shrink-0">
        {icon}
      </span>
      <div className="min-w-0">
        <h3 className="text-[13px] font-semibold text-white leading-tight">{title}</h3>
        {desc && <p className="text-[10.5px] text-dark-400 truncate">{desc}</p>}
      </div>
      {right && <div className="ml-auto flex items-center gap-2 shrink-0">{right}</div>}
    </div>
  );
}

function SaveIndicator({
  saving,
  savedAt,
  dirty,
}: {
  saving: boolean;
  savedAt: number | null;
  dirty: boolean;
}) {
  if (saving) {
    return (
      <span className="flex items-center gap-1.5 text-[11px] text-accent-400">
        <span className="w-3 h-3 border border-accent-400/40 border-t-accent-400 rounded-full animate-spin" />
        Sauvegarde...
      </span>
    );
  }
  if (savedAt) {
    return (
      <span className="flex items-center gap-1 text-[11px] text-green-400">
        <CheckIcon />
        Enregistré
      </span>
    );
  }
  if (dirty) {
    return (
      <span className="flex items-center gap-1.5 text-[11px] text-amber-400">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
        En attente
      </span>
    );
  }
  return null;
}

function FileToggleRow({
  icon,
  label,
  desc,
  checked,
  onChange,
}: {
  icon: React.ReactNode;
  label: string;
  desc: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-2 rounded-lg border border-dark-600/50 bg-dark-800/40 px-3 py-2.5 cursor-pointer hover:bg-dark-700/40 hover:border-dark-500/60 transition-colors">
      <div className="flex items-center gap-2.5 min-w-0">
        <span className="text-accent-400 shrink-0">{icon}</span>
        <div className="min-w-0">
          <span className="block text-[12.5px] font-medium text-dark-100 truncate">{label}</span>
          <span className="block text-[10px] text-dark-400 mt-0.5 truncate">{desc}</span>
        </div>
      </div>
      <Toggle checked={checked} onChange={onChange} />
    </label>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${
        checked ? "bg-accent-500" : "bg-dark-500"
      }`}
    >
      <div
        className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
          checked ? "translate-x-4" : "translate-x-0"
        }`}
      />
    </button>
  );
}

function DownloadIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="text-white shrink-0">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white shrink-0">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function FolderOpenIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m6 14 1.45-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.93a2 2 0 0 1 1.66.86L13 6h7a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

function DiscIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white shrink-0">
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function TerminalIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white shrink-0">
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  );
}

function RefreshIcon({ spin }: { spin?: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className={spin ? "animate-spin" : ""}>
      <polyline points="23 4 23 10 17 10" />
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function BinDot({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[10.5px] text-dark-300">
      <span className={`w-1.5 h-1.5 rounded-full ${ok ? "bg-green-400" : "bg-red-400"}`} />
      {label}
      <span className={`tnum ${ok ? "text-green-400" : "text-red-400"}`}>{ok ? "OK" : "manquant"}</span>
    </span>
  );
}

function SaveIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
      <polyline points="17 21 17 13 7 13 7 21" />
      <polyline points="7 3 7 8 15 8" />
    </svg>
  );
}

function BugIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white shrink-0">
      <rect x="8" y="6" width="8" height="13" rx="2" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
      <path d="M9 10H5m2 7H4m9 2v3" transform="translate(3 -3)" />
      <path d="m20 10-2 1m2 7-2-1" />
    </svg>
  );
}

function ImageIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21 15 16 10 5 21" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}