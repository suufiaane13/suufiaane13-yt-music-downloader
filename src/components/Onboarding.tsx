import { useState } from "react";
import { updateSettings } from "../services/api";

interface Props {
  firstName: string;
  lastName: string;
  onComplete: (firstName: string, lastName: string) => void;
}

export default function Onboarding({ firstName, lastName, onComplete }: Props) {
  const [first, setFirst] = useState(firstName);
  const [last, setLast] = useState(lastName);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = first.trim().length > 0 && last.trim().length > 0;

  const submit = async () => {
    if (!valid || saving || saved) return;
    setSaving(true);
    setError(null);
    try {
      const f = formatFirst(first);
      const l = formatLast(last);
      await updateSettings({
        user_first_name: f,
        user_last_name: l,
      });
      onComplete(f, l);
    } catch (e) {
      setError(String(e));
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] bg-dark-900 flex flex-col select-none">
      <div className="relative flex items-center h-10 px-4 gap-2 bg-dark-900/95 border-b border-dark-700/50" data-tauri-drag-region>
        <div className="w-6 h-6 rounded-md bg-gradient-to-br from-accent-500 to-accent-700 flex items-center justify-center shrink-0">
          <MusicNoteIcon small />
        </div>
        <span className="text-[11px] font-semibold text-white/90 tracking-wide">Bienvenue</span>
      </div>

      <div className="flex-1 flex items-center justify-center">
      <div className="w-full max-w-sm px-8">
        <div className="flex flex-col items-center">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-accent-500 to-accent-700 shadow-glow-accent flex items-center justify-center">
            <MusicNoteIcon />
          </div>
          <h1 className="mt-3.5 text-base font-bold text-white tracking-tight">YT Music Downloader</h1>
          <p className="mt-1 text-[11px] text-dark-300">
            YouTube → MP3 ou MP4 · Titulaire du projet
          </p>
        </div>

        <div className="mt-6 rounded-xl border border-dark-700/60 bg-dark-800/40 px-5 py-5">
          <p className="text-[13px] font-semibold text-white">Bienvenue dans l'application</p>
          <p className="mt-1 text-[11px] text-dark-300 leading-snug">
            Présentez-vous : le nom saisi apparaît dans la barre latérale et sur l'écran de démarrage.
          </p>

          <div className="mt-4 space-y-3">
            <div>
              <label className="block text-[10px] font-semibold tracking-wider text-dark-400 uppercase mb-1.5">
                Prénom
              </label>
              <input
                value={first}
                onChange={(e) => setFirst(formatFirst(e.target.value))}
                onKeyDown={(e) => e.key === "Enter" && void submit()}
                placeholder="Votre prénom"
                autoFocus
                className="w-full h-9 px-3 rounded-md bg-dark-900 border border-dark-600/70 text-[12.5px] text-white placeholder:text-dark-500 outline-none focus:border-accent-500/70 transition-colors"
              />
            </div>
            <div>
              <label className="block text-[10px] font-semibold tracking-wider text-dark-400 uppercase mb-1.5">
                Nom
              </label>
              <input
                value={last}
                onChange={(e) => setLast(formatLast(e.target.value))}
                onKeyDown={(e) => e.key === "Enter" && void submit()}
                placeholder="Votre nom"
                className="w-full h-9 px-3 rounded-md bg-dark-900 border border-dark-600/70 text-[12.5px] text-white placeholder:text-dark-500 outline-none focus:border-accent-500/70 transition-colors"
              />
            </div>
          </div>

          <button
            onClick={() => void submit()}
            disabled={!valid || saving || saved}
            className="mt-4 w-full h-9 rounded-md bg-gradient-to-r from-accent-500 to-accent-600 text-white text-[12.5px] font-semibold shadow-glow-accent hover:from-accent-400 hover:to-accent-500 disabled:opacity-40 disabled:shadow-none disabled:cursor-not-allowed transition-all"
          >
            {saved ? "Enregistré ✓" : saving ? "Enregistrement…" : "Commencer"}
          </button>

          {error && (
            <p className="mt-2.5 text-[11px] text-red-400 leading-snug">Erreur : {error}</p>
          )}
        </div>
      </div>
      </div>
    </div>
  );
}

// Prénom : seule la première lettre en majuscule (« soufiane » → « Soufiane »).
function formatFirst(v: string): string {
  const t = v.trim();
  if (!t) return t;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

// Nom : tout en majuscules (« hajji » → « HAJJI »).
function formatLast(v: string): string {
  return v.trim().toUpperCase();
}

function MusicNoteIcon({ small }: { small?: boolean }) {
  return (
    <svg width={small ? 14 : 26} height={small ? 14 : 26} viewBox="0 0 24 24" fill="white" stroke="none">
      <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55C7.79 13 6 14.79 6 17s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
    </svg>
  );
}
