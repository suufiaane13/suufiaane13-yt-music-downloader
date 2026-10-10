import { usePlayer } from "../player/PlayerContext";
import type { CSSProperties } from "react";

export default function PlayerBar() {
  const {
    current,
    playing,
    time,
    duration,
    volume,
    shuffle,
    repeat,
    queue,
    error,
    mediaKind,
    waveEl,
    videoEl,
    togglePlay,
    next,
    prev,
    seekTo,
    setVolume,
    toggleShuffle,
    toggleRepeat,
  } = usePlayer();
  const isVideo = mediaKind === "video";

  const fmtTime = (s: number) => {
    if (!isFinite(s) || s < 0) return "0:00";
    const m = Math.floor(s / 60);
    const r = Math.floor(s % 60);
    return `${m}:${r.toString().padStart(2, "0")}`;
  };

  const volumeStyle = { "--p": `${Math.round(volume * 100)}%` } as CSSProperties;

  return (
    <div className="shrink-0 h-16 border-t border-dark-700/70 bg-dark-800/40 px-4 flex items-center gap-3 select-none">
      {/* Piste en cours */}
      <div className="flex items-center gap-3 w-56 min-w-0 shrink">
        <div className="relative w-11 h-11 rounded-lg overflow-hidden shrink-0 border border-dark-600/60 bg-dark-700/70 flex items-center justify-center">
          {current?.cover ? (
            <img src={current.cover} alt="" className="w-full h-full object-contain bg-dark-900/80" draggable={false} />
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-dark-400">
              <path d="M9 18V5l12-2v13" />
              <circle cx="6" cy="18" r="3" />
              <circle cx="18" cy="16" r="3" />
            </svg>
          )}
          {current && playing && (
            <div className="absolute inset-0 bg-accent-500/20 flex items-center justify-center pointer-events-none">
              <Equalizer />
            </div>
          )}
        </div>
        <div className="min-w-0">
          <p className="text-[12.5px] font-medium text-white truncate">
            {current
              ? current.name.replace(/\.(mp3|mp4)$/i, "")
              : "Aucune musique en cours"}
          </p>
          <p className="text-[10.5px] text-dark-400 truncate">
            {current ? fmtTime(current.duration) : "Onglet Lecture"} ·{" "}
            {current ? (playing ? "en lecture" : "en pause") : queue.length ? `${queue.length} piste${queue.length > 1 ? "s" : ""}` : "—"}
          </p>
        </div>
      </div>

      {/* Contrôles de transport */}
      <div className="flex items-center gap-1 shrink-0">
        <ControlButton title="Précédent" onClick={prev}>
          <SkipBackIcon />
        </ControlButton>
        <ControlButton title={playing ? "Pause" : "Lecture"} onClick={togglePlay} primary>
          {playing ? <PauseIcon /> : <PlayIcon />}
        </ControlButton>
        <ControlButton title="Suivant" onClick={next}>
          <SkipForwardIcon />
        </ControlButton>
      </div>

      {/* Modes */}
      <div className="flex items-center gap-1 shrink-0">
        <ToggleButton active={shuffle} onClick={toggleShuffle} title="Aléatoire">
          <ShuffleIcon />
        </ToggleButton>
        <ToggleButton active={repeat} onClick={toggleRepeat} title="Répéter">
          <RepeatIcon />
        </ToggleButton>
      </div>

      {/* Waveform audio / barre vidéo */}
      <div className="relative flex-1 min-w-0 h-[46px] group">
        <div ref={waveEl} className={`absolute inset-0 ${isVideo ? "invisible pointer-events-none" : ""}`} />
        <video
          ref={videoEl}
          className={`absolute inset-0 w-full h-full object-contain rounded bg-black/40 ${isVideo && current ? "" : "hidden"}`}
          playsInline
          controls={false}
        />
        {!current && (
          <div className="absolute inset-0 flex items-center justify-center text-[11px] text-dark-500">
            La musique ne s'arrête pas quand vous changez d'onglet.
          </div>
        )}
      </div>

      {current && (
        <div
          className="shrink-0 h-1 bg-dark-700/60 rounded-full overflow-hidden cursor-pointer group/progress w-full max-w-[240px] mx-2 relative"
          title="Position"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            const d = duration || current.duration || 0;
            if (d > 0) seekTo(ratio * d);
          }}
        >
          <div
            className="h-full bg-gradient-to-r from-accent-500 to-accent-400 rounded-full"
            style={{ width: duration ? `${Math.min(100, (time / duration) * 100)}%` : "0%" }}
          />
          <div
            className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-white shadow-[0_0_6px_rgba(236,72,153,0.6)] border border-dark-800"
            style={{ left: duration ? `calc(${Math.min(100, (time / duration) * 100)}% - 5px)` : "-5px" }}
          />
        </div>
      )}

      <span className="text-[10.5px] text-dark-400 tnum shrink-0">
        {current ? `${fmtTime(time)} / ${fmtTime(duration)}` : "0:00 / 0:00"}
      </span>

      {/* Volume */}
      <div className="flex items-center gap-2 shrink-0 w-28">
        <VolumeIcon />
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          onChange={(e) => setVolume(parseFloat(e.target.value))}
          className="w-full"
          style={volumeStyle}
          title={`Volume ${Math.round(volume * 100)} %`}
        />
      </div>

      {error && (
        <span className="text-[10px] text-red-400 shrink-0 truncate max-w-40" title={error}>
          {error}
        </span>
      )}
    </div>
  );
}

function ControlButton({
  children,
  onClick,
  title,
  primary,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  primary?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${
        primary
          ? "bg-gradient-to-br from-accent-500 to-accent-600 text-white shadow-glow-accent hover:from-accent-400 hover:to-accent-500"
          : "bg-white/5 border border-white/10 text-dark-200 hover:bg-white/10 hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}

function ToggleButton({
  children,
  onClick,
  title,
  active,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  active: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${
        active
          ? "bg-accent-500/20 border border-accent-500/40 text-accent-300"
          : "bg-white/5 border border-white/10 text-dark-400 hover:bg-white/10 hover:text-white"
      }`}
    >
      {children}
    </button>
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

function PlayIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
      <rect x="6" y="4" width="4" height="16" rx="1" />
      <rect x="14" y="4" width="4" height="16" rx="1" />
    </svg>
  );
}

function SkipBackIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
      <path d="M6 6h2v12H6z" />
      <path d="M9.5 12l8.5 6V6z" />
    </svg>
  );
}

function SkipForwardIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
      <path d="M16 6h2v12h-2z" />
      <path d="M6 18l8.5-6L6 6z" />
    </svg>
  );
}

function ShuffleIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="16 3 21 3 21 8" />
      <line x1="4" y1="20" x2="21" y2="3" />
      <polyline points="21 16 21 21 16 21" />
      <line x1="15" y1="15" x2="21" y2="21" />
      <line x1="4" y1="4" x2="9" y2="9" />
    </svg>
  );
}

function RepeatIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="17 1 21 5 17 9" />
      <path d="M3 11V9a4 4 0 0 1 4-4h14" />
      <polyline points="7 23 3 19 7 15" />
      <path d="M21 13v2a4 4 0 0 1-4 4H3" />
    </svg>
  );
}

function VolumeIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-dark-400 shrink-0">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
    </svg>
  );
}