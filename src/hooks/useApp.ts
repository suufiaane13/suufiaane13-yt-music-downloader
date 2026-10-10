import { useEffect, useRef, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  Task,
  Settings,
  EngineCheck,
  getTasks,
  getSettings,
  checkEngine,
  clearCompleted as clearCompletedApi,
  DEFAULT_SETTINGS,
} from "../services/api";
import { toastError } from "../components/Toasts";
import { notify } from "../services/notify";

export type BootPhase = "settings" | "tasks" | "engine" | "ready";

const MIN_BOOT_MS = 900;

export function useApp() {
  const [ready, setReady] = useState(false);
  const [phase, setPhase] = useState<BootPhase>("settings");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [engine, setEngine] = useState<EngineCheck | null>(null);
  const unlistenRef = useRef<UnlistenFn | null>(null);
  const bufferRef = useRef<Map<string, Task>>(new Map());
  const timerRef = useRef<number | null>(null);
  const engineRef = useRef<EngineCheck | null>(null);
  const prevStatusRef = useRef<Map<string, string>>(new Map());

  const applyEngine = (ec: EngineCheck) => {
    engineRef.current = ec;
    setEngine(ec);
  };

  useEffect(() => {
    let cancelled = false;
    const bootStart = performance.now();

    const boot = async () => {
      try {
        const s = await getSettings();
        if (!cancelled) setSettings({ ...DEFAULT_SETTINGS, ...s });
        if (cancelled) return;
        setPhase("tasks");

        const t = await getTasks();
        if (!cancelled) {
          setTasks(t);
          const m = new Map<string, string>();
          t.forEach((x) => m.set(x.id, x.status));
          prevStatusRef.current = m;
        }
        if (cancelled) return;
        setPhase("engine");

        const ec = await checkEngine();
        if (!cancelled) applyEngine(ec);
      } catch {
        toastError("Connexion au moteur impossible", "Impossible de joindre l'application native.");
      } finally {
        if (cancelled) return;
        const elapsed = performance.now() - bootStart;
        await new Promise((r) => setTimeout(r, Math.max(0, MIN_BOOT_MS - elapsed)));
        if (cancelled) return;
        setPhase("ready");
        setReady(true);
      }
    };

    boot();

    listen<Task>("task-updated", (event) => {
      bufferRef.current.set(event.payload.id, event.payload);
      if (timerRef.current !== null) return;
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        const map = bufferRef.current;
        bufferRef.current = new Map();
        if (map.size === 0) return;
        setTasks((prev) => {
          const copy = [...prev];
          map.forEach((t) => {
            const prevStatus = prevStatusRef.current.get(t.id);
            prevStatusRef.current.set(t.id, t.status);
            if (prevStatus && prevStatus !== t.status) {
              if (t.status === "completed") {
                const label = t.title || t.url;
                void notify("Téléchargement terminé", label);
              } else if (t.status === "error") {
                void notify("Échec du téléchargement", t.error || t.title || t.url);
              }
            }
            const idx = copy.findIndex((x) => x.id === t.id);
            if (idx >= 0) copy[idx] = t;
            else copy.push(t);
          });
          return copy;
        });
      }, 60);
    })
      .then((un) => {
        unlistenRef.current = un;
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      unlistenRef.current?.();
    };
  }, []);

  useEffect(() => {
    if (phase !== "ready") return;
    const engineOk =
      !!engineRef.current?.ytDlp &&
      !!engineRef.current?.ffmpeg &&
      !!engineRef.current?.ffprobe;
    const intervalMs = engineOk ? 60_000 : 5_000;
    const id = window.setInterval(async () => {
      try {
        applyEngine(await checkEngine());
      } catch {
      }
    }, intervalMs);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, engine?.ytDlp, engine?.ffmpeg, engine?.ffprobe]);

  const clearCompleted = async () => {
    try {
      const removed = await clearCompletedApi();
      if (removed.length > 0) {
        const ids = new Set(removed);
        setTasks((prev) => prev.filter((t) => !ids.has(t.id)));
      }
    } catch {
    }
  };

  const refreshEngine = async () => {
    try {
      applyEngine(await checkEngine());
    } catch {
      toastError("Vérification impossible", "Impossible de joindre l'application native.");
    }
  };

  return {
    ready,
    phase,
    tasks,
    setTasks,
    settings,
    setSettings,
    engine,
    clearCompleted,
    refreshEngine,
  };
}
