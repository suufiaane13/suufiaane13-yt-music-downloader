import { useCallback, useEffect, useState } from "react";

const KEY = "ytmd.compact";

export function useCompact() {
  const [compact, setCompactState] = useState(() => {
    try {
      return localStorage.getItem(KEY) === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    document.documentElement.classList.toggle("compact", compact);
    try {
      localStorage.setItem(KEY, compact ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [compact]);

  const setCompact = useCallback((v: boolean) => setCompactState(v), []);
  const toggle = useCallback(() => setCompactState((c) => !c), []);

  return { compact, setCompact, toggle };
}
