import { useEffect, useState } from "react";
import { useApp } from "./hooks/useApp";
import Sidebar from "./components/Sidebar";
import TopBar from "./components/TopBar";
import ProgressStrip from "./components/ProgressStrip";
import FooterBar from "./components/FooterBar";
import PlayerBar from "./components/PlayerBar";
import { PlayerProvider } from "./player/PlayerContext";
import BootScreen from "./components/BootScreen";
import Onboarding from "./components/Onboarding";
import BrowsePage from "./pages/BrowsePage";
import DownloadsPage from "./pages/DownloadsPage";
import SettingsPage from "./pages/SettingsPage";
import LecturePage from "./pages/LecturePage";
import ExplorePage from "./pages/ExplorePage";
import { Task, cancelTask, retryTask, formatUserName, openPath } from "./services/api";
import { currentWindow } from "./services/windowApi";
import { ToastHost, toastSuccess, toastWarning, toastError } from "./components/Toasts";
import { useCompact } from "./hooks/useCompact";

type Tab = "browse" | "explore" | "lecture" | "downloads" | "settings";

interface MenuState {
  x: number;
  y: number;
  task: Task | null;
  input?: boolean;
}

const ACTIVE = ["queued", "downloading", "converting"];
const MENU_W = 220;
const MENU_H = 328;

export default function App() {
  const {
    ready,
    phase,
    tasks,
    setTasks,
    settings,
    setSettings,
    engine,
    clearCompleted,
    refreshEngine,
  } = useApp();
  const { compact } = useCompact();
  const [activeTab, setActiveTab] = useState<Tab>("browse");
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [bootDone, setBootDone] = useState(false);
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);

  // L'écran de démarrage n'est jamais monté tant qu'on ne connaît pas encore
  // l'identité sauvegardée (settings) : on évite ainsi de voir l'app puis le
  // formulaire quelques secondes après.
  const needsUser =
    !settings.user_first_name.trim() || !settings.user_last_name.trim();
  const showOnboarding = needsUser && !onboardingDismissed;

  const userLabel = formatUserName(settings);

  const completeOnboarding = (first: string, last: string) => {
    setSettings({ ...settings, user_first_name: first, user_last_name: last });
    setOnboardingDismissed(true);
  };

  // Après le passage à "ready", laisse le BootScreen afficher "Connecté"
  // un instant puis le démonte. Tant qu'il manque une identité, le BootScreen
  // reste masqué au profit du formulaire d'accueil.
  useEffect(() => {
    if (phase !== "ready" || showOnboarding) return;
    const id = window.setTimeout(() => setBootDone(true), 820);
    return () => window.clearTimeout(id);
  }, [phase, showOnboarding]);

  const activeTaskCount = tasks.filter((t) => !["completed", "error", "cancelled"].includes(t.status)).length;

  const engineChecked = engine !== null;
  const engineOk = !!engine && engine.ytDlp && engine.ffmpeg && engine.ffprobe;

  const showMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const target = e.target as Element;
    const x = Math.max(8, Math.min(e.clientX, window.innerWidth - MENU_W - 8));
    const y = Math.max(8, Math.min(e.clientY, window.innerHeight - MENU_H - 8));
    // Sur le champ URL : menu réduit avec « Coller l'URL » uniquement.
    if (target.closest("[data-url-input]")) {
      setMenu({ x, y, task: null, input: true });
      return;
    }
    const el = target.closest<HTMLElement>('[data-context="task"]');
    const task = el?.dataset.id ? tasks.find((t) => t.id === el.dataset.id) ?? null : null;
    setMenu({ x, y, task, input: false });
  };

  const closeMenu = () => setMenu(null);

  useEffect(() => {
    if (!menu) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") closeMenu();
    };
    window.addEventListener("click", closeMenu);
    window.addEventListener("resize", closeMenu);
    window.addEventListener("blur", closeMenu);
    window.addEventListener("keydown", onKey);
    document.addEventListener("scroll", closeMenu, true);
    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("resize", closeMenu);
      window.removeEventListener("blur", closeMenu);
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("scroll", closeMenu, true);
    };
  }, [menu]);

  const go = (tab: Tab) => {
    setActiveTab(tab);
    closeMenu();
  };

  // Depuis « Explorer » : analyse l'URL dans l'onglet Musiques & playlists
  // (le champ URL écoute l'événement `ytmd-paste-url` au montage).
  const openInBrowse = (url: string) => {
    go("browse");
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent("ytmd-paste-url", { detail: url }));
    }, 120);
  };

  const copyUrl = async (url: string) => {
    closeMenu();
    try {
      await navigator.clipboard.writeText(url);
      toastSuccess("URL copiée", url);
    } catch {
      toastWarning("Impossible de copier", "Le presse-papiers n'est pas accessible.");
      closeMenu();
    }
  };

  // Colle le contenu du presse-papiers dans le champ URL (onglet Naviguer).
  const pasteUrl = async () => {
    setActiveTab("browse");
    try {
      const text = await navigator.clipboard.readText();
      if (text.trim()) {
        const url = text.trim();
        // Laisse le temps au champ d'être monté avant de lui transmettre la valeur.
        window.setTimeout(() => {
          window.dispatchEvent(new CustomEvent("ytmd-paste-url", { detail: url }));
        }, 80);
      }
    } catch {
    }
  };

  const runAction = (fn: () => void) => {
    fn();
    closeMenu();
  };

  const missingBins = engine
    ? [
        !engine.ytDlp ? "yt-dlp" : null,
        !engine.ffmpeg ? "ffmpeg" : null,
        !engine.ffprobe ? "ffprobe" : null,
      ].filter(Boolean) as string[]
    : [];

  return (
    <PlayerProvider>
      <div
        className={`flex h-screen bg-dark-900 text-dark-100 ${compact ? "compact" : ""}`}
        onContextMenu={showMenu}
        data-testid="app-root"
      >
      <Sidebar
        activeTab={activeTab}
        onTabChange={go}
        taskCount={activeTaskCount}
        firstName={settings.user_first_name}
        lastName={settings.user_last_name}
      />

      <div className="flex-1 flex flex-col min-w-0">
        <TopBar connected={ready} tasks={tasks} userLabel={userLabel} />
        <ProgressStrip tasks={tasks} />

        {engineChecked && engineOk && (
          <div
            className="shrink-0 px-4 py-1.5 bg-green-500/10 border-b border-green-500/20 flex items-center gap-2 text-[10.5px] text-green-400"
            title={`Moteur vérifié dans : ${engine?.binDir}`}
            data-testid="engine-ok"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 shrink-0" />
            <span>Moteur prêt — yt-dlp, ffmpeg et ffprobe disponibles.</span>
            <span className="ml-auto text-green-500/70 hidden lg:inline truncate pr-1" title={engine?.binDir}>
              {engine?.binDir}
            </span>
          </div>
        )}

        {engineChecked && engineOk && engine && engine.jsRuntime === false && (
          <div
            className="shrink-0 px-4 py-1.5 bg-amber-500/10 border-b border-amber-500/25 flex items-center gap-2 text-[10.5px] text-amber-200"
            data-testid="engine-js-missing"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
            <span className="truncate">
              Runtime JS (deno.exe) absent du dossier bin — certains formats YouTube peuvent échouer.
              Placez deno.exe à côté de yt-dlp pour une extraction plus fiable.
            </span>
          </div>
        )}

        {engineChecked && !engineOk && (
          <div
            className="shrink-0 px-4 py-1.5 bg-red-500/10 border-b border-red-500/25 flex items-center gap-2 text-[10.5px] text-red-300"
            data-testid="engine-missing"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-red-400 shrink-0" />
            <span className="truncate">
              Moteur incomplet — manquant : {missingBins.join(", ") || "binaires"}.
            </span>
            <button
              type="button"
              className="ml-auto shrink-0 px-2 py-0.5 rounded border border-red-500/30 hover:bg-red-500/15"
              onClick={() => void refreshEngine()}
            >
              Re-vérifier
            </button>
            {engine?.binDir && (
              <button
                type="button"
                className="shrink-0 px-2 py-0.5 rounded border border-red-500/30 hover:bg-red-500/15"
                onClick={() =>
                  void openPath(engine.binDir).catch(() =>
                    toastError("Ouverture impossible", "Dossier bin introuvable.")
                  )
                }
              >
                Ouvrir bin
              </button>
            )}
          </div>
        )}

        <main className="flex-1 min-h-0 flex flex-col" data-testid={`page-${activeTab}`}>
          {activeTab === "browse" && (
            <BrowsePage
              connected={ready}
              defaultMedia={settings.default_media}
              defaultVideoFormat={settings.video_format}
            />
          )}
          {activeTab === "explore" && (
            <ExplorePage engineReady={engineOk} onOpenInBrowse={openInBrowse} />
          )}
          {activeTab === "lecture" && <LecturePage outputDir={settings.output_dir} />}
          {activeTab === "downloads" && (
            <DownloadsPage
              tasks={tasks}
              onTasksChange={setTasks}
              onClearCompleted={clearCompleted}
              outputDir={settings.output_dir}
            />
          )}
          {activeTab === "settings" && (
            <SettingsPage settings={settings} onSettingsChange={setSettings} engine={engine} />
          )}
        </main>

        <PlayerBar />
        <FooterBar tasks={tasks} />
      </div>

      <ToastHost />

      {menu && (
        <div
          className="fixed z-50 w-[220px] rounded-xl border border-dark-600/70 bg-dark-800 p-1 shadow-[0_16px_48px_-12px_rgba(0,0,0,.8)]"
          style={{ left: menu.x, top: menu.y }}
        >
          {menu.input ? (
            <MenuButton icon={<PasteIcon />} onClick={() => runAction(() => void pasteUrl())}>
              Coller l'URL
            </MenuButton>
          ) : (
            <>
              {menu.task && (
                <>
                  <div className="px-2.5 pt-1.5 pb-1">
                    <p className="text-[10px] font-semibold tracking-wider text-dark-400 uppercase">
                      Téléchargement
                    </p>
                    <p className="text-[11px] text-dark-200 truncate mt-0.5" title={menu.task.title}>
                      {menu.task.title || menu.task.url}
                    </p>
                  </div>
                  <MenuButton icon={<CopyIcon />} onClick={() => runAction(() => void copyUrl(menu.task!.url))}>
                    Copier l'URL
                  </MenuButton>
                  {(menu.task.status === "error" || menu.task.status === "cancelled") && (
                    <MenuButton icon={<RetryIcon />} onClick={() => runAction(() => void retryTask(menu.task!.id))}>
                      Réessayer
                    </MenuButton>
                  )}
                  {ACTIVE.includes(menu.task.status) && (
                    <MenuButton danger icon={<XIcon />} onClick={() => runAction(() => void cancelTask(menu.task!.id))}>
                      Annuler
                    </MenuButton>
                  )}
                  <MenuSep />
                </>
              )}
              <MenuButton icon={<CompassIcon />} onClick={() => go("explore")}>
                Explorer YouTube
              </MenuButton>
              <MenuButton icon={<ListIcon />} onClick={() => go("downloads")}>
                Téléchargements
              </MenuButton>
              <MenuButton icon={<GearIcon />} onClick={() => go("settings")}>
                Paramètres
              </MenuButton>
              <MenuSep />
              <MenuButton icon={<ReloadIcon />} onClick={() => window.location.reload()}>
                Recharger la fenêtre
              </MenuButton>
              <MenuButton
                danger
                icon={<PowerIcon />}
                onClick={() => runAction(async () => {
                  // Masque dans le bac système (les téléchargements continuent).
                  // Pour quitter vraiment : menu tray → Quitter.
                  await currentWindow()?.close();
                })}
              >
                Masquer
              </MenuButton>
            </>
          )}
        </div>
      )}

      {!bootDone && !showOnboarding && (
        <BootScreen
          phase={phase}
          fading={phase === "ready"}
          firstName={settings.user_first_name}
          lastName={settings.user_last_name}
        />
      )}

      {showOnboarding && (
        <Onboarding
          firstName={settings.user_first_name}
          lastName={settings.user_last_name}
          onComplete={completeOnboarding}
        />
      )}
    </div>
    </PlayerProvider>
  );
}

function MenuButton({
  icon,
  children,
  danger,
  onClick,
}: {
  icon?: React.ReactNode;
  children: React.ReactNode;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2 h-8 px-2.5 rounded-md text-left text-[12px] font-medium transition-colors ${
        danger ? "text-red-400 hover:bg-red-500/10" : "text-dark-100 hover:text-white hover:bg-white/5"
      }`}
    >
      <span className="w-4 h-4 shrink-0 flex items-center justify-center">{icon}</span>
      <span className="flex-1 truncate">{children}</span>
    </button>
  );
}

function MenuSep() {
  return <div className="h-px bg-dark-700 my-1" />;
}

function CopyIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function RetryIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 4 23 10 17 10" />
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function CompassIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <polygon points="15.5 8.5 13.5 13.5 8.5 15.5 10.5 10.5 15.5 8.5" />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" />
      <line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  );
}

function PasteIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
      <rect x="8" y="2" width="8" height="4" rx="1" />
      <rect x="9" y="12" width="6" height="6" rx="1" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function ReloadIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 4 23 10 17 10" />
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </svg>
  );
}

function PowerIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
      <line x1="12" y1="2" x2="12" y2="12" />
    </svg>
  );
}