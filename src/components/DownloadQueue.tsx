import { useMemo, useState } from "react";
import { Task, cancelTask, cancelJob, retryFailed, retryTask, cancelAll, redownloadAll, redownloadFailed, openPath } from "../services/api";
import { toastSuccess, toastError } from "./Toasts";

interface Props {
  tasks: Task[];
  onClearCompleted: () => Promise<void>;
  /** Remonter / descendre une tâche dans l'ordre global. */
  onMoveTask?: (id: string, dir: -1 | 1) => void;
}

type Filter = "all" | "active" | "done" | "annulled" | "errors";
type MediaFilter = "all" | "audio" | "video";

const TERMINAL = ["completed", "error", "cancelled"];
const ACTIVE_STATUS = ["queued", "downloading", "converting"];

function taskMedia(task: Task): "audio" | "video" {
  if (task.media === "video" || task.media === "audio") return task.media;
  const p = (task.output_path || "").toLowerCase();
  return p.endsWith(".mp4") ? "video" : "audio";
}

function isJob(task: Task): boolean {
  return task.job_total !== undefined;
}

function failedCount(task: Task): number {
  if (isJob(task)) {
    const failed = task.job_failed || 0;
    if (failed > 0) return failed;
    // Job dont l'analyse de la playlist a échoué : un seul élément à rejouer
    // (même règle que le compteur renvoyé par la commande Rust).
    return task.status === "error" ? 1 : 0;
  }
  return task.status === "error" ? 1 : 0;
}

function hasFailed(task: Task): boolean {
  return failedCount(task) > 0;
}

function formatSpeed(bytes: number): string {
  if (bytes === 0) return "---";
  if (bytes < 1024) return `${bytes} B/s`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB/s`;
  return `${(bytes / 1048576).toFixed(1)} MB/s`;
}

function formatEta(seconds: number): string {
  if (seconds <= 0) return "";
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

function statusLabel(status: Task["status"]): string {
  const labels: Record<string, string> = {
    queued: "En attente",
    downloading: "Téléchargement",
    converting: "Conversion",
    completed: "Terminé",
    error: "Erreur",
    cancelled: "Annulé",
  };
  return labels[status] || status;
}

const STATUS_BADGE: Record<string, string> = {
  queued: "bg-dark-500/30 text-dark-200 border border-dark-500",
  downloading: "bg-accent-500/15 text-accent-300 border border-accent-500/25",
  converting: "bg-amber-500/15 text-amber-300 border border-amber-500/25",
  completed: "bg-green-500/15 text-green-400 border border-green-500/25",
  error: "bg-red-500/15 text-red-400 border border-red-500/25",
  cancelled: "bg-dark-600/40 text-dark-300 border border-dark-500",
};

const ROW_STYLE: Record<string, string> = {
  queued: "border-dark-600/70 bg-dark-800/60",
  downloading: "border-dark-600/80 bg-dark-800/80",
  converting: "border-amber-500/20 bg-dark-800/80",
  completed: "border-dark-700/60 bg-dark-800/40",
  error: "border-red-500/30 bg-red-500/5",
  cancelled: "border-dark-700/50 bg-dark-800/30",
};

export default function DownloadQueue({ tasks, onClearCompleted, onMoveTask }: Props) {
  const [filter, setFilter] = useState<Filter>("all");
  const [mediaFilter, setMediaFilter] = useState<MediaFilter>("all");
  const [retryingFailed, setRetryingFailed] = useState(false);
  const [view, setView] = useState<"cards" | "list">(() => {
    try {
      return localStorage.getItem("ytmd.view.downloads") === "list" ? "list" : "cards";
    } catch {
      return "cards";
    }
  });

  const changeView = (v: "cards" | "list") => {
    setView(v);
    try {
      localStorage.setItem("ytmd.view.downloads", v);
    } catch {}
  };

  const byMedia = useMemo(
    () =>
      mediaFilter === "all"
        ? tasks
        : tasks.filter((t) => taskMedia(t) === mediaFilter),
    [tasks, mediaFilter]
  );

  const counts = useMemo(
    () => ({
      all: byMedia.length,
      active: byMedia.filter((t) => ACTIVE_STATUS.includes(t.status)).length,
      done: byMedia.filter((t) => TERMINAL.includes(t.status)).length,
      errors: byMedia.reduce((sum, t) => sum + failedCount(t), 0),
      annulled: byMedia.filter((t) => t.status === "cancelled").length,
      completed: byMedia.filter((t) => t.status === "completed").length,
      audio: tasks.filter((t) => taskMedia(t) === "audio").length,
      video: tasks.filter((t) => taskMedia(t) === "video").length,
    }),
    [byMedia, tasks]
  );

  const filtered = useMemo(
    () =>
      byMedia.filter((t) => {
        if (filter === "active") return ACTIVE_STATUS.includes(t.status);
        if (filter === "done") return TERMINAL.includes(t.status);
        if (filter === "errors") return hasFailed(t);
        if (filter === "annulled") return t.status === "cancelled";
        return true;
      }),
    [byMedia, filter]
  );

  const groups = useMemo(
    () =>
      [
        { key: "active" as const, label: "En cours", items: filtered.filter((t) => ACTIVE_STATUS.includes(t.status)) },
        { key: "errors" as const, label: "Erreurs", items: filtered.filter((t) => hasFailed(t)) },
        { key: "done" as const, label: "Terminés", items: filtered.filter((t) => t.status === "completed" || t.status === "cancelled") },
      ].filter((g) => g.items.length > 0),
    [filtered]
  );

  const activeTasks = useMemo(() => tasks.filter((t) => ACTIVE_STATUS.includes(t.status)), [tasks]);

  const totalSpeed = useMemo(
    () => activeTasks.reduce((s, t) => s + (t.status === "downloading" ? (t.speed_bytes || t.job_speed || 0) : 0), 0),
    [activeTasks]
  );

  const globalEta = useMemo(
    () => Math.max(0, ...activeTasks.map((t) => t.eta || t.job_eta || 0)),
    [activeTasks]
  );

  const globalProgress = activeTasks.length
    ? activeTasks.reduce((s, t) => s + t.progress, 0) / activeTasks.length
    : 0;

  if (tasks.length === 0) {
    return <EmptyHero />;
  }

  const handleClear = async () => {
    try {
      await onClearCompleted();
      toastSuccess("Liste nettoyée", "Les téléchargements terminés ont été retirés de la file.");
    } catch {
      toastError("Échec du nettoyage", "La liste des téléchargements n'a pas pu être mise à jour.");
    }
  };

  const handleCancelAll = async () => {
    try {
      await cancelAll();
      toastSuccess("Téléchargements annulés", "La file en cours et en attente a été stoppée.");
    } catch {
      toastError("Annulation impossible", "Certaines tâches n'ont pas pu être annulées.");
    }
  };

  // Bouton visible seulement s'il reste des non-terminés (erreur / annulé).
  const canRedownload = counts.errors + counts.annulled > 0;

  const handleRedownloadAll = async () => {
    try {
      const n = await redownloadAll();
      if (n > 0) {
        toastSuccess(
          "Re-téléchargement lancé",
          `${n} tâche${n > 1 ? "s" : ""} non terminée${n > 1 ? "s" : ""} remise${n > 1 ? "s" : ""} en file (terminés exclus).`
        );
      } else {
        toastSuccess("Rien à relancer", "Les téléchargements réussis sont exclus.");
      }
    } catch {
      toastError("Re-téléchargement impossible", "Les téléchargements n'ont pas pu être relancés.");
    }
  };

  const handleRedownloadFailed = async () => {
    if (counts.errors === 0 || retryingFailed) return;
    setRetryingFailed(true);
    try {
      const n = await redownloadFailed();
      if (n > 0) {
        toastSuccess(
          "Échecs remis en file",
          `${n} élément${n > 1 ? "s" : ""} en échec sera${n > 1 ? "ont" : "a"} relancé${n > 1 ? "s" : ""}.`
        );
      } else {
        toastError("Aucun échec à relancer", "Les erreurs viennent peut-être d'être traitées.");
      }
    } catch {
      toastError("Relance impossible", "Les téléchargements en échec n'ont pas pu être relancés.");
    } finally {
      setRetryingFailed(false);
    }
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col px-4 pb-3 gap-2">
      <SummaryBar
        activeCount={counts.active}
        doneCount={counts.done}
        completedCount={counts.completed}
        errorCount={counts.errors}
        totalSpeed={totalSpeed}
        eta={globalEta}
        progress={globalProgress}
        canRedownload={canRedownload}
         failedCount={counts.errors}
         retryingFailed={retryingFailed}
        onClearCompleted={handleClear}
        onCancelAll={handleCancelAll}
        onRedownloadAll={handleRedownloadAll}
         onRedownloadFailed={handleRedownloadFailed}
      />

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 shrink-0">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-0.5 bg-dark-800/60 border border-dark-700/70 rounded-lg p-0.5">
            <FilterChip label="Tous" count={counts.all} active={filter === "all"} onClick={() => setFilter("all")} />
            <FilterChip label="Actifs" count={counts.active} active={filter === "active"} onClick={() => setFilter("active")} />
            <FilterChip label="Terminés" count={counts.done} active={filter === "done"} onClick={() => setFilter("done")} />
            <FilterChip label="Annulés" count={counts.annulled} active={filter === "annulled"} onClick={() => setFilter("annulled")} />
            <FilterChip label="Erreurs" count={counts.errors} active={filter === "errors"} onClick={() => setFilter("errors")} />
          </div>
          <div
            className="flex items-center gap-0.5 bg-dark-800/60 border border-dark-700/70 rounded-lg p-0.5"
            data-testid="downloads-media-filter"
          >
            <FilterChip
              label="Tous"
              count={tasks.length}
              active={mediaFilter === "all"}
              onClick={() => setMediaFilter("all")}
            />
            <FilterChip
              label="MP3"
              count={counts.audio}
              active={mediaFilter === "audio"}
              onClick={() => setMediaFilter("audio")}
            />
            <FilterChip
              label="MP4"
              count={counts.video}
              active={mediaFilter === "video"}
              onClick={() => setMediaFilter("video")}
            />
          </div>
        </div>
        <div className="flex items-center gap-2.5 shrink-0">
          <ViewToggle value={view} onChange={changeView} />
          {counts.done > 0 && (
            <span className="text-[11px] text-dark-400 tnum hidden sm:inline">
              {counts.done} terminé{counts.done > 1 ? "s" : ""}
            </span>
          )}
        </div>
      </div>

      {groups.length === 0 ? (
        <EmptyFilter />
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto pr-0.5 space-y-3">
          {groups.map((g) => (
            <div key={g.key} className="space-y-1.5">
              <SectionHeader label={g.label} count={g.items.length} />
              {view === "cards" ? (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5">
                  {g.items.map((task) =>
                    isJob(task) ? (
                      <JobRow key={task.id} task={task} />
                    ) : (
                      <TaskRow key={task.id} task={task} onMove={onMoveTask} />
                    )
                  )}
                </div>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {g.items.map((task) =>
                    isJob(task) ? (
                      <JobRow key={task.id} task={task} />
                    ) : (
                      <TaskRow key={task.id} task={task} onMove={onMoveTask} />
                    )
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SummaryBar({
  activeCount,
  doneCount,
  completedCount,
  errorCount,
  totalSpeed,
  eta,
  progress,
  canRedownload,
  failedCount,
  retryingFailed,
  onClearCompleted,
  onCancelAll,
  onRedownloadAll,
  onRedownloadFailed,
}: {
  activeCount: number;
  doneCount: number;
  completedCount: number;
  errorCount: number;
  totalSpeed: number;
  eta: number;
  progress: number;
  canRedownload: boolean;
  failedCount: number;
  retryingFailed: boolean;
  onClearCompleted: () => void;
  onCancelAll: () => void;
  onRedownloadAll: () => void;
  onRedownloadFailed: () => void;
}) {
  return (
    <div className="panel overflow-hidden shrink-0">
      <div className="flex items-center gap-3.5 px-3.5 py-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-accent-500 to-accent-700 shadow-glow-accent flex items-center justify-center text-white shrink-0">
          <DownloadGlyph />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="text-[13px] font-bold text-white">
              {activeCount > 0 ? `${activeCount} téléchargement${activeCount > 1 ? "s" : ""} en cours` : "File d'attente vide"}
            </span>
            <span className="text-[11px] text-dark-400 tnum">
              {doneCount} terminé{doneCount > 1 ? "s" : ""}
              {errorCount > 0 && <span className="text-red-400"> · {errorCount} erreur{errorCount > 1 ? "s" : ""}</span>}
            </span>
          </div>

          {activeCount > 0 ? (
            <div className="mt-1.5 flex items-center gap-2.5">
              <div className="flex-1 h-1 rounded-full bg-dark-600 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-accent-600 to-accent-400 transition-[width] duration-300 animate-pulse-slow"
                  style={{ width: `${Math.max(progress, 2)}%` }}
                />
              </div>
              <span className="text-[11px] text-accent-300 tnum shrink-0">{formatSpeed(totalSpeed)}</span>
              {eta > 0 && <span className="text-[11px] text-dark-400 tnum shrink-0">ETA {formatEta(eta)}</span>}
            </div>
          ) : (
            <p className="text-[11px] text-dark-400 mt-0.5">
              Lancez une vidéo ou une playlist depuis l'onglet Musiques &amp; playlists
            </p>
          )}
        </div>

        {failedCount > 0 && (
          <button
            onClick={onRedownloadFailed}
            disabled={retryingFailed}
            className="shrink-0 h-8 px-3 inline-flex items-center gap-1.5 rounded-lg border border-red-500/35 bg-red-500/10 text-red-200 text-[11px] font-medium transition-colors hover:text-red-100 hover:border-red-400/60 hover:bg-red-500/20 active:scale-95 disabled:opacity-50 disabled:cursor-wait"
            title="Relance uniquement les tâches et morceaux de playlist qui ont échoué"
          >
            <RetryIcon />
            {retryingFailed ? "Relance..." : `Réessayer les échecs (${failedCount})`}
          </button>
        )}
        {canRedownload && (
          <button
            onClick={onRedownloadAll}
            className="shrink-0 h-8 px-3 inline-flex items-center gap-1.5 rounded-lg border border-dark-600/70 bg-dark-800/40 text-dark-200 text-[11px] font-medium transition-colors hover:text-accent-300 hover:border-accent-500/40 hover:bg-accent-500/10 active:scale-95"
            title="Relance les tâches non terminées (erreurs / annulées). Les téléchargements réussis sont exclus."
          >
            <RedownloadIcon />
            Tout retélécharger
          </button>
        )}
        {activeCount > 0 && (
          <button onClick={onCancelAll} className="btn-danger shrink-0" title="Annuler tous les téléchargements en cours et en attente">
            <XIcon />
            Tout annuler
          </button>
        )}
        {completedCount > 0 && (
          <button
            onClick={onClearCompleted}
            className="shrink-0 h-8 px-3 inline-flex items-center gap-1.5 rounded-lg border border-dark-600/70 bg-dark-800/40 text-dark-200 text-[11px] font-medium transition-colors hover:text-red-400 hover:border-red-500/40 hover:bg-red-500/10 active:scale-95"
            title="Retirer uniquement les téléchargements terminés (erreurs et annulés conservés)"
          >
            <TrashIcon />
            Effacer terminés
          </button>
        )}
      </div>
    </div>
  );
}

function SectionHeader({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] font-semibold tracking-wider text-dark-400 uppercase">{label}</span>
      <span className="badge bg-dark-700/60 text-dark-300 border border-dark-600/60 tnum">{count}</span>
      <div className="flex-1 h-px bg-dark-700/60" />
    </div>
  );
}

function FilterChip({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`px-2.5 h-7 rounded-md text-[11px] font-medium transition-colors flex items-center gap-1.5 ${
        active ? "bg-accent-500/15 text-accent-300" : "text-dark-300 hover:text-white"
      }`}
    >
      {label}
      <span className={`tnum text-[10px] ${active ? "text-accent-400" : "text-dark-400"}`}>{count}</span>
    </button>
  );
}

function ViewToggle({ value, onChange }: { value: "cards" | "list"; onChange: (v: "cards" | "list") => void }) {
  const btn = (v: "cards" | "list", icon: React.ReactNode, label: string) => (
    <button
      onClick={() => onChange(v)}
      className={`h-7 px-2.5 rounded-md inline-flex items-center gap-1.5 text-[11px] font-medium transition-colors ${
        value === v ? "bg-accent-500/15 text-accent-300" : "text-dark-300 hover:text-white"
      }`}
      title={v === "cards" ? "Vue en cartes" : "Vue en liste"}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
  return (
    <div className="flex items-center gap-0.5 bg-dark-800/60 border border-dark-700/70 rounded-lg p-0.5">
      {btn("cards", <GridIcon />, "Cartes")}
      {btn("list", <ListIcon />, "Liste")}
    </div>
  );
}

function GridIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}

function StatusBadge({ status }: { status: Task["status"] }) {
  return <span className={`badge shrink-0 ${STATUS_BADGE[status] || STATUS_BADGE.queued}`}>{statusLabel(status)}</span>;
}

/** Rappel du format figé au lancement (MP3 par défaut pour les tâches anciennes). */
function MediaBadge({ task }: { task: Task }) {
  if (task.media !== "video") return null;
  const res = task.video_format && task.video_format !== "best" ? `${task.video_format}p` : "";
  return (
    <span
      className="badge shrink-0 bg-violet-500/15 text-violet-300 border border-violet-500/25"
      title={
        res
          ? `Vidéo MP4 (${res})`
          : "Vidéo MP4 (meilleure qualité disponible)"
      }
    >
      {`MP4${res ? ` ${res}` : ""}`}
    </span>
  );
}

function RowThumb({ task }: { task: Task }) {
  if (task.thumbnail) {
    return <img src={task.thumbnail} alt="" className="w-11 h-11 rounded-lg object-cover shrink-0 border border-dark-600/60" />;
  }
  return (
    <div className="w-11 h-11 rounded-lg bg-gradient-to-br from-accent-500/25 to-accent-700/10 border border-accent-500/20 flex items-center justify-center text-accent-300 shrink-0">
      {isJob(task) ? <ListIcon /> : <MusicGlyph />}
    </div>
  );
}

function TaskRow({
  task,
  onMove,
}: {
  task: Task;
  onMove?: (id: string, dir: -1 | 1) => void;
}) {
  const active = ACTIVE_STATUS.includes(task.status);
  const retryable = task.status === "error" || task.status === "cancelled";

  const openFolder = async (filePath: string) => {
    try {
      await openPath(filePath);
    } catch {
      toastError("Ouverture impossible", "Le dossier du fichier ne peut pas être ouvert.");
    }
  };

  return (
    <div data-context="task" data-id={task.id} className={`group flex flex-col gap-2.5 rounded-xl border p-3 transition-colors hover:bg-dark-700/30 ${ROW_STYLE[task.status]}`}>
      <div className="flex items-center gap-3">
        <RowThumb task={task} />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <p className="text-[13px] font-medium text-white truncate">{task.title || task.url}</p>
            {task.skipped ? (
              <span className="badge shrink-0 bg-sky-500/15 text-sky-300 border border-sky-500/25">Déjà téléchargé</span>
            ) : (
              <StatusBadge status={task.status} />
            )}
            <MediaBadge task={task} />
            {active && (
              <span className="text-[11px] text-dark-300 tnum ml-auto shrink-0">
                {task.progress.toFixed(1)}%
              </span>
            )}
          </div>

          <div className="flex items-center gap-3 text-[11px] mt-0.5 min-w-0">
            {task.status === "downloading" && (
              <>
                {task.speed_bytes > 0 && <span className="text-dark-300 tnum">{formatSpeed(task.speed_bytes)}</span>}
                {task.eta > 0 && <span className="text-dark-400 tnum">ETA {formatEta(task.eta)}</span>}
              </>
            )}
            {task.status === "converting" && <span className="text-amber-400">Conversion audio...</span>}
            {task.status === "queued" && <span className="text-dark-400">Dans la file</span>}
            {task.status === "completed" && task.output_path && (
              <span className="flex items-center gap-1.5 min-w-0">
                {task.skipped ? (
                  <>
                    <ReuseIcon />
                    <span className="text-sky-300 truncate">
                      Déjà présent · {task.output_path.split(/[/\\]/).pop()}
                    </span>
                  </>
                ) : (
                  <>
                    <CheckIcon />
                    <span className="text-green-400 truncate">{task.output_path.split(/[/\\]/).pop()}</span>
                  </>
                )}
              </span>
            )}
            {task.status === "error" && task.error && <span className="text-red-400 truncate">{task.error}</span>}
          </div>

          {(task.status === "downloading" || task.status === "converting") && (
            <div className="mt-1.5 h-1 rounded-full bg-dark-600 overflow-hidden">
              <div
                className={`h-full rounded-full transition-[width] duration-300 ${
                  task.status === "converting"
                    ? "bg-amber-500 animate-pulse-slow"
                    : "bg-gradient-to-r from-accent-600 to-accent-400 animate-pulse-slow"
                }`}
                style={{ width: `${Math.max(task.progress, 2)}%` }}
              />
            </div>
          )}
        </div>

        <div className="shrink-0 flex items-center gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
          {onMove && (
            <>
              <button
                type="button"
                onClick={() => onMove(task.id, -1)}
                className="w-7 h-7 rounded-md flex items-center justify-center text-dark-400 hover:text-white hover:bg-white/5"
                title="Monter"
              >
                ↑
              </button>
              <button
                type="button"
                onClick={() => onMove(task.id, 1)}
                className="w-7 h-7 rounded-md flex items-center justify-center text-dark-400 hover:text-white hover:bg-white/5"
                title="Descendre"
              >
                ↓
              </button>
            </>
          )}
          {retryable && (
            <button
              onClick={() => runRetryTask(task.id, task.title)}
              className="flex items-center gap-1 h-7 px-2 rounded-md text-[11px] font-medium text-dark-200 hover:text-white hover:bg-white/5 transition-colors"
              title="Relancer ce téléchargement"
            >
              <RetryIcon />
              Réessayer
            </button>
          )}
          {task.status === "completed" && task.output_path && (
            <button
              onClick={() => openFolder(task.output_path!)}
              className="w-7 h-7 rounded-md flex items-center justify-center text-dark-400 hover:text-accent-300 hover:bg-accent-500/10 transition-colors"
              title="Ouvrir le dossier du fichier"
            >
              <FolderIcon />
            </button>
          )}
          {active && (
            <button
              onClick={() => runCancel(task.id)}
              className="w-7 h-7 rounded-md flex items-center justify-center text-dark-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
              title="Annuler"
            >
              <XIcon />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function JobRow({ task }: { task: Task }) {
  const total = task.job_total ?? 0;
  const done = task.job_done ?? 0;
  const failed = task.job_failed ?? 0;
  const active = !["completed", "cancelled"].includes(task.status);
  const canRetry = (failed > 0 && task.status === "completed") || task.status === "error";
  const progress = total > 0 ? Math.min(100, (done / total) * 100) : task.progress;

  return (
    <div data-context="task" data-id={task.id} className={`group rounded-lg border p-3 space-y-2 transition-colors hover:bg-dark-700/30 ${ROW_STYLE[task.status]}`}>
      <div className="flex items-center gap-3">
        <RowThumb task={task} />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <p className="text-[13px] font-medium text-white truncate">{task.title || task.url}</p>
            <span className="badge shrink-0 bg-accent-500/15 text-accent-300 border border-accent-500/25">Playlist</span>
            <MediaBadge task={task} />
            <StatusBadge status={task.status} />
          </div>
          <div className="flex items-center gap-3 text-[11px] mt-0.5 flex-wrap">
            {active && !["downloading", "converting"].includes(task.status) ? (
              <span className="text-dark-300 tnum">En préparation...</span>
            ) : (
              <span className="text-dark-300 tnum">
                {done}/{total} titres
              </span>
            )}
            {failed > 0 && <span className="text-red-400 tnum">{failed} échec{failed > 1 ? "s" : ""}</span>}
            {(task.speed_bytes > 0 || (task.job_speed ?? 0) > 0) && (
              <span className="text-accent-300 tnum">{formatSpeed(task.job_speed ?? task.speed_bytes)}</span>
            )}
            {active && (task.job_eta ?? 0) > 0 && (
              <span className="text-dark-400 tnum">ETA {formatEta(task.job_eta!)}</span>
            )}
          </div>
        </div>

        <div className="shrink-0 flex items-center gap-2">
          {canRetry && (
            <button
              onClick={() => runRetryFailed(task.id)}
              className="text-[11px] text-amber-400 hover:text-amber-300 transition-colors px-2 py-1"
              title="Réessayer les téléchargements en échec"
            >
              Réessayer
            </button>
          )}
          {(active || task.status === "error") && (
            <button
              onClick={() => runCancelJob(task.id)}
              className="w-7 h-7 rounded-md flex items-center justify-center text-dark-400 hover:text-red-400 hover:bg-red-500/10 transition-colors opacity-60 group-hover:opacity-100"
              title="Annuler la playlist"
            >
              <XIcon />
            </button>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <div className="flex-1 h-1 rounded-full bg-dark-600 overflow-hidden">
          <div
            className={`h-full rounded-full transition-[width] duration-300 ${
              task.status === "cancelled"
                ? "bg-dark-400"
                : failed > 0
                  ? "bg-gradient-to-r from-amber-600 to-amber-400"
                  : "bg-gradient-to-r from-accent-600 to-accent-400 animate-pulse-slow"
            }`}
            style={{ width: `${Math.max(progress, 2)}%` }}
          />
        </div>
        <span className="text-[11px] text-dark-300 tnum">{progress.toFixed(1)}%</span>
      </div>

      {task.job_current && <p className="text-[11px] text-accent-300 truncate">▶ {task.job_current}</p>}

      {task.job_tracks && task.job_tracks.length > 0 && (
        <div className="space-y-0.5">
          {task.job_tracks.slice(0, 4).map((t, i) => (
            <div key={i} className="flex items-center gap-2 text-[11px] min-w-0">
              {t.status === "ok" ? (
                <span className="text-green-400 shrink-0">
                  <CheckIcon />
                </span>
              ) : t.status === "error" ? (
                <span className="text-red-400 shrink-0">
                  <XIcon />
                </span>
              ) : (
                <span className="text-accent-400 animate-pulse shrink-0">●</span>
              )}
              <span
                className={`truncate flex-1 ${t.status === "error" ? "text-red-400" : "text-dark-200"}`}
                title={t.error || t.title}
              >
                {t.title}
              </span>
            </div>
          ))}
        </div>
      )}

      {task.status === "error" && task.error && (
        <p className="text-[11px] text-red-400 truncate">{task.error}</p>
      )}
    </div>
  );
}

function EmptyHero() {
  return (
    <div className="flex-1 overflow-y-auto flex flex-col items-center justify-center text-center px-6 pb-4">
      <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-accent-500 to-accent-700 shadow-glow-accent flex items-center justify-center">
        <DownloadGlyph large />
      </div>
      <h2 className="mt-5 text-lg font-bold text-white tracking-tight">Vos téléchargements</h2>
      <p className="mt-1.5 text-[13px] text-dark-300 max-w-md">
        Lancez un téléchargement depuis l'onglet Musiques &amp; playlists :
        la file s'affichera ici en direct, avec la vitesse et les conversions.
      </p>
      <div className="mt-6 grid grid-cols-3 gap-2.5 w-full max-w-lg">
        <FeatureCard icon={<BoltIcon />} title="Multi-tâches" desc="Concurrence réglable" />
        <FeatureCard icon={<MusicIcon />} title="MP3 ou MP4" desc="320 kbps ou 1080p" />
        <FeatureCard icon={<CheckIcon />} title="Anti-doublons" desc="Fichiers déjà présents sautés" />
      </div>
    </div>
  );
}

function EmptyFilter() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center gap-3">
      <div className="w-14 h-14 rounded-2xl border border-dark-600 bg-dark-800/60 flex items-center justify-center text-dark-300 shadow-panel">
        <FilterIcon />
      </div>
      <div>
        <p className="text-sm font-medium text-dark-100">Aucune tâche dans ce filtre</p>
        <p className="text-xs text-dark-400 mt-1">Ajustez le filtre ci-dessus pour voir les tâches</p>
      </div>
    </div>
  );
}

function FeatureCard({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="rounded-lg border border-dark-600/60 bg-dark-800/50 p-3 flex flex-col items-center justify-center text-center">
      <div className="w-7 h-7 rounded-md bg-accent-500/15 border border-accent-500/25 flex items-center justify-center text-accent-400">
        {icon}
      </div>
      <p className="text-xs font-semibold text-white mt-2">{title}</p>
      <p className="text-[10px] text-dark-400 mt-0.5">{desc}</p>
    </div>
  );
}

function DownloadGlyph({ large }: { large?: boolean }) {
  const s = large ? 30 : 16;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" />
      <line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  );
}

function MusicGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </svg>
  );
}

function MusicIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </svg>
  );
}

function BoltIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  );
}

function FilterIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
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

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function ReuseIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      <polyline points="1 4 1 10 7 10" />
      <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
    </svg>
  );
}

function RetryIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      <polyline points="23 4 23 10 17 10" />
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </svg>
  );
}

function RedownloadIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      <polyline points="1 4 1 10 7 10" />
      <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
      <polyline points="23 20 23 14 17 14" />
      <path d="M20.49 9a9 9 0 1 0-2.13 9.36L23 14" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  );
}

async function runRetryTask(id: string, title: string) {
  try {
    await retryTask(id);
    toastSuccess("Téléchargement relancé", title);
  } catch {
    toastError("Relance impossible", title);
  }
}

async function runCancel(id: string) {
  try {
    await cancelTask(id);
  } catch {
    toastError("Annulation impossible", "La tâche n'a pas pu être annulée.");
  }
}

async function runRetryFailed(id: string) {
  try {
    await retryFailed(id);
    toastSuccess("Playlist relancée", "Les titres en échec sont de nouveau en file.");
  } catch {
    toastError("Relance impossible", "Les titres en échec n'ont pas pu être relancés.");
  }
}

async function runCancelJob(id: string) {
  try {
    await cancelJob(id);
  } catch {
    toastError("Annulation impossible", "La playlist n'a pas pu être annulée.");
  }
}