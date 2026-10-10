import { useState } from "react";
import type { MediaKind, SearchItem } from "../services/api";

export function formatDuration(secs?: number | null): string {
  if (secs === null || secs === undefined || !isFinite(secs) || secs <= 0) return "";
  const s = Math.round(secs);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(r)}` : `${m}:${pad(r)}`;
}

export function formatViews(n?: number | null): string {
  if (!n || n <= 0) return "";
  if (n < 1000) return `${n} vues`;
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(".", ",")} k vues`;
  if (n < 1_000_000_000) return `${(n / 1_000_000).toFixed(1).replace(".", ",")} M vues`;
  return `${(n / 1_000_000_000).toFixed(1).replace(".", ",")} Md vues`;
}

interface Props {
  item: SearchItem;
  view: "list" | "grid";
  /** Format actif dans la barre d'outils Explorer (MP3 ou MP4). */
  media: MediaKind;
  selected: boolean;
  busy?: boolean;
  onToggleSelect: (id: string) => void;
  onDownload: (item: SearchItem) => void;
  onOpenDetails: (item: SearchItem) => void;
  onOpenExternal: (item: SearchItem) => void;
}

export function ExploreResult({
  item,
  view,
  media,
  selected,
  busy,
  onToggleSelect,
  onDownload,
  onOpenDetails,
  onOpenExternal,
}: Props) {
  const [thumbFailed, setThumbFailed] = useState(false);
  const duration = formatDuration(item.duration);
  const views = formatViews(item.views);
  const isPlaylist = item.kind === "playlist";
  const ext = media === "video" ? "MP4" : "MP3";
  const downloadTitle = isPlaylist
    ? `Résolution puis téléchargement de la playlist en ${ext}`
    : `Télécharger la vidéo en ${ext}`;

  const thumb = (
    <div
      className={`relative shrink-0 overflow-hidden rounded-md bg-dark-700 ring-1 ring-white/5 ${
        view === "list" ? "w-[112px] h-[63px]" : "w-full aspect-video"
      }`}
    >
      {!thumbFailed && item.thumbnail ? (
        <img
          src={item.thumbnail}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          draggable={false}
          onError={() => setThumbFailed(true)}
          className="w-full h-full object-cover"
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-dark-500">
          {isPlaylist ? <PlaylistGlyph /> : <MusicGlyph />}
        </div>
      )}
      {duration && (
        <span className="absolute bottom-1 right-1 px-1 rounded bg-black/75 text-[10px] font-semibold text-white tnum">
          {duration}
        </span>
      )}
      {isPlaylist && (
        <span className="absolute top-1 left-1 badge bg-black/65 text-white">
          <PlaylistGlyph /> Playlist
        </span>
      )}
    </div>
  );

  const meta = (
    <div className="min-w-0 flex-1">
      <p
        className={`text-white font-semibold leading-snug ${view === "list" ? "text-[12.5px] line-clamp-1" : "text-[12px] line-clamp-2"}`}
        title={item.title}
      >
        {item.title}
      </p>
      <p className="text-[11px] text-dark-300 truncate mt-0.5" title={item.channel}>
        {item.channel}
        {views ? ` · ${views}` : ""}
      </p>
    </div>
  );

  if (view === "grid") {
    return (
      <div
        className={`panel p-2 flex flex-col gap-2 transition-colors ${
          selected ? "border-accent-500/70 bg-accent-500/[0.08]" : "hover:border-dark-500/70"
        }`}
      >
        <div className="relative">
          {thumb}
          {/* Toute la vignette est cliquable : plus besoin de viser une case
              de 16 px, l'état sélectionné est signalé par le badge en haut à
              droite et par la bordure de la carte. */}
          <button
            onClick={() => onToggleSelect(item.id)}
            className="absolute inset-0 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-400"
            aria-pressed={selected}
            aria-label={
              selected
                ? `Retirer ${item.title} de la sélection`
                : `Ajouter ${item.title} à la sélection`
            }
            title={selected ? "Retirer de la sélection" : "Ajouter à la sélection"}
          />
          {selected && (
            <span className="absolute top-1 right-1 w-5 h-5 rounded-full bg-accent-500 text-white flex items-center justify-center shadow pointer-events-none">
              <CheckGlyph />
            </span>
          )}
        </div>
        {meta}
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => onDownload(item)}
            disabled={busy}
            className="btn-primary h-8 flex-1 text-[12px]"
            title={downloadTitle}
          >
            <DownloadGlyph />
            {isPlaylist ? "Playlist" : ext}
          </button>
          <button
            onClick={() => onOpenDetails(item)}
            className="btn-ghost h-8 w-8 px-0 justify-center"
            title={isPlaylist ? "Ouvrir dans Musiques & playlists" : "Voir la fiche du titre"}
          >
            <ListGlyph />
          </button>
          <button
            onClick={() => onOpenExternal(item)}
            className="btn-ghost h-8 w-8 px-0 justify-center"
            title="Ouvrir sur YouTube"
          >
            <ExternalGlyph />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`panel px-2.5 py-2 flex items-center gap-3 transition-colors ${
        selected
          ? "border-accent-500/70 bg-accent-500/[0.08]"
          : "hover:border-dark-500/70"
      }`}
    >
      {/* Bandeau d'accent à gauche : repère immédiat de l'état sélectionné. */}
      <span
        className={`self-stretch w-[3px] rounded-full shrink-0 transition-colors ${
          selected ? "bg-accent-500" : "bg-transparent"
        }`}
        aria-hidden="true"
      />
      <SelectBox checked={selected} onClick={() => onToggleSelect(item.id)} />
      {thumb}
      {meta}
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          onClick={() => onDownload(item)}
          disabled={busy}
          className="btn-primary h-8 text-[12px]"
          title={downloadTitle}
        >
          <DownloadGlyph />
          {isPlaylist ? "Playlist" : ext}
        </button>
        <button
          onClick={() => onOpenDetails(item)}
          className="btn-ghost h-8 w-8 px-0 justify-center"
          title={isPlaylist ? "Ouvrir dans Musiques & playlists" : "Voir la fiche du titre"}
        >
          <ListGlyph />
        </button>
        <button
          onClick={() => onOpenExternal(item)}
          className="btn-ghost h-8 w-8 px-0 justify-center"
          title="Ouvrir sur YouTube"
        >
          <ExternalGlyph />
        </button>
      </div>
    </div>
  );
}

function SelectBox({ checked, onClick }: { checked: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title={checked ? "Retirer de la sélection" : "Ajouter à la sélection"}
      aria-pressed={checked}
      aria-label={checked ? "Retirer de la sélection" : "Ajouter à la sélection"}
      className={`w-[18px] h-[18px] rounded-[5px] border shrink-0 flex items-center justify-center transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-400 ${
        checked
          ? "bg-accent-500 border-accent-500 text-white"
          : "border-dark-400/80 bg-dark-800/70 hover:border-accent-400/70 hover:bg-dark-700/70"
      }`}
    >
      {checked && <CheckGlyph />}
    </button>
  );
}

function CheckGlyph() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function DownloadGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function ListGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" />
      <line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  );
}

function ExternalGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}

function PlaylistGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="3" y1="6" x2="15" y2="6" />
      <line x1="3" y1="11" x2="15" y2="11" />
      <line x1="3" y1="16" x2="10" y2="16" />
      <circle cx="18" cy="16" r="3" />
      <line x1="21" y1="16" x2="21" y2="19" />
    </svg>
  );
}

function MusicGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55C7.79 13 6 14.79 6 17s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
    </svg>
  );
}
