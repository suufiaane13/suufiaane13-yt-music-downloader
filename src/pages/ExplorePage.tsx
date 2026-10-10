import { useCallback, useEffect, useState } from "react";
import PageLoader from "../components/PageLoader";
import { ExploreResult } from "../components/ExploreResult";
import PageHeader from "./PageHeader";
import { usePerfMode, type PerfPref } from "../hooks/useDeviceProfile";
import { useYouTubeSearch } from "../hooks/useYouTubeSearch";
import {
  SearchItem,
  SearchTab,
  clearSearchCache,
  openExternalUrl,
  startBatchDownload,
  startDownload,
  startPlaylistJob,
  type MediaKind,
} from "../services/api";
import FormatSwitch, { formatLabel } from "../components/FormatSwitch";
import { toastError, toastSuccess, toastWarning } from "../components/Toasts";

const HISTORY_KEY = "ytmd-search-history";
const VIEW_KEY = "ytmd-explore-view";
const MAX_HISTORY = 8;

const SUGGESTIONS = [
  "Daft Punk",
  "Lofi hip hop",
  "Rock français",
  "Jazz chill",
  "Reggae mix",
  "Musique classique",
];

function readHistory(): string[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(arr)) return [];
    return arr.filter((s): s is string => typeof s === "string" && s.trim().length > 1).slice(0, MAX_HISTORY);
  } catch {
    return [];
  }
}

function pushHistory(list: string[], q: string): string[] {
  const next = [q, ...list.filter((s) => s.toLowerCase() !== q.toLowerCase())].slice(0, MAX_HISTORY);
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  } catch {
    /* stockage indisponible : l'historique reste en mémoire */
  }
  return next;
}

function readView(): "list" | "grid" {
  try {
    return localStorage.getItem(VIEW_KEY) === "grid" ? "grid" : "list";
  } catch {
    return "list";
  }
}

interface Props {
  engineReady: boolean;
  /** Ré analyse l'URL dans l'onglet « Musiques & playlists ». */
  onOpenInBrowse: (url: string) => void;
  defaultMedia?: MediaKind;
  defaultVideoFormat?: string;
}

export default function ExplorePage({
  engineReady,
  onOpenInBrowse,
  defaultMedia = "audio",
  defaultVideoFormat = "best",
}: Props) {
  const { mode, pref, low, setPref, pageSize } = usePerfMode();
  const search = useYouTubeSearch(pageSize);
  const [input, setInput] = useState("");
  const [view, setView] = useState<"list" | "grid">(readView);
  const [history, setHistory] = useState<string[]>(readHistory);
  const [selected, setSelected] = useState<string[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [media, setMedia] = useState<MediaKind>(defaultMedia);
  const [videoFormat, setVideoFormat] = useState(defaultVideoFormat);

  useEffect(() => setMedia(defaultMedia), [defaultMedia]);
  useEffect(() => setVideoFormat(defaultVideoFormat), [defaultVideoFormat]);

  // Mode éco : la grille est désactivée (trop de vignettes simultanées) et les
  // squeletes ne sont plus animés.
  const eco = mode === "eco";
  const effectiveView = eco ? "list" : view;

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_KEY, view);
    } catch {
      /* sans importance */
    }
  }, [view]);

  // Une sélection ne doit jamais survivre à un changement de résultats.
  useEffect(() => {
    setSelected((prev) => prev.filter((id) => search.items.some((i) => i.id === id)));
  }, [search.items, search.query, search.tab]);

  const doSearch = useCallback(
    (raw: string) => {
      const query = raw.trim();
      if (query.length < 2) {
        toastWarning("Requête trop courte", "Saisissez au moins 2 caractères.");
        return;
      }
      setInput(query);
      setHistory((h) => pushHistory(h, query));
      setSelected([]);
      search.submit(query);
    },
    [search]
  );

  const downloadOne = useCallback(
    async (item: SearchItem) => {
      setBusyId(item.id);
      try {
        if (item.kind === "playlist") {
          await startPlaylistJob(item.url, media, videoFormat);
          toastSuccess("Playlist lancée", `${item.title} — résolution puis téléchargement en parallèle.`);
        } else {
          await startDownload(item.url, item.title, item.thumbnail, media, videoFormat);
          toastSuccess("Téléchargement ajouté", item.title);
        }
      } catch (e) {
        toastError("Téléchargement impossible", String(e));
      } finally {
        setBusyId(null);
      }
    },
    [media, videoFormat]
  );

  const downloadSelected = useCallback(async () => {
    const items = search.items.filter((i) => selected.includes(i.id));
    if (items.length === 0) return;
    const videos = items.filter((i) => i.kind === "video");
    const playlists = items.filter((i) => i.kind === "playlist");
    setBusyId("batch");
    try {
      if (videos.length > 0) {
        await startBatchDownload(
          videos.map((i) => ({
            url: i.url,
            title: i.title,
            thumbnail: i.thumbnail,
            media,
            videoFormat,
          }))
        );
      }
      for (const p of playlists) {
        await startPlaylistJob(p.url, media, videoFormat);
      }
      toastSuccess(
        `${items.length} élément${items.length > 1 ? "s" : ""} ajouté${items.length > 1 ? "s" : ""}`,
        `${videos.length} titre${videos.length > 1 ? "s" : ""} + ${playlists.length} playlist${
          playlists.length > 1 ? "s" : ""
        } · ${formatLabel(media, videoFormat)}`
      );
      setSelected([]);
    } catch (e) {
      toastError("Ajout impossible", String(e));
    } finally {
      setBusyId(null);
    }
  }, [search.items, selected, media, videoFormat]);

  const openExternal = useCallback(async (item: SearchItem) => {
    try {
      await openExternalUrl(item.url);
    } catch (e) {
      toastError("Lien non ouvert", String(e));
    }
  }, []);

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }, []);

  const clearCache = useCallback(() => {
    void clearSearchCache()
      .then(() => toastSuccess("Cache vidé", "Les prochaines recherches iront sur le réseau."))
      .catch((e) => toastError("Cache non vidé", String(e)));
  }, []);

  const loading = search.status === "loading";
  const showSkeleton = loading && search.items.length === 0;
  const showEmpty = !loading && search.status === "ready" && search.items.length === 0;
  const showIntro = search.status === "idle" && !loading;

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <PageHeader
        title="Explorer YouTube"
        subtitle="Cherchez un titre, un artiste ou une playlist, puis téléchargez directement en MP3 ou MP4"
      />

      {/* --- Barre de recherche --- */}
      <div className="shrink-0 px-4 pb-2.5">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            doSearch(input);
          }}
          className="panel p-2 flex items-center gap-2"
        >
          <div className="relative flex-1 min-w-0">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-dark-300 pointer-events-none">
              <SearchIcon />
            </span>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape" && loading) search.cancel();
              }}
              maxLength={100}
              spellCheck={false}
              autoComplete="off"
              placeholder="Rechercher une chanson, un artiste, une playlist…"
              title="Recherche directe via yt-dlp (aucune API externe)"
              className="field pl-9"
              disabled={!engineReady}
            />
          </div>

          <TabSwitch value={search.tab} onChange={search.changeTab} disabled={!engineReady} />

          <button
            type="submit"
            className="btn-primary"
            disabled={!engineReady || input.trim().length < 2 || loading}
          >
            {loading ? <Spinner /> : <SearchIcon />}
            Rechercher
          </button>
          {loading && (
            <button type="button" onClick={search.cancel} className="btn-ghost" title="Interrompre (Échap)">
              <XIcon />
              Annuler
            </button>
          )}
        </form>

        {!engineReady && (
          <p className="mt-2 text-[11px] text-amber-400/90">
            Moteur indisponible : la recherche est désactivée jusqu'à ce que yt-dlp, ffmpeg et ffprobe
            soient détectés.
          </p>
        )}
        {eco && engineReady && (
          <p className="mt-2 flex items-center gap-1.5 text-[11px] text-dark-300">
            <BoltIcon />
            Mode Éco actif {pref === "auto" && low ? "(appareil peu puissant détecté)" : ""} : 12
            résultats par page, vignettes chargées à l'affichage.
          </p>
        )}
      </div>

      {/* --- Résultats --- */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4">
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          {search.query !== "" ? (
            <>
              <span className="text-[11px] text-dark-300 tnum">
                {search.items.length} résultat{search.items.length > 1 ? "s" : ""}
                {search.cached
                  ? " · cache local"
                  : loading
                    ? " · recherche…"
                    : ` · ${(search.elapsedMs / 1000).toFixed(1)} s`}
              </span>
              {search.items.length > 0 && (
                <button
                  onClick={() =>
                    setSelected(
                      selected.length === search.items.length ? [] : search.items.map((i) => i.id)
                    )
                  }
                  className="text-[11px] text-accent-300 hover:text-accent-200"
                >
                  {selected.length === search.items.length ? "Tout désélectionner" : "Tout sélectionner"}
                </button>
              )}
            </>
          ) : (
            <span className="text-[11px] text-dark-400">
              {pageSize} résultats par page · mode {eco ? "Éco" : "normal"}
            </span>
          )}

          <div className="ml-auto flex items-center gap-1.5">
            <span className="hidden xl:inline text-[11px] text-dark-400">Format</span>
            <FormatSwitch
              media={media}
              videoFormat={videoFormat}
              onMediaChange={setMedia}
              onVideoFormatChange={setVideoFormat}
              compact
            />
            <PerfSwitch value={pref} onChange={setPref} />
            {!eco && (
              <div className="flex items-center gap-0.5 rounded-lg border border-dark-600/60 bg-dark-800/60 p-0.5">
                <IconToggle
                  active={view === "list"}
                  onClick={() => setView("list")}
                  title="Vue liste (légère)"
                >
                  <ListIcon />
                </IconToggle>
                <IconToggle
                  active={view === "grid"}
                  onClick={() => setView("grid")}
                  title="Vue grille (plus lourde)"
                >
                  <GridIcon />
                </IconToggle>
              </div>
            )}
            <button
              onClick={clearCache}
              className="btn-ghost h-8 w-8 px-0 justify-center"
              title="Vider le cache des recherches"
            >
              <TrashIcon />
            </button>
          </div>
        </div>

        {showSkeleton && <PageLoader compact title="Recherche YouTube..." subtitle="Récupération des résultats" />}

        {loading && search.items.length > 0 && (
          <p className="text-[11px] text-dark-400 mb-2">Chargement de résultats supplémentaires…</p>
        )}

        {search.status === "error" && search.error && (
          <div className="panel p-4 flex items-start gap-3 border-red-500/30 bg-red-500/[0.06]">
            <span className="text-red-400 shrink-0">
              <WarnIcon />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[12.5px] font-semibold text-white">Recherche impossible</p>
              <p className="text-[11.5px] text-dark-200 mt-1 break-words">{search.error}</p>
              <div className="flex items-center gap-2 mt-2.5">
                <button onClick={() => doSearch(search.query)} className="btn-primary h-8 text-[12px]">
                  <RetryIcon />
                  Réessayer
                </button>
                <button onClick={search.reset} className="btn-ghost h-8 text-[12px]">
                  Effacer
                </button>
              </div>
            </div>
          </div>
        )}

        {showEmpty && (
          <div className="panel p-6 text-center">
            <p className="text-[13px] text-white font-semibold">Aucun résultat</p>
            <p className="text-[11.5px] text-dark-300 mt-1">
              Essayez d'autres mots-clés, ou l'onglet « Playlists ».
            </p>
          </div>
        )}

        {showIntro && (
          <div className="space-y-4">
            <div className="panel p-4">
              <p className="text-[12.5px] font-semibold text-white">Recherche directe, sans page YouTube</p>
              <p className="text-[11.5px] text-dark-300 mt-1 leading-relaxed">
                L'onglet <b className="text-dark-100">Vidéos</b> interroge yt-dlp et renvoie les
                résultats sans charger le site YouTube. Le téléchargement réutilise la file existante
                (qualité et dossier de sortie des paramètres). L'onglet <b className="text-dark-100">Playlists</b>{" "}
                lance un job de playlist : les titres sont résolus puis téléchargés en parallèle.
              </p>
            </div>

            <div>
              <p className="text-[11px] font-semibold tracking-wider text-dark-400 uppercase mb-2">
                Suggestions
              </p>
              <div className="flex flex-wrap gap-1.5">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => doSearch(s)}
                    disabled={!engineReady}
                    className="badge bg-dark-700/60 text-dark-100 border border-dark-600/60 hover:border-accent-500/50 hover:text-white px-2.5 py-1 text-[11px] disabled:opacity-40"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            {history.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <p className="text-[11px] font-semibold tracking-wider text-dark-400 uppercase">
                    Recherches récentes
                  </p>
                  <button
                    onClick={() => {
                      setHistory([]);
                      try {
                        localStorage.removeItem(HISTORY_KEY);
                      } catch {
                        /* sans importance */
                      }
                    }}
                    className="text-[11px] text-dark-400 hover:text-accent-300"
                  >
                    effacer
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {history.map((h) => (
                    <button
                      key={h}
                      onClick={() => doSearch(h)}
                      disabled={!engineReady}
                      className="badge bg-dark-800/60 text-dark-200 border border-dark-600/60 hover:border-dark-500 hover:text-white px-2.5 py-1 text-[11px] disabled:opacity-40"
                    >
                      {h}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {search.items.length > 0 && (
          <div
            className={
              effectiveView === "grid"
                ? "grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-2"
                : "space-y-1.5"
            }
          >
            {search.items.map((item) => (
              <ExploreResult
                key={`${item.kind}-${item.id}`}
                item={item}
                view={effectiveView}
                media={media}
                selected={selected.includes(item.id)}
                busy={busyId === item.id}
                onToggleSelect={toggleSelect}
                onDownload={downloadOne}
                onOpenDetails={(item) => onOpenInBrowse(item.url)}
                onOpenExternal={openExternal}
              />
            ))}
          </div>
        )}

        {search.hasMore && (
          <div className="flex justify-center pt-3">
            <button onClick={search.loadMore} disabled={loading} className="btn-ghost">
              {loading ? <Spinner /> : <PlusIcon />}
              Charger plus de résultats
            </button>
          </div>
        )}
      </div>

      {/* --- Barre de sélection : compteurs à gauche, actions à droite --- */}
      {selected.length > 0 && (
        <div className="shrink-0 border-t border-dark-700/70 bg-dark-800/80 px-4 py-2 flex items-center gap-3">
          <span className="flex items-center gap-2 min-w-0">
            <span className="badge bg-accent-500/20 text-accent-200 border border-accent-500/40 tnum shrink-0">
              {selected.length}
            </span>
            <span className="text-[11.5px] text-dark-200 tnum truncate">
              sélectionné{selected.length > 1 ? "s" : ""}
            </span>
            <span className="badge bg-violet-500/10 text-violet-300 border border-violet-500/25 shrink-0">
              {formatLabel(media, videoFormat)}
            </span>
          </span>

          <div className="ml-auto flex items-center gap-2 shrink-0">
            <button
              onClick={downloadSelected}
              disabled={busyId === "batch"}
              className="btn-primary h-8 text-[12px]"
              title="Ajoute à la file de téléchargement existante"
            >
              {busyId === "batch" ? <Spinner /> : <DownloadIcon />}
              Télécharger la sélection
            </button>
            <button onClick={() => setSelected([])} className="btn-ghost h-8 text-[12px]">
              Annuler la sélection
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sous-composants
// ---------------------------------------------------------------------------

function TabSwitch({
  value,
  onChange,
  disabled,
}: {
  value: SearchTab;
  onChange: (t: SearchTab) => void;
  disabled?: boolean;
}) {
  const tabs: Array<{ id: SearchTab; label: string }> = [
    { id: "video", label: "Vidéos" },
    { id: "playlist", label: "Playlists" },
  ];
  return (
    <div className="flex items-center gap-0.5 rounded-lg border border-dark-600/60 bg-dark-800/60 p-0.5 shrink-0">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          disabled={disabled}
          className={`h-8 px-2.5 rounded-md text-[12px] font-medium transition-colors disabled:opacity-40 ${
            value === t.id ? "bg-accent-500/15 text-white" : "text-dark-300 hover:text-white"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

function PerfSwitch({ value, onChange }: { value: PerfPref; onChange: (p: PerfPref) => void }) {
  const opts: Array<{ id: PerfPref; label: string; title: string }> = [
    { id: "auto", label: "Auto", title: "Détecte l'appareil et choisit le mode" },
    { id: "eco", label: "Éco", title: "Toujours léger (12 résultats, liste, sans animation)" },
    { id: "normal", label: "Normal", title: "20 résultats par page, vue au choix" },
  ];
  return (
    <div className="flex items-center gap-0.5 rounded-lg border border-dark-600/60 bg-dark-800/60 p-0.5">
      {opts.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          title={o.title}
          className={`h-8 px-2 rounded-md text-[11.5px] font-medium transition-colors ${
            value === o.id ? "bg-accent-500/15 text-white" : "text-dark-300 hover:text-white"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function IconToggle({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`w-8 h-8 rounded-md flex items-center justify-center transition-colors ${
        active ? "bg-accent-500/15 text-white" : "text-dark-300 hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}

// --- icônes ---

function SearchIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" />
      <line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  );
}

function GridIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function RetryIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 4 23 10 17 10" />
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </svg>
  );
}

function WarnIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function BoltIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
      <path d="M13 2 4.5 13.5H11l-1 8.5 8.5-11.5H12l1-8.5z" />
    </svg>
  );
}

function Spinner() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" className="animate-spin">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
