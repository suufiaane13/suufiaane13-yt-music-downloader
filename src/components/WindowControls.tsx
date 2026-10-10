import { useEffect, useMemo, useState } from "react";
import { currentWindow } from "../services/windowApi";

export default function WindowControls() {
  const [maximized, setMaximized] = useState(false);
  // Hors application (aperçu navigateur) il n'y a pas de fenêtre à piloter :
  // les boutons sont alors masqués plutôt que de lever une exception.
  const appWindow = useMemo(currentWindow, []);

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

  if (!appWindow) return null;

  return (
    <div className="flex items-center gap-1 h-[calc(100%-12px)] mr-3 px-1.5 rounded-xl border border-dark-600/50 bg-dark-800/50 shadow-[inset_0_1px_0_rgba(255,255,255,.04),0_4px_12px_-4px_rgba(0,0,0,.6)]">
      <button
        onClick={() => appWindow.minimize()}
        className="wm-btn w-9 h-7 flex items-center justify-center rounded-lg text-dark-300 hover:text-accent-300 hover:bg-accent-500/15 group active:scale-95 transition-all"
        title="Réduire"
      >
        <span className="wm-glyph">
          <MinimizeIcon />
        </span>
        <span className="wm-sheen" />
      </button>
      <button
        onClick={() => appWindow.toggleMaximize()}
        className="wm-btn w-9 h-7 flex items-center justify-center rounded-lg text-dark-300 hover:text-accent-300 hover:bg-accent-500/15 group active:scale-95 transition-all"
        title={maximized ? "Restaurer" : "Agrandir"}
      >
        <span className="wm-glyph">
          {maximized ? <RestoreIcon /> : <MaximizeIcon />}
        </span>
        <span className="wm-sheen" />
        {maximized && <span className="wm-restore-ring" />}
      </button>
      <button
        onClick={() => appWindow.close()}
        className="wm-btn wm-close w-9 h-7 flex items-center justify-center rounded-lg text-dark-300 hover:text-red-300 hover:bg-red-500/20 group active:scale-95 transition-all"
        title="Masquer (les téléchargements continuent)"
      >
        <span className="wm-glyph">
          <CloseIcon />
        </span>
        <span className="wm-sheen" />
      </button>
    </div>
  );
}

function MinimizeIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function MaximizeIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="5.5" y="5.5" width="13" height="13" rx="1.5" />
    </svg>
  );
}

function RestoreIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="6.5" y="9" width="9" height="9" rx="1.5" />
      <path d="M9 6.5h6.5a2 2 0 0 1 2 2V15" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="6" y1="18" x2="18" y2="6" />
    </svg>
  );
}