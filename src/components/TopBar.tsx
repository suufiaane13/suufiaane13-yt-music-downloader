import { useEffect, useMemo, useState } from "react";
import { currentWindow } from "../services/windowApi";
import { Task } from "../services/api";
import WindowControls from "./WindowControls";

interface Props {
  connected: boolean;
  tasks: Task[];
  userLabel?: string;
}

function formatSpeed(bytes: number): string {
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB/s`;
  return `${(bytes / 1048576).toFixed(1)} MB/s`;
}

export default function TopBar({ connected, tasks, userLabel }: Props) {
  const [maximized, setMaximized] = useState(false);
  const active = tasks.filter((t) => ["queued", "downloading", "converting"].includes(t.status));
  const speed = active.reduce((sum, t) => sum + (t.speed_bytes || 0), 0);
  // `null` hors application (aperçu navigateur) : la barre reste utilisable.
  const appWindow = useMemo(currentWindow, []);

  // Suit l'état maximisé : quand la fenêtre est agrandie, sa barre doit rester
  // fixe et ne pas se déplacer — le maintenir-glisser est donc désactivé.
  useEffect(() => {
    if (!appWindow) return;
    let unlisten: (() => void) | undefined;
    appWindow
      .isMaximized()
      .then(setMaximized)
      .catch(() => {});
    appWindow
      .onResized(() => {
        appWindow.isMaximized().then(setMaximized).catch(() => {});
      })
      .then((un) => {
        unlisten = un;
      })
      .catch(() => {});
    return () => unlisten?.();
  }, [appWindow]);

  const toggleMaximize = () => {
    appWindow?.toggleMaximize().catch(() => {});
  };

  return (
    <header
      className="relative flex items-center h-12 pl-4 shrink-0 border-b border-dark-700/70 bg-dark-900 select-none"
      onDoubleClick={toggleMaximize}
    >
      <div
        className="flex-1 h-full"
        {...(maximized ? {} : { "data-tauri-drag-region": true })}
        onDoubleClick={toggleMaximize}
      />

      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="flex items-center gap-2.5 h-7 px-3 rounded-md border border-dark-600/50 bg-dark-900/40 backdrop-blur-sm shadow-[inset_0_1px_0_rgba(255,255,255,.04)]">
          <span className="flex items-center gap-1.5 text-[9.5px] font-bold tracking-widest text-accent-400 uppercase">
            <span className="w-1 h-1 rounded-full bg-accent-400 shadow-[0_0_6px_rgba(255,59,92,.9)]" />
            dev
          </span>
          <span className="w-px h-3.5 bg-dark-600/70" />
          <span className="text-[12px] font-semibold text-white/95 tracking-wide">
            {userLabel || "YT Music Downloader"}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-3 mr-3">
        {speed > 0 && (
          <span className="text-[12px] font-semibold text-accent-400 tnum">{formatSpeed(speed)}</span>
        )}
        {active.length > 0 && (
          <span className="badge bg-accent-500/15 text-accent-300 border border-accent-500/25">
            {active.length} actif{active.length > 1 ? "s" : ""}
          </span>
        )}
        <span
          className={`relative inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full border text-[10px] font-semibold overflow-hidden ${
            connected
              ? "border-green-500/40 bg-green-500/10 text-green-400"
              : "border-amber-500/40 bg-amber-500/10 text-amber-400"
          }`}
        >
          <span className="relative flex w-1.5 h-1.5 shrink-0">
            <span
              className={`absolute inline-flex h-full w-full rounded-full opacity-60 animate-ping ${
                connected ? "bg-green-400" : "bg-amber-400"
              }`}
              style={{ animationDuration: "1.8s" }}
            />
            <span
              className={`relative inline-flex w-1.5 h-1.5 rounded-full ${
                connected ? "bg-green-400" : "bg-amber-400 animate-pulse"
              }`}
            />
          </span>
          <span className={connected ? "animate-soft-pulse tracking-wider" : "tracking-wider"}>
            {connected ? "CONNECTÉ" : "DÉMARRAGE"}
          </span>
          {connected && (
            <span className="absolute inset-0 pointer-events-none animate-shimmer bg-gradient-to-r from-transparent via-white/20 to-transparent w-1/4" />
          )}
        </span>
      </div>

      <WindowControls />
    </header>
  );
}