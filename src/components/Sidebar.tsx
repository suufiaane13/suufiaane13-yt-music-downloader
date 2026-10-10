type Tab = "browse" | "explore" | "lecture" | "downloads" | "settings";

interface Props {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
  taskCount: number;
  firstName?: string;
  lastName?: string;
}

export default function Sidebar({ activeTab, onTabChange, taskCount, firstName, lastName }: Props) {
  const displayFirst = (firstName ?? "").trim();
  const displayLast = (lastName ?? "").trim();
  const hasUser = !!(displayFirst || displayLast);
  const initials = hasUser
    ? `${displayFirst.charAt(0)}${displayLast.charAt(0) || displayFirst.charAt(1) || ""}`.toUpperCase()
    : "?";

  return (
    <aside
      className="w-48 shrink-0 bg-dark-800/50 border-r border-dark-700/70 flex flex-col select-none compact:w-40"
      data-testid="sidebar"
    >
      <button
        onClick={() => onTabChange("browse")}
        className="h-12 flex items-center gap-2.5 px-3.5 hover:bg-white/5 transition-colors text-left"
        title="YT Music Downloader"
      >
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-accent-500 to-accent-700 flex items-center justify-center shadow-glow-accent shrink-0">
          <MusicNoteIcon />
        </div>
        <div className="leading-none min-w-0">
          <p className="text-[13px] font-bold text-white truncate">YT Music</p>
          <p className="text-[10px] text-dark-300 mt-1 truncate">Downloader</p>
        </div>
      </button>

      <div className="px-3.5 pt-3">
        <p className="px-2 text-[10px] font-semibold tracking-wider text-dark-500 uppercase">Navigation</p>
      </div>

      <nav className="flex flex-col gap-1 px-3 mt-2">
        <NavItem
          active={activeTab === "browse"}
          onClick={() => onTabChange("browse")}
          label="Musiques"
          title="Musiques & playlists"
          testId="nav-browse"
        >
          <SearchIcon />
        </NavItem>
        <NavItem
          active={activeTab === "explore"}
          onClick={() => onTabChange("explore")}
          label="Explorer"
          title="Rechercher sur YouTube et télécharger"
          testId="nav-explore"
        >
          <CompassIcon />
        </NavItem>
        <NavItem
          active={activeTab === "lecture"}
          onClick={() => onTabChange("lecture")}
          label="Lecture"
          title="Écouter les musiques du dossier"
          testId="nav-lecture"
        >
          <HeadphonesIcon />
        </NavItem>
        <NavItem
          active={activeTab === "downloads"}
          onClick={() => onTabChange("downloads")}
          label="Téléchargements"
          badge={taskCount}
          title="Téléchargements"
          testId="nav-downloads"
        >
          <DownloadIcon />
        </NavItem>
        <NavItem
          active={activeTab === "settings"}
          onClick={() => onTabChange("settings")}
          label="Paramètres"
          title="Paramètres"
          testId="nav-settings"
        >
          <SettingsIcon />
        </NavItem>
      </nav>

      <div className="mt-auto px-3.5 pb-3 space-y-2">
        {hasUser && (
          <div className="group relative flex items-center gap-2.5 rounded-xl border border-dark-600/50 bg-gradient-to-br from-dark-700/40 to-dark-800/40 px-2.5 py-2 select-none overflow-hidden hover:border-accent-500/30 transition-colors">
            <div className="relative w-8 h-8 rounded-full bg-gradient-to-br from-accent-500 to-accent-700 flex items-center justify-center text-[10px] font-bold text-white shrink-0 shadow-glow-accent ring-1 ring-white/10">
              {initials}
              <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-green-400 border-2 border-dark-800" />
            </div>
            <div className="leading-tight min-w-0">
              <p className="text-[11.5px] font-semibold text-white truncate" title={`${displayFirst} ${displayLast}`}>
                {displayFirst} {displayLast}
              </p>
              <p className="flex items-center gap-1 text-[9px] text-accent-300/90 tracking-wide">
                <span className="w-1 h-1 rounded-full bg-accent-500" />
                Titulaire du projet
              </p>
            </div>
            <span className="pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity bg-gradient-to-t from-accent-500/5 to-transparent" />
          </div>
        )}
      </div>
    </aside>
  );
}

function NavItem({
  children,
  label,
  active,
  onClick,
  badge,
  title,
  testId,
}: {
  children: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
  badge?: number;
  title: string;
  testId?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      data-testid={testId}
      className={`relative flex items-center gap-2.5 h-9 px-2.5 rounded-lg text-[12.5px] font-medium transition-all group ${
        active ? "bg-accent-500/12 text-white" : "text-dark-300 hover:text-white hover:bg-white/5"
      }`}
    >
      {active && (
        <span className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-[3px] rounded-r-full bg-accent-500 shadow-glow-accent" />
      )}
      <span
        className={`shrink-0 transition-colors ${active ? "text-accent-400" : "text-dark-300 group-hover:text-white"}`}
      >
        {children}
      </span>
      <span className="truncate">{label}</span>
      {badge !== undefined && badge > 0 && (
        <span className="ml-auto min-w-5 h-5 px-1.5 bg-accent-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center shadow-glow-accent shrink-0">
          {badge > 9 ? "9+" : badge}
        </span>
      )}
    </button>
  );
}

function MusicNoteIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="white" stroke="none">
      <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55C7.79 13 6 14.79 6 17s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
    </svg>
  );
}

function HeadphonesIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
      <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function CompassIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <polygon points="15.5 8.5 13.5 13.5 8.5 15.5 10.5 10.5 15.5 8.5" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}