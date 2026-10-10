export default function PageLoader({
  title = "Chargement...",
  subtitle = "Préparation du contenu",
  compact = false,
}: {
  title?: string;
  subtitle?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center ${
        compact ? "py-6" : "min-h-[240px] py-10"
      }`}
      aria-live="polite"
      aria-busy="true"
    >
      <div className="relative w-20 h-20 rounded-3xl bg-gradient-to-br from-accent-500/20 via-accent-500/10 to-dark-800 border border-accent-500/20 shadow-[0_0_60px_-15px_rgba(236,72,153,0.25)] animate-pulse">
        <div className="absolute inset-2 rounded-2xl bg-gradient-to-tr from-white/5 to-transparent" />
      </div>

      <div className="mt-6 text-center space-y-1">
        <h3 className="text-[15px] font-semibold text-white tracking-tight">{title}</h3>
        <p className="text-[11px] text-dark-400">{subtitle}</p>
      </div>
    </div>
  );
}
