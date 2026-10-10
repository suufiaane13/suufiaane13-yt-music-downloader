import { useMemo, useState } from "react";
import DownloadQueue from "../components/DownloadQueue";
import PageHeader from "./PageHeader";
import { Task, openPath, reorderTasks } from "../services/api";
import { toastError, toastSuccess } from "../components/Toasts";

interface Props {
  tasks: Task[];
  onTasksChange?: (tasks: Task[]) => void;
  onClearCompleted: () => Promise<void>;
  outputDir?: string;
}

const ACTIVE_STATUS = ["queued", "downloading", "converting"];
const TERMINAL_STATUS = ["completed", "error", "cancelled"];

function formatSpeed(bytes: number): string {
  if (bytes === 0) return "---";
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB/s`;
  return `${(bytes / 1048576).toFixed(1)} MB/s`;
}

export default function DownloadsPage({
  tasks,
  onTasksChange,
  onClearCompleted,
  outputDir,
}: Props) {
  const [query, setQuery] = useState("");

  const active = tasks.filter((t) => ACTIVE_STATUS.includes(t.status)).length;
  const done = tasks.filter((t) => TERMINAL_STATUS.includes(t.status)).length;
  const totalSpeed = tasks.reduce(
    (s, t) => s + (t.status === "downloading" ? (t.speed_bytes || t.job_speed || 0) : 0),
    0
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tasks;
    return tasks.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.url.toLowerCase().includes(q) ||
        (t.error || "").toLowerCase().includes(q)
    );
  }, [tasks, query]);

  const moveTask = async (id: string, dir: -1 | 1) => {
    const ids = tasks.map((t) => t.id);
    const i = ids.indexOf(id);
    if (i < 0) return;
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    const nextIds = [...ids];
    [nextIds[i], nextIds[j]] = [nextIds[j], nextIds[i]];
    const byId = new Map(tasks.map((t) => [t.id, t]));
    const nextTasks = nextIds.map((x) => byId.get(x)!).filter(Boolean);
    try {
      await reorderTasks(nextIds);
      onTasksChange?.(nextTasks);
      toastSuccess("Ordre mis à jour");
    } catch {
      toastError("Réordonnancement impossible", "La file n'a pas pu être réorganisée.");
    }
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col" data-testid="downloads-page">
      <PageHeader
        title="Téléchargements"
        subtitle="File en direct, vitesse, conversions MP3 et fusions MP4"
        right={
          <div className="flex items-center gap-2.5 shrink-0">
            {totalSpeed > 0 && active > 0 && (
              <span className="text-[11px] text-accent-300 tnum flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-accent-500 animate-pulse" />
                {formatSpeed(totalSpeed)}
              </span>
            )}
            {active > 0 && (
              <span className="badge bg-accent-500/15 text-accent-300 border border-accent-500/25">
                {active} en cours
              </span>
            )}
            {done > 0 && (
              <span className="badge bg-dark-700/60 text-dark-300 border border-dark-600/60 tnum">
                {done} terminé{done > 1 ? "s" : ""}
              </span>
            )}
            {outputDir && (
              <button
                type="button"
                className="btn-ghost h-8 px-3 text-[11px]"
                data-testid="dl-open-folder"
                onClick={() =>
                  void openPath(outputDir).catch(() =>
                    toastError("Ouverture impossible", "Dossier de sortie introuvable.")
                  )
                }
              >
                Ouvrir dossier
              </button>
            )}
          </div>
        }
      />

      <div className="shrink-0 px-4 pb-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Rechercher titre, URL ou erreur…"
          className="field h-9 w-full text-[12px]"
          data-testid="dl-search"
        />
      </div>

      <DownloadQueue tasks={filtered} onClearCompleted={onClearCompleted} onMoveTask={moveTask} />
    </div>
  );
}
