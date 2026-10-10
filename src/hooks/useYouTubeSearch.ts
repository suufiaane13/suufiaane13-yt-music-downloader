import { useCallback, useEffect, useRef, useState } from "react";
import {
  SearchItem,
  SearchPage,
  SearchTab,
  cancelSearch,
  searchYoutube,
} from "../services/api";

export type SearchStatus = "idle" | "loading" | "ready" | "error";

/** Borne haute alignée sur le Rust (`MAX_LIMIT`). */
const MAX_LIMIT = 50;

interface State {
  status: SearchStatus;
  query: string;
  tab: SearchTab;
  items: SearchItem[];
  cached: boolean;
  elapsedMs: number;
  hasMore: boolean;
  error: string | null;
  limit: number;
}

const INITIAL: State = {
  status: "idle",
  query: "",
  tab: "video",
  items: [],
  cached: false,
  elapsedMs: 0,
  hasMore: false,
  error: null,
  limit: 20,
};

function mergeUnique(a: SearchItem[], b: SearchItem[]): SearchItem[] {
  const seen = new Set(a.map((i) => i.id));
  return [...a, ...b.filter((i) => !seen.has(i.id))];
}

function errText(e: unknown): string {
  const raw =
    typeof e === "string"
      ? e
      : e instanceof Error
        ? e.message
        : typeof e === "object" && e && "message" in e
          ? String((e as { message: unknown }).message)
          : "Recherche impossible.";
  const m = raw.toLowerCase();
  if (/timeout|timed out|délai/i.test(m)) {
    return "La recherche a pris trop de temps. Vérifiez votre connexion, puis réessayez.";
  }
  if (/network|connexion|resolve|dns|offline/i.test(m)) {
    return "Pas de connexion réseau. Vérifiez Internet, puis réessayez.";
  }
  if (/sign in|bot|confirm|captcha|429|403/i.test(m)) {
    return "YouTube a temporairement limité la recherche. Réessayez dans un moment.";
  }
  if (/annul/i.test(m)) return raw;
  return raw.length > 220 ? `${raw.slice(0, 220)}…` : raw;
}

/**
 * Pilote la recherche YouTube.
 *
 * - une seule requête réseau à la fois : chaque nouvelle recherche annule la
 *   précédente (le process yt-dlp en cours est tué côté Rust) ;
 * - les réponses obsolètes sont ignorées (jeton `run`), pas d'écrasement d'état ;
 * - « Charger plus » augmente la page demandée, ce que le cache local sait
 *   servir sans réseau tant que la limite n'est pas dépassée.
 */
export function useYouTubeSearch(pageSize: number) {
  const [state, setState] = useState<State>(() => ({ ...INITIAL, limit: pageSize }));
  const runRef = useRef(0);
  const tabRef = useRef<SearchTab>("video");
  const pageSizeRef = useRef(pageSize);
  pageSizeRef.current = pageSize;

  const run = useCallback(async (query: string, tab: SearchTab, limit: number, append: boolean) => {
    const id = ++runRef.current;
    setState((s) => ({
      ...s,
      status: "loading",
      query,
      tab,
      limit,
      error: null,
      cached: false,
      ...(append ? {} : { items: [], hasMore: false, elapsedMs: 0 }),
    }));
    try {
      const page: SearchPage = await searchYoutube(query, tab, limit);
      if (id !== runRef.current) return;
      setState((s) => ({
        ...s,
        status: "ready",
        items: append ? mergeUnique(s.items, page.items) : page.items,
        cached: page.cached,
        elapsedMs: page.elapsedMs,
        hasMore: page.hasMore,
        error: null,
      }));
    } catch (e) {
      if (id !== runRef.current) return;
      const msg = errText(e);
      const cancelled = /annul/i.test(msg);
      setState((s) => ({
        ...s,
        status: cancelled ? "idle" : "error",
        error: cancelled ? null : msg,
        items: append ? s.items : [],
        hasMore: cancelled ? false : s.hasMore,
      }));
    }
  }, []);

  const submit = useCallback(
    (raw: string) => {
      const q = raw.trim();
      if (q.length < 2) return;
      // Stoppe la recherche précédente avant d'en lancer une nouvelle.
      void cancelSearch().catch(() => {});
      void run(q, tabRef.current, pageSizeRef.current, false);
    },
    [run]
  );

  const changeTab = useCallback(
    (tab: SearchTab) => {
      if (tab === tabRef.current) return;
      tabRef.current = tab;
      if (state.query) {
        void cancelSearch().catch(() => {});
        void run(state.query, tab, pageSizeRef.current, false);
      } else {
        setState((s) => ({ ...s, tab }));
      }
    },
    [run, state.query]
  );

  const loadMore = useCallback(() => {
    if (state.status !== "ready" || !state.hasMore || !state.query) return;
    const next = Math.min(state.limit + pageSizeRef.current, MAX_LIMIT);
    if (next === state.limit) return;
    void run(state.query, state.tab, next, true);
  }, [run, state.hasMore, state.limit, state.query, state.status, state.tab]);

  const cancel = useCallback(() => {
    runRef.current++;
    void cancelSearch().catch(() => {});
    setState((s) => (s.status === "loading" ? { ...s, status: "idle", error: null } : s));
  }, []);

  const reset = useCallback(() => {
    runRef.current++;
    void cancelSearch().catch(() => {});
    setState({ ...INITIAL, limit: pageSizeRef.current });
  }, []);

  // Quitter la page (ou l'application) ne doit pas laisser un process en fond.
  useEffect(() => () => void cancelSearch().catch(() => {}), []);

  return { ...state, submit, changeTab, loadMore, cancel, reset };
}
