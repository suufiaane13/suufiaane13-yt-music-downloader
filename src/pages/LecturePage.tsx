import { useEffect, useMemo, useState } from "react";
import {
  exportM3u,
  listMusic,
  mediaKindOf,
  openPath,
  type MediaKind,
  type MusicFile,
} from "../services/api";
import { usePlayer } from "../player/PlayerContext";
import PageLoader from "../components/PageLoader";
import PageHeader from "./PageHeader";
import { toastError, toastSuccess } from "../components/Toasts";

interface Props {
  outputDir: string;
}

type KindFilter = "all" | MediaKind;

export default function LecturePage({ outputDir }: Props) {
  const { current, playing, error: playerError, setQueue, playTrack, togglePlay } = usePlayer();

  const [files, setFiles] = useState<MusicFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [view, setView] = useState<"cards" | "list">(() => {
    try {
      return localStorage.getItem("ytmd.view.lecture") === "list" ? "list" : "cards";
    } catch {
      return "cards";
    }
  });

  const changeView = (v: "cards" | "list") => {
    setView(v);
    try {
      localStorage.setItem("ytmd.view.lecture", v);
    } catch {}
  };

  const loadFiles = async () => {
    setLoading(true);
    setError(null);
    try {
      setFiles(await listMusic());
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadFiles();
  }, [outputDir]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return files.filter((f) => {
      if (kindFilter !== "all" && mediaKindOf(f) !== kindFilter) return false;
      if (!q) return true;
      return f.name.toLowerCase().includes(q);
    });
  }, [files, query, kindFilter]);

  const activeIndex = useMemo(
    () => (current ? filtered.findIndex((f) => f.path === current.path) : -1),
    [filtered, current]
  );

  // La file du lecteur suit la vue filtrée : suivant/précédent/lecture suivie
  // évoluent avec la recherche, sans interrompre la piste en cours.
  useEffect(() => {
    setQueue(filtered);
  }, [filtered, setQueue]);

  const fmtTime = (s: number) => {
    if (!isFinite(s) || s < 0) return "0:00";
    const m = Math.floor(s / 60);
    const r = Math.floor(s % 60);
    return `${m}:${String(r).padStart(2, "0")}`;
  };

  const fmtSize = (b: number) =>
    b > 1048576 ? `${(b / 1048576).toFixed(1)} Mo` : `${Math.max(1, Math.round(b / 1024))} Ko`;

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <PageHeader title="Lecture" subtitle="Écoutez les musiques présentes dans le dossier de sortie" />

      <div className="shrink-0 px-4 pt-1 pb-3 space-y-2">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-dark-300" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Rechercher une musique…"
              className="field pl-10 h-12"
            />
            {query && (
              <button
                onClick={() => setQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full text-dark-300 hover:text-white hover:bg-white/10 flex items-center justify-center"
                title="Effacer la recherche"
              >
                <XIcon />
              </button>
            )}
          </div>
          <button
            onClick={() => {
              const first = filtered[0];
              if (first) playTrack(first.path);
            }}
            disabled={filtered.length === 0}
            className="btn-primary h-12 px-5"
            title="Lire la première piste de la liste"
          >
            <PlayIcon />
            Tout lire
          </button>
          <button
            onClick={() => void loadFiles()}
            title="Actualiser la liste"
            className="btn-ghost h-12 px-4"
          >
            <ReloadIcon />
          </button>
          {outputDir && (
            <button
              onClick={() => void openPath(outputDir)}
              title="Ouvrir le dossier de sortie"
              className="btn-ghost h-12 px-4"
            >
              <FolderIcon />
            </button>
          )}
          <button
            type="button"
            title="Exporter une playlist M3U"
            className="btn-ghost h-12 px-4"
            data-testid="export-m3u"
            onClick={() =>
              void exportM3u()
                .then((p) => toastSuccess("Playlist M3U créée", p))
                .catch(() => toastError("Export impossible", "Impossible d'écrire le fichier M3U."))
            }
          >
            M3U
          </button>
          <ViewToggle value={view} onChange={changeView} />
        </div>

        <div className="flex items-center gap-2 text-[11px] text-dark-400 px-1 flex-wrap">
          {(
            [
              ["all", "Tous"],
              ["audio", "Audio"],
              ["video", "Vidéo"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              data-testid={`lecture-filter-${id}`}
              onClick={() => setKindFilter(id)}
              className={`h-7 px-2.5 rounded-md border text-[11px] ${
                kindFilter === id
                  ? "bg-accent-500/15 text-accent-300 border-accent-500/30"
                  : "bg-dark-800/40 border-dark-600/60 hover:text-white"
              }`}
            >
              {label}
            </button>
          ))}
          <span className="kbd">MP3</span>
          <span className="kbd">MP4</span>
          <span className="ml-auto tnum">
            {filtered.length} fichier{filtered.length > 1 ? "s" : ""}
          </span>
        </div>
      </div>

      <div className="flex-1 min-h-0 px-4 pb-3 overflow-y-auto">
        {loading && <PageLoader compact title="Chargement de la bibliothèque" subtitle="Lecture des fichiers audio" />}
        {!loading && error && <p className="text-[11.5px] text-red-400 px-1 pt-2">Erreur : {error}</p>}
        {playerError && (
          <p className="text-[11.5px] text-red-400 px-1 pt-2 break-all">
            Erreur lecteur : {playerError}
          </p>
        )}
        {!loading && !error && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-center select-none">
            <EmptyIcon />
            <p className="text-[12.5px] text-dark-300">
              {outputDir ? "Aucune musique trouvée dans ce dossier." : "Définissez d'abord un dossier de sortie."}
            </p>
            <p className="text-[10.5px] text-dark-500 truncate max-w-full">{outputDir || "—"}</p>
            {outputDir && (
              <button
                onClick={() => void openPath(outputDir)}
                className="mt-1 h-8 px-3.5 rounded-md bg-accent-500/15 border border-accent-500/30 text-accent-300 text-[11px] font-semibold hover:bg-accent-500/25 transition-colors"
              >
                Ouvrir le dossier
              </button>
            )}
          </div>
        )}
        {!loading && !error && filtered.length > 0 && view === "cards" && (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
            {filtered.map((f) => {
              const active = current?.path === f.path;
              return (
                <button
                  key={f.path}
                  onClick={() => {
                    if (active) togglePlay();
                    else playTrack(f.path);
                  }}
                  className={`group text-left rounded-xl border overflow-hidden transition-colors ${
                    active
                      ? "border-accent-500/60 bg-accent-500/10"
                      : "border-dark-700/60 bg-dark-800/40 hover:bg-dark-700/40 hover:border-dark-500/60"
                  }`}
                  title={f.name.replace(/\.(mp3|m4a|mp4)$/i, "")}
                >
                  <div
                    className={`relative aspect-square w-full overflow-hidden border-b bg-dark-950 ${
                      active ? "border-accent-500/40" : "border-dark-700/50"
                    }`}
                  >
                    {f.cover ? (
                      <img
                        src={f.cover}
                        alt=""
                        className="absolute inset-0 w-full h-full object-contain object-center"
                        draggable={false}
                      />
                    ) : (
                      <FallbackCover title={f.name.replace(/\.(mp3|m4a|mp4)$/i, "")} />
                    )}
                    {active && (
                      <div className="absolute inset-0 bg-accent-500/20 flex items-center justify-center pointer-events-none">
                        {playing ? (
                          <Equalizer />
                        ) : (
                          <span className="w-10 h-10 rounded-full bg-accent-500 shadow-glow-accent flex items-center justify-center">
                            <PlayGlyph />
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="px-3 py-2.5 min-w-0">
                    <p className={`text-[12.5px] font-medium truncate ${active ? "text-accent-300" : "text-white"}`}>
                      {f.name.replace(/\.(mp3|m4a|mp4)$/i, "")}
                    </p>
                    <p className="text-[10.5px] text-dark-400 mt-0.5">
                      {f.duration > 0 ? fmtTime(f.duration) : "—"} · {fmtSize(f.sizeBytes)}
                      {active && (
                        <span className="ml-1.5 kbd text-accent-300 border-accent-500/40 bg-accent-500/10 tnum">
                          #{activeIndex >= 0 ? activeIndex + 1 : "—"}
                        </span>
                      )}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {!loading && !error && filtered.length > 0 && view === "list" && (
          <div className="rounded-lg border border-dark-700/60 bg-dark-800/30 divide-y divide-dark-700/50 overflow-hidden">
            {filtered.map((f) => {
              const active = current?.path === f.path;
              return (
                <button
                  key={f.path}
                  onClick={() => {
                    if (active) togglePlay();
                    else playTrack(f.path);
                  }}
                  className={`w-full flex items-center gap-3 px-3.5 py-2.5 text-left transition-colors ${
                    active ? "" : "hover:bg-white/5"
                  }`}
                >
                  <div
                    className={`relative w-9 h-9 rounded-md overflow-hidden shrink-0 border flex items-center justify-center bg-dark-900/80 ${
                      active ? "border-accent-500/60" : "border-dark-600/50"
                    }`}
                  >
                    {f.cover ? (
                      <img src={f.cover} alt="" className="w-full h-full object-contain" draggable={false} />
                    ) : (
                      <div className="w-full h-full">
                        <FallbackCover title={f.name.replace(/\.(mp3|m4a|mp4)$/i, "")} small />
                      </div>
                    )}
                    {active && (
                      <div className="absolute inset-0 bg-accent-500/20 flex items-center justify-center">
                        {playing ? (
                          <Equalizer />
                        ) : (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="#fff">
                            <path d="M8 5v14l11-7z" />
                          </svg>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-[12.5px] font-medium truncate ${active ? "text-accent-300" : "text-white"}`}>
                      {f.name.replace(/\.(mp3|m4a|mp4)$/i, "")}
                    </p>
                    <p className="text-[10.5px] text-dark-400">
                      {f.duration > 0 ? fmtTime(f.duration) : "—"} · {fmtSize(f.sizeBytes)}
                    </p>
                  </div>
                  {active && (
                    <span className="inline-flex items-center gap-1.5 shrink-0">
                      <span className="kbd text-accent-300 border-accent-500/40 bg-accent-500/10 tnum" title={`Position ${activeIndex + 1}`}>
                        #{activeIndex >= 0 ? activeIndex + 1 : "—"}
                      </span>
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function Equalizer() {
  return (
    <span className="flex items-end gap-[2px] h-4">
      {[0.5, 1, 0.7, 0.9].map((h, i) => (
        <span
          key={i}
          className="w-[3px] rounded-sm bg-accent-500 eq-bar"
          style={{ height: `${h * 100}%`, animationDelay: `${i * 0.12}s` }}
        />
      ))}
    </span>
  );
}

function PlayGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="#fff">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function ViewToggle({ value, onChange }: { value: "cards" | "list"; onChange: (v: "cards" | "list") => void }) {
  const btn = (v: "cards" | "list", icon: React.ReactNode, label: string) => (
    <button
      onClick={() => onChange(v)}
      className={`h-12 px-3 rounded-lg inline-flex items-center gap-1.5 text-[12px] font-medium transition-colors ${
        value === v ? "bg-accent-500/15 text-accent-300 border border-accent-500/30" : "text-dark-300 hover:text-white"
      }`}
      title={v === "cards" ? "Vue en cartes" : "Vue en liste"}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
  return (
    <div className="flex items-center gap-0.5 bg-dark-800/60 border border-dark-700/70 rounded-lg p-0.5">
      {btn("cards", <GridIcon />, "Cartes")}
      {btn("list", <ListIcon />, "Liste")}
    </div>
  );
}

function GridIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" />
      <line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  );
}

function FallbackCover({ title, small }: { title: string; small?: boolean }) {
  const initial = (title.trim().charAt(0) || "♪").toUpperCase();
  return (
    <div className="w-full h-full bg-gradient-to-br from-dark-700 to-dark-900 flex items-center justify-center">
      {small ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-accent-400">
          <path d="M9 18V5l12-2v13" />
          <circle cx="6" cy="18" r="3" />
          <circle cx="18" cy="16" r="3" />
        </svg>
      ) : (
        <div className="flex flex-col items-center gap-2 text-dark-400 select-none">
          <span className="w-14 h-14 rounded-full bg-gradient-to-br from-accent-500/25 to-accent-700/10 border border-accent-500/25 flex items-center justify-center text-[26px] font-bold text-accent-300">
            {initial}
          </span>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 18V5l12-2v13" />
            <circle cx="6" cy="18" r="3" />
            <circle cx="18" cy="16" r="3" />
          </svg>
        </div>
      )}
    </div>
  );
}

function PlayIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function ReloadIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 4 23 10 17 10" />
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </svg>
  );
}

function EmptyIcon() {
  return (
    <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="#3f3a52" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </svg>
  );
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
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

function FolderIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}