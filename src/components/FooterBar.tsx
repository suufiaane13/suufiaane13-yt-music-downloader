import { Task } from "../services/api";

interface Props {
  tasks: Task[];
}

function formatSpeed(bytes: number): string {
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

export default function FooterBar({ tasks }: Props) {
  const downloading = tasks.filter((t) => t.status === "downloading");
  const queued = tasks.filter((t) => t.status === "queued");
  const completed = tasks.filter((t) => t.status === "completed").length;
  const errors = tasks.filter((t) => t.status === "error").length;
  const cancelled = tasks.filter((t) => t.status === "cancelled").length;
  const speed = downloading.reduce((sum, t) => sum + (t.speed_bytes || 0), 0);
  const eta = downloading.reduce((max, t) => Math.max(max, t.eta), 0);

  return (
    <footer className="h-8 shrink-0 flex items-center gap-4 px-4 border-t border-dark-700/70 bg-dark-800/30 text-[11px] text-dark-300">
      {tasks.length === 0 ? (
        <span className="text-dark-500">Aucun téléchargement</span>
      ) : (
        <>
          <span className="flex items-center gap-1.5">
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                downloading.length ? "bg-accent-400 animate-pulse" : "bg-dark-500"
              }`}
            />
            <span className="tnum">{downloading.length} en cours</span>
          </span>
          {queued.length > 0 && <span className="tnum text-dark-400">{queued.length} en attente</span>}
          {speed > 0 && <span className="text-accent-400 font-semibold tnum">{formatSpeed(speed)}</span>}
          {completed > 0 && (
            <span className="text-green-400 tnum">{completed} terminé{completed > 1 ? "s" : ""}</span>
          )}
          {errors > 0 && <span className="text-red-400 tnum">{errors} erreur{errors > 1 ? "s" : ""}</span>}
          {cancelled > 0 && (
            <span className="tnum text-dark-400">{cancelled} annulé{cancelled > 1 ? "s" : ""}</span>
          )}
          <span className="ml-auto text-dark-500 tnum">
            {tasks.length} total{eta > 0 ? ` · ETA ${formatEta(eta)}` : ""}
          </span>
        </>
      )}
    </footer>
  );
}