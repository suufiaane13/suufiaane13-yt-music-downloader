import { Task } from "../services/api";

interface Props {
  tasks: Task[];
}

export default function ProgressStrip({ tasks }: Props) {
  const total = tasks.length;
  const overall =
    total === 0
      ? 0
      : Math.min(
          100,
          tasks.reduce((acc, t) => {
            if (["completed", "error", "cancelled"].includes(t.status)) return acc + 100;
            return acc + (t.progress || 0);
          }, 0) / total
        );

  const hasActive = tasks.some((t) => ["queued", "downloading", "converting"].includes(t.status));
  const hasErrors = tasks.some((t) => t.status === "error");

  const color =
    total === 0
      ? "bg-transparent"
      : hasErrors && !hasActive
        ? "bg-red-500"
        : overall >= 100
          ? "bg-green-500"
          : "bg-accent-500";

  return (
    <div className="h-0.5 w-full bg-dark-800/70 shrink-0 relative overflow-hidden">
      <div
        className={`absolute inset-y-0 left-0 transition-[width] duration-300 ${color} ${
          hasActive ? "animate-pulse-slow" : ""
        }`}
        style={{ width: `${overall}%` }}
      />
    </div>
  );
}