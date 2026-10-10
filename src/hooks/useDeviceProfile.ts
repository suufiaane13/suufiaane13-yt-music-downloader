import { useCallback, useEffect, useState } from "react";

export type PerfMode = "eco" | "normal";
export type PerfPref = "auto" | PerfMode;

const KEY = "ytmd-perf-mode";

interface NavWithHints extends Navigator {
  deviceMemory?: number;
  connection?: { saveData?: boolean; effectiveType?: string };
}

function readPref(): PerfPref {
  try {
    const v = localStorage.getItem(KEY);
    return v === "eco" || v === "normal" || v === "auto" ? v : "auto";
  } catch {
    return "auto";
  }
}

/**
 * Détecte un poste peu puissant (cœurs, mémoire, mode d'économie de données).
 * Ces indices sont volontairement optionnels : leur absence n'est jamais traitée
 * comme un « appareil lent ».
 */
export function detectLowEnd(): boolean {
  if (typeof navigator === "undefined") return false;
  const nav = navigator as NavWithHints;
  const cores = nav.hardwareConcurrency ?? 0;
  const mem = nav.deviceMemory ?? 0;
  const saveData = nav.connection?.saveData === true;
  const lowType = nav.connection?.effectiveType === "2g" || nav.connection?.effectiveType === "slow-2g";
  return (
    (cores > 0 && cores <= 4) ||
    (mem > 0 && mem <= 4) ||
    saveData ||
    lowType
  );
}

/**
 * Mode de performance de l'interface.
 * - `eco`   : 12 résultats par page, vue liste imposée, squelettes sans animation
 * - `normal`: 20 résultats par page, vue au choix
 */
export function usePerfMode() {
  const [pref, setPrefState] = useState<PerfPref>(() => readPref());

  useEffect(() => {
    try {
      localStorage.setItem(KEY, pref);
    } catch {
      /* stockage indisponible : la préférence reste en mémoire */
    }
  }, [pref]);

  const setPref = useCallback((p: PerfPref) => setPrefState(p), []);

  const low = detectLowEnd();
  const mode: PerfMode = pref === "auto" ? (low ? "eco" : "normal") : pref;

  return {
    mode,
    pref,
    low,
    setPref,
    pageSize: mode === "eco" ? 12 : 20,
  };
}
