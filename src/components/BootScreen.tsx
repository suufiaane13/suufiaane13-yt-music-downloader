import type { BootPhase } from "../hooks/useApp";
import { formatUserName } from "../services/api";

const STEPS: { id: BootPhase; label: string }[] = [
  { id: "settings", label: "Chargement des réglages…" },
  { id: "tasks", label: "Chargement des tâches…" },
  { id: "engine", label: "Vérification du moteur yt-dlp…" },
];

interface Props {
  phase: BootPhase;
  fading?: boolean;
  firstName?: string;
  lastName?: string;
}

export default function BootScreen({ phase, fading, firstName, lastName }: Props) {
  const current =
    phase === "ready" ? STEPS.length : Math.max(0, STEPS.findIndex((s) => s.id === phase));

  const credit = formatUserName({ user_first_name: firstName, user_last_name: lastName });

  return (
    <div
      className={`fixed inset-0 z-40 bg-dark-900 flex items-center justify-center select-none ${
        fading ? "boot-fade" : ""
      }`}
    >
      <div className="w-full max-w-sm px-8 flex flex-col items-center">
        <div className="flex flex-col items-center">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-accent-500 to-accent-700 shadow-glow-accent flex items-center justify-center animate-pulse-slow">
            <MusicNoteIcon />
          </div>
          <h1 className="mt-3.5 text-base font-bold text-white tracking-tight">YT Music Downloader</h1>
          <p className="mt-1 text-[11px] text-dark-300">
            YouTube → MP3 ou MP4 · Jusqu'à 320 kbps / 1080p
          </p>
        </div>

        <div className="mt-6 w-72 rounded-xl border border-dark-700/60 bg-dark-800/40 px-4 py-2">
          {STEPS.map((s, idx) => (
            <Step
              key={s.id}
              label={s.label}
              state={idx < current ? "done" : idx === current ? "active" : "todo"}
            />
          ))}
          {phase === "ready" && (
            <div className="boot-step-in flex items-center gap-2.5 py-2">
              <span className="w-4 h-4 rounded-full bg-green-500/15 border border-green-500/40 flex items-center justify-center text-green-400 shrink-0">
                <CheckIcon />
              </span>
              <span className="text-[12px] font-semibold text-green-400">Connecté</span>
            </div>
          )}
        </div>

        <div className="mt-5 h-1 w-40 rounded-full bg-dark-700 overflow-hidden">
          <div className="h-full w-1/3 rounded-full bg-gradient-to-r from-transparent via-accent-500 to-transparent animate-shimmer" />
        </div>

        {credit ? (
          <p className="mt-4 text-[10px] text-dark-500">Conçu par {credit}</p>
        ) : (
          <p className="mt-4 text-[10px] text-dark-500">YT Music Downloader</p>
        )}
      </div>
    </div>
  );
}

function Step({ label, state }: { label: string; state: "done" | "active" | "todo" }) {
  return (
    <div className="flex items-center gap-2.5 py-2">
      {state === "done" ? (
        <span className="w-4 h-4 rounded-full bg-accent-500/15 border border-accent-500/40 flex items-center justify-center text-accent-400 shrink-0">
          <CheckIcon />
        </span>
      ) : state === "active" ? (
        <span className="w-4 h-4 rounded-full border border-accent-500/30 border-t-accent-400 animate-spin shrink-0" />
      ) : (
        <span className="w-4 h-4 rounded-full border border-dark-600 bg-dark-700/60 shrink-0" />
      )}
      <span className={`text-[12px] ${state === "todo" ? "text-dark-500" : "text-dark-100"}`}>{label}</span>
    </div>
  );
}

function CheckIcon() {
  return (
    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function MusicNoteIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="white" stroke="none">
      <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55C7.79 13 6 14.79 6 17s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
    </svg>
  );
}