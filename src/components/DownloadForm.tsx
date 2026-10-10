import { useEffect, useMemo, useState } from "react";
import {
  checkOwned,
  fetchInfo,
  startDownload,
  startBatchDownload,
  startPlaylistJob,
  MediaKind,
  VideoInfo,
} from "../services/api";
import PageLoader from "./PageLoader";
import FormatSwitch, { formatLabel } from "./FormatSwitch";
import { toastSuccess, toastError } from "./Toasts";

interface Props {
  connected: boolean;
  /** Format proposé par défaut (réglages persistés côté moteur). */
  defaultMedia?: MediaKind;
  defaultVideoFormat?: string;
}

export default function DownloadForm({
  connected,
  defaultMedia = "audio",
  defaultVideoFormat = "best",
}: Props) {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [info, setInfo] = useState<VideoInfo | null>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [search, setSearch] = useState("");
  const [media, setMedia] = useState<MediaKind>(defaultMedia);
  const [videoFormat, setVideoFormat] = useState(defaultVideoFormat);
  /** video_id → chemin local si déjà téléchargé. */
  const [owned, setOwned] = useState<Record<string, string>>({});

  // Un changement des réglages est repris quand l'utilisateur rouvre la page.
  useEffect(() => setMedia(defaultMedia), [defaultMedia]);
  useEffect(() => setVideoFormat(defaultVideoFormat), [defaultVideoFormat]);

  const clearAll = () => {
    setUrl("");
    setInfo(null);
    setError("");
    setSearch("");
    setOwned({});
  };

  const markOwned = async (data: VideoInfo, kind: MediaKind) => {
    const items =
      data.type === "playlist" && data.entries
        ? data.entries.map((e) => ({ id: e.id, title: e.title, media: kind }))
        : data.id
          ? [{ id: data.id, title: data.title, media: kind }]
          : [];
    if (items.length === 0) {
      setOwned({});
      return {};
    }
    try {
      const map = await checkOwned(items);
      setOwned(map);
      return map;
    } catch {
      setOwned({});
      return {};
    }
  };

  const runAnalyze = async (raw: string) => {
    const target = raw.trim();
    if (!target) return;
    setLoading(true);
    setError("");
    setInfo(null);
    setSearch("");
    setOwned({});
    try {
      const data = await fetchInfo(target);
      setInfo(data);
      const map = await markOwned(data, media);
      if (data.type === "playlist" && data.entries) {
        // Ne sélectionne que les titres absents du disque.
        const next = new Set<number>();
        data.entries.forEach((e, i) => {
          if (!map[e.id]) next.add(i);
        });
        setSelected(next);
        const already = Object.keys(map).length;
        if (already > 0) {
          toastSuccess(
            "Titres déjà présents",
            `${already} déjà en bibliothèque (affichés en premier, non sélectionnés).`
          );
        }
      }
    } catch (e: any) {
      toastError("Analyse du lien impossible", e.message || "Erreur lors de la récupération des infos");
    } finally {
      setLoading(false);
    }
  };

  // Recalcule « déjà présent » si on bascule MP3 ↔ MP4.
  useEffect(() => {
    if (!info) return;
    void markOwned(info, media).then((map) => {
      if (info.type === "playlist" && info.entries) {
        const next = new Set<number>();
        info.entries.forEach((e, i) => {
          if (!map[e.id]) next.add(i);
        });
        setSelected(next);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- uniquement au changement de format
  }, [media]);

  const handleFetchInfo = () => void runAnalyze(url);

  // Reçoit une URL collée depuis le menu contextuel « Coller l'URL ».
  useEffect(() => {
    const onPaste = (e: Event) => {
      const raw = (e as CustomEvent<string>).detail;
      if (raw) {
        setUrl(raw);
        void runAnalyze(raw);
      }
    };
    window.addEventListener("ytmd-paste-url", onPaste as EventListener);
    return () => window.removeEventListener("ytmd-paste-url", onPaste as EventListener);
  }, []);

  const handleDownload = async () => {
    if (!info) return;
    setLoading(true);
    setError("");
    try {
      if (info.type === "playlist" && info.entries) {
        const items = info.entries
          .filter((_, i) => selected.has(i))
          .filter((e) => !owned[e.id])
          .map((e) => ({
            url: e.url,
            title: e.title,
            thumbnail: e.thumbnail,
            media,
            videoFormat,
          }));
        const skippedSel = [...selected].filter((i) => {
          const e = info.entries![i];
          return e && owned[e.id];
        }).length;
        if (items.length === 0) {
          toastSuccess(
            "Rien à télécharger",
            skippedSel > 0
              ? "Tous les titres sélectionnés sont déjà présents."
              : "Aucun titre sélectionné."
          );
          return;
        }
        await startBatchDownload(items);
        toastSuccess(
          "Playlist ajoutée à la file",
          `${items.length} titre${items.length > 1 ? "s" : ""}${
            skippedSel ? ` · ${skippedSel} déjà présent${skippedSel > 1 ? "s" : ""} ignoré${skippedSel > 1 ? "s" : ""}` : ""
          }.`
        );
      } else {
        if (info.id && owned[info.id]) {
          toastSuccess("Déjà présent", "Ce média est déjà dans votre dossier de sortie.");
          return;
        }
        await startDownload(info.url || url, info.title, info.thumbnail, media, videoFormat);
        toastSuccess("Téléchargement ajouté", info.title);
      }
      clearAll();
    } catch (e: any) {
      toastError("Lancement du téléchargement impossible", e.message || "Erreur lors du téléchargement");
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadAll = async () => {
    if (!info || info.type !== "playlist") return;
    setLoading(true);
    setError("");
    try {
      await startPlaylistJob(info.url || url, media, videoFormat);
      toastSuccess("Playlist complète en cours", "Analyse et téléchargement parallèle de tous les titres.");
      clearAll();
    } catch (e: any) {
      toastError("Lancement de la playlist impossible", e.message || "Erreur lors du lancement de la playlist");
    } finally {
      setLoading(false);
    }
  };

  const toggleSelect = (i: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  const selectAll = () => {
    if (!info?.entries) return;
    // « Tout » = tous les titres encore absents (pas les déjà présents).
    setSelected(
      new Set(
        info.entries
          .map((e, i) => (owned[e.id] ? -1 : i))
          .filter((i) => i >= 0)
      )
    );
  };

  const selectNone = () => setSelected(new Set());

  const formatDuration = (s?: number | null) => {
    if (!s) return "--:--";
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  const entries = info?.type === "playlist" ? info.entries : undefined;

  const filtered = useMemo(() => {
    if (!entries) return [];
    const q = search.trim().toLowerCase();
    const list = q ? entries.filter((e) => e.title.toLowerCase().includes(q)) : [...entries];
    // Déjà présents en premier.
    list.sort((a, b) => {
      const ao = owned[a.id] ? 0 : 1;
      const bo = owned[b.id] ? 0 : 1;
      return ao - bo;
    });
    return list;
  }, [entries, search, owned]);

  const ownedCount = useMemo(() => Object.keys(owned).length, [owned]);
  const singleOwned = !!(info?.type === "video" && info.id && owned[info.id]);

  const totalDuration = useMemo(
    () => (entries || []).reduce((sum, e) => sum + (e.duration || 0), 0),
    [entries]
  );
  const selectedCount = selected.size;

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="shrink-0 px-4 pt-3 pb-2 space-y-2">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-dark-300" />
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleFetchInfo()}
              placeholder="Coller une URL YouTube (vidéo, playlist, radio...)"
              className="field pl-10 h-12"
              data-url-input
              disabled={!connected}
            />
            {url && (
              <button
                onClick={clearAll}
                className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full text-dark-300 hover:text-white hover:bg-white/10 flex items-center justify-center"
                title="Effacer"
              >
                <XIcon />
              </button>
            )}
          </div>
          <button
            onClick={handleFetchInfo}
            disabled={!url.trim() || loading || !connected}
            className="btn-primary h-12 px-5"
          >
            {loading ? (
              <span className="animate-spin w-4 h-4 border-2 border-white/25 border-t-white rounded-full" />
            ) : (
              <SearchIcon />
            )}
            Analyser
          </button>
        </div>

        <div className="flex items-center gap-2 text-[11px] text-dark-400 px-1">
          <span className="kbd">Vidéo</span>
          <span className="kbd">Playlist</span>
          <span className="kbd">Radio / live</span>
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden sm:inline">{formatLabel(media, videoFormat)}</span>
            <FormatSwitch
              media={media}
              videoFormat={videoFormat}
              onMediaChange={setMedia}
              onVideoFormatChange={setVideoFormat}
              compact
            />
          </div>
        </div>

        {!connected && (
          <p className="flex items-center gap-1.5 text-[11px] text-amber-400/90">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
            Initialisation du moteur de téléchargement...
          </p>
        )}
      </div>

      {loading && !info && (
        <div className="flex-1 min-h-0 flex items-center justify-center px-4 pb-6">
          <PageLoader title="Analyse du lien..." subtitle="Récupération des informations et du contenu YouTube" />
        </div>
      )}

      {!loading && !info && !error && (
        <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-5">
          <Hero />
        </div>
      )}
      {info?.type === "video" && (
        <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-5">
          <div className="panel p-4 flex items-center gap-4">
            {info.thumbnail && (
              <img src={info.thumbnail} alt="" className="w-32 h-[72px] rounded-md object-cover shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="badge bg-dark-600/70 text-dark-200 border border-dark-500">Vidéo</span>
                {info.duration ? (
                  <span className="badge bg-accent-500/15 text-accent-300 border border-accent-500/25 tnum">
                    {formatDuration(info.duration)}
                  </span>
                ) : null}
              </div>
              <h3 className="text-[15px] font-bold text-white mt-2 leading-snug">{info.title}</h3>
              <p className="text-xs text-dark-300 mt-0.5 truncate">{info.uploader}</p>
            </div>
            <button
              onClick={handleDownload}
              disabled={loading || singleOwned}
              className="btn-primary shrink-0"
              title={singleOwned ? "Fichier déjà présent dans le dossier de sortie" : undefined}
            >
              <DownloadIcon />
              {singleOwned
                ? "Déjà présent"
                : `Télécharger en ${media === "video" ? "MP4" : "MP3"}`}
            </button>
          </div>
          {singleOwned && (
            <p className="mt-2 text-[11px] text-accent-300">
              Déjà en bibliothèque — non re-téléchargé.
            </p>
          )}
        </div>
      )}

      {info?.type === "playlist" && entries && (
        <div className="flex-1 min-h-0 flex flex-col px-4 pb-4 gap-2.5">
          <PlaylistCard
            title={info.title}
            uploader={info.uploader}
            total={entries.length}
            totalDuration={totalDuration}
            selectedCount={selectedCount}
            ownedCount={ownedCount}
            loading={loading}
            media={media}
            videoFormat={videoFormat}
            onDownload={handleDownload}
            onDownloadAll={handleDownloadAll}
          />
          <TracksPanel
            entries={entries}
            filtered={filtered}
            selected={selected}
            owned={owned}
            search={search}
            onSearch={setSearch}
            onToggle={toggleSelect}
            onSelectAll={selectAll}
            onSelectNone={selectNone}
            selectedCount={selectedCount}
            formatDuration={formatDuration}
          />
        </div>
      )}
    </div>
  );
}

function Hero() {
  return (
    <div className="flex flex-col items-center justify-center text-center px-6 min-h-[38vh] pt-4">
      <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-accent-500 to-accent-700 shadow-glow-accent flex items-center justify-center">
        <MusicNoteIcon />
      </div>
      <h2 className="mt-5 text-lg font-bold text-white tracking-tight">Prêt à télécharger ?</h2>
      <p className="mt-1.5 text-[13px] text-dark-300 max-w-md">
        Collez un lien YouTube dans la barre ci-dessus pour analyser une vidéo ou une playlist,
        puis choisissez vos titres et leur qualité.
      </p>
      <div className="mt-6 grid grid-cols-3 gap-2.5 w-full max-w-lg">
        <FeatureIcon icon={<VideoIcon />} title="MP3 ou MP4" desc="320 kbps / 1080p" />
        <FeatureIcon icon={<ListIcon />} title="Playlists" desc="Sélection multi" />
        <FeatureIcon icon={<BoltIcon />} title="Optimisé" desc="Multi-thread rapide" />
      </div>
    </div>
  );
}

function FeatureIcon({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="rounded-lg border border-dark-600/60 bg-dark-800/50 p-3 flex flex-col items-center justify-center text-center">
      <div className="w-7 h-7 rounded-md bg-accent-500/15 border border-accent-500/25 flex items-center justify-center text-accent-400">
        {icon}
      </div>
      <p className="text-xs font-semibold text-white mt-2">{title}</p>
      <p className="text-[10px] text-dark-400 mt-0.5">{desc}</p>
    </div>
  );
}

function PlaylistCard({
  title,
  uploader,
  total,
  totalDuration,
  selectedCount,
  ownedCount,
  loading,
  media,
  videoFormat,
  onDownload,
  onDownloadAll,
}: {
  title: string;
  uploader: string;
  total: number;
  totalDuration: number;
  selectedCount: number;
  ownedCount: number;
  loading: boolean;
  media: MediaKind;
  videoFormat: string;
  onDownload: () => void;
  onDownloadAll: () => void;
}) {
  const pct = total > 0 ? (selectedCount / total) * 100 : 0;
  const ext = media === "video" ? "MP4" : "MP3";
  // Une playlist en MP4 mobilise beaucoup plus de place : on le dit.
  const warning =
    media === "video" ? "Volume élevé : plusieurs Go selon la résolution" : null;

  return (
    <div className="panel overflow-hidden">
      <div className="flex items-center gap-4 p-3.5">
        <div className="w-24 h-[60px] rounded-lg bg-gradient-to-br from-accent-500/30 to-accent-700/10 border border-accent-500/25 flex items-center justify-center text-accent-300 shrink-0">
          <ListIcon />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="badge bg-accent-500/15 text-accent-300 border border-accent-500/25">Playlist</span>
            <span
              className={`badge ${
                media === "video"
                  ? "bg-violet-500/15 text-violet-300 border border-violet-500/25"
                  : "bg-dark-600/70 text-dark-200 border border-dark-500"
              }`}
            >
              {formatLabel(media, videoFormat)}
            </span>
            {ownedCount > 0 && (
              <span className="badge bg-green-500/15 text-green-300 border border-green-500/25">
                {ownedCount} déjà présent{ownedCount > 1 ? "s" : ""}
              </span>
            )}
          </div>
          <h3 className="text-[15px] font-bold text-white mt-1.5 truncate leading-snug">{title}</h3>
          <p className="text-xs text-dark-300 mt-0.5 truncate">{uploader}</p>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0 tnum">
          <span className="text-[11px] text-dark-300">{total} titres</span>
          <span className="text-[11px] text-dark-400">{formatTotalDuration(totalDuration)}</span>
        </div>
      </div>

      <div className="h-0.5 bg-dark-700">
        <div className="h-full bg-gradient-to-r from-accent-600 to-accent-400 transition-[width] duration-200" style={{ width: `${pct}%` }} />
      </div>

      <div className="flex items-center gap-2 px-3 py-2.5 bg-dark-900/40 border-t border-dark-700/50">
        <button onClick={onDownload} disabled={loading || selectedCount === 0} className="btn-primary flex-1">
          <DownloadIcon />
          {selectedCount === 0
            ? "Sélectionnez des titres"
            : `Télécharger ${selectedCount} titre${selectedCount > 1 ? "s" : ""} en ${ext}`}
        </button>
        <button
          onClick={onDownloadAll}
          disabled={loading}
          className="btn-ghost shrink-0"
          title={
            warning ||
            `Analyse et télécharge la playlist complète en parallèle (sans limite de 100 titres)`
          }
        >
          <DownloadIcon />
          Tout en {ext}
        </button>
      </div>
    </div>
  );
}

function TracksPanel({
  entries,
  filtered,
  selected,
  owned,
  selectedCount,
  search,
  onSearch,
  onToggle,
  onSelectAll,
  onSelectNone,
  formatDuration,
}: {
  entries: { id: string; title: string; duration: number | null; thumbnail: string }[];
  filtered: { id: string; title: string; duration: number | null; thumbnail: string }[];
  selected: Set<number>;
  owned: Record<string, string>;
  selectedCount: number;
  search: string;
  onSearch: (v: string) => void;
  onToggle: (i: number) => void;
  onSelectAll: () => void;
  onSelectNone: () => void;
  formatDuration: (s?: number | null) => string;
}) {
  const PAGE = 50;
  const [visible, setVisible] = useState(PAGE);

  useEffect(() => {
    setVisible(PAGE);
  }, [entries, search]);

  const shown = filtered.slice(0, visible);
  const indexOf = (id: string) => entries.findIndex((e) => e.id === id);

  return (
    <div className="panel overflow-hidden flex-1 min-h-0 flex flex-col">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-dark-700/50 shrink-0">
        <SearchIcon className="shrink-0 text-dark-300" />
        <input
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Rechercher un titre..."
          className="flex-1 min-w-0 bg-transparent text-xs text-white outline-none placeholder-dark-300"
        />
        <span
          className="text-[11px] text-accent-300 tnum shrink-0"
          title={`${selectedCount} titre${selectedCount > 1 ? "s" : ""} sélectionné${selectedCount > 1 ? "s" : ""} sur ${entries.length}`}
        >
          <span className="font-semibold">{selectedCount}</span>/{entries.length}
        </span>
        <button
          onClick={onSelectAll}
          className="shrink-0 inline-flex items-center gap-1 h-6 px-2 rounded-md text-[10px] font-semibold border border-dark-500/60 bg-dark-700/40 text-dark-200 hover:text-white hover:border-accent-500/40 hover:bg-accent-500/10 transition-colors"
          title="Sélectionner tous les titres"
        >
          <SelectAllIcon />
          Tout
        </button>
        <button
          onClick={onSelectNone}
          className="shrink-0 inline-flex items-center gap-1 h-6 px-2 rounded-md text-[10px] font-semibold border border-dark-500/60 bg-dark-700/40 text-dark-200 hover:text-white hover:border-red-500/40 hover:bg-red-500/10 transition-colors"
          title="Désélectionner tous les titres"
        >
          <SelectNoneIcon />
          Aucun
        </button>
      </div>

      {filtered.length === 0 ? (
        <p className="flex-1 flex items-center justify-center text-center text-xs text-dark-400 py-6">
          Aucun titre ne correspond à votre recherche
        </p>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-1 p-1.5">
            {shown.map((entry) => {
              const i = indexOf(entry.id);
              const checked = i >= 0 && selected.has(i);
              const isOwned = !!owned[entry.id];
              return (
                <label
                  key={entry.id}
                  className={`flex items-center gap-2.5 px-2.5 py-2 rounded-md border cursor-pointer transition-colors ${
                    isOwned
                      ? "bg-green-500/8 border-green-500/25"
                      : checked
                        ? "bg-accent-500/10 border-accent-500/25"
                        : "border-dark-600/40 bg-dark-800/40 hover:bg-dark-700/50"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => i >= 0 && onToggle(i)}
                    className="w-3.5 h-3.5 shrink-0 accent-accent-500"
                  />
                  {entry.thumbnail && (
                    <img src={entry.thumbnail} alt="" className="w-12 h-8 rounded object-cover shrink-0" />
                  )}
                  <span className="flex-1 min-w-0 truncate text-xs text-dark-100">{entry.title}</span>
                  {isOwned && (
                    <span className="text-[10px] font-medium text-green-300 shrink-0">Déjà</span>
                  )}
                  <span className="text-[11px] text-dark-400 tnum shrink-0">{formatDuration(entry.duration)}</span>
                </label>
              );
            })}
          </div>
          {filtered.length > shown.length && (
            <div className="px-1.5 pb-2">
              <button
                onClick={() => setVisible((v) => v + PAGE)}
                className="w-full h-8 rounded-md border border-dark-600/60 bg-dark-800/50 text-[11px] font-medium text-dark-200 hover:text-white hover:border-accent-500/40 hover:bg-accent-500/10 transition-colors"
              >
                Afficher plus ({filtered.length - shown.length} restant
                {filtered.length - shown.length > 1 ? "s" : ""})
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function formatTotalDuration(secs: number): string {
  if (secs <= 0) return "";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" />
      <line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  );
}

function VideoIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="20" height="16" rx="3" />
      <polygon points="10 9 15 12 10 15 10 9" fill="currentColor" stroke="none" />
    </svg>
  );
}

function BoltIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  );
}

function MusicNoteIcon() {
  return (
    <svg width="30" height="30" viewBox="0 0 24 24" fill="white" stroke="none">
      <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55C7.79 13 6 14.79 6 17s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function SelectAllIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="4" />
      <polyline points="8 12 11 15 16 9" />
    </svg>
  );
}

function SelectNoneIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="4" />
      <line x1="7.5" y1="16.5" x2="16.5" y2="7.5" />
    </svg>
  );
}