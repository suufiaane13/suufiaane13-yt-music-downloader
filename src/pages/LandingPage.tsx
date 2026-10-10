interface Props {
  onDownload?: () => void;
  onOpenApp?: () => void;
}

const features = [
  {
    title: "Audio & Vidéo",
    desc: "MP3 320 kbps ou MP4 jusqu'à 1080p. Format figé par tâche.",
    icon: "M9 18V5l12-2v13 M6 18a3 3 0 1 0 0 0 M18 16a3 3 0 1 0 0 0",
  },
  {
    title: "Moteur embarqué",
    desc: "yt-dlp + FFmpeg inclus. Aucune installation externe.",
    icon: "M13 2 3 14h7l-1 8 10-12h-7l1-8z",
  },
  {
    title: "Pochettes & métadonnées",
    desc: "ID3v2.4, covr MP4, extraction auto depuis la vidéo.",
    icon: "M12 2l2.4 4.9 5.6.8-4 4 .9 5.6-4.9-2.6-4.9 2.6.9-5.6-4-4 5.6-.8L12 2z",
  },
  {
    title: "Anti-doublons",
    desc: "Archive par video_id. Relancez sans doublons.",
    icon: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
  },
  {
    title: "Lecteur intégré",
    desc: "Forme d'onde, seek précis, file dynamique.",
    icon: "M8 5v14l11-7z",
  },
  {
    title: "Recherche rapide",
    desc: "Cache local, résultats en < 100 ms.",
    icon: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z M21 21l-4.3-4.3",
  },
];

function Icon({ d }: { d: string }) {
  const isFill = d === "M8 5v14l11-7z";
  if (isFill) {
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
        <path d={d} />
      </svg>
    );
  }
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

export default function LandingPage({ onDownload, onOpenApp }: Props) {
  return (
    <div className="min-h-screen bg-dark-900 text-dark-100 flex flex-col overflow-y-auto">
      <header className="relative flex items-center justify-center px-6 py-20 md:py-28 overflow-hidden">
        <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
          <div className="absolute top-1/4 left-1/4 w-[500px] h-[500px] rounded-full bg-accent-500/10 blur-[150px]" />
          <div className="absolute bottom-0 right-1/4 w-[400px] h-[400px] rounded-full bg-accent-500/5 blur-[120px]" />
        </div>

        <div className="relative z-10 max-w-4xl mx-auto w-full text-center">
          <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-accent-500/30 bg-accent-500/10 text-accent-300 text-[11px] font-medium tracking-wider uppercase">
            <span className="w-1.5 h-1.5 rounded-full bg-accent-500" />
            v1.0.0 — Build stable
          </span>

          <h1 className="mt-6 text-5xl md:text-7xl font-bold tracking-tighter leading-[1.05] text-white">
            YT Music Downloader
          </h1>

          <p className="mt-5 text-lg text-dark-300 max-w-2xl mx-auto leading-relaxed">
            Téléchargez, organisez et écoutez votre musique YouTube.
            Rapide, privée, 100% locale.
          </p>

          <div className="mt-9 flex flex-col sm:flex-row items-center justify-center gap-3">
            <button
              onClick={onDownload}
              className="inline-flex items-center gap-2.5 px-8 py-4 rounded-xl bg-accent-500 text-white font-semibold text-[15px] hover:bg-accent-600 active:scale-[0.98] transition-all shadow-glow-accent"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Télécharger pour Windows
            </button>
            {onOpenApp && (
              <button
                onClick={onOpenApp}
                className="inline-flex items-center gap-2.5 px-8 py-4 rounded-xl border border-dark-600/60 bg-dark-800/60 font-semibold text-[15px] hover:bg-dark-700/60 transition-colors"
              >
                Ouvrir l&apos;application
              </button>
            )}
          </div>
          <p className="mt-4 text-[11px] text-dark-400">Windows 10/11 x64 · Portable · Sans compte</p>

          <div className="mt-10 flex flex-wrap items-center justify-center gap-x-7 gap-y-2 text-[12px] text-dark-400">
            <span>Aucune télémétrie</span>
            <span>100% local</span>
            <span>Open source</span>
            <span>Licence MIT</span>
          </div>
        </div>
      </header>

      <section className="border-y border-dark-700/50 bg-dark-800/30 py-10 px-6">
        <div className="max-w-5xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
          {[
            ["MP3 / M4A / MP4", "Formats"],
            ["320 kbps", "Audio max"],
            ["1080p", "Vidéo max"],
            ["CPU-aware", "Concurrence"],
          ].map(([v, l]) => (
            <div key={l}>
              <p className="text-2xl md:text-3xl font-bold text-white tracking-tight">{v}</p>
              <p className="text-[11px] text-dark-400 mt-1 uppercase tracking-wider">{l}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="py-16 md:py-20 px-6">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-2xl md:text-3xl font-bold tracking-tight text-center">
            Conçu pour l&apos;expérience musicale
          </h2>
          <p className="text-dark-300 text-center mt-3 max-w-xl mx-auto text-[14px]">
            De l&apos;extraction fiable à la lecture fluide, chaque détail est pensé.
          </p>
          <div className="mt-10 grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {features.map((f) => (
              <div
                key={f.title}
                className="p-5 rounded-2xl border border-dark-700/60 bg-dark-800/40 hover:border-accent-500/30 transition-colors"
              >
                <div className="w-10 h-10 rounded-xl bg-accent-500/15 border border-accent-500/20 flex items-center justify-center mb-3 text-accent-400">
                  <Icon d={f.icon} />
                </div>
                <h3 className="font-semibold text-white text-[14px]">{f.title}</h3>
                <p className="text-[12.5px] text-dark-300 mt-1 leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-16 px-6 bg-dark-800/30 border-t border-dark-700/50">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-2xl md:text-3xl font-bold tracking-tight">Prêt à récupérer votre musique ?</h2>
          <p className="text-dark-300 mt-3 text-[14px]">Installateur ou portable. Aucun compte, aucune pub, aucune limite.</p>
          <button
            onClick={onDownload}
            className="mt-7 inline-flex items-center gap-2.5 px-9 py-4 rounded-xl bg-accent-500 text-white font-semibold hover:bg-accent-600 active:scale-[0.98] transition-all shadow-glow-accent"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Télécharger v1.0.0
          </button>
        </div>
      </section>

      <footer className="py-8 px-6 border-t border-dark-700/50">
        <div className="max-w-5xl mx-auto flex flex-col md:flex-row items-center justify-between gap-3 text-[12px] text-dark-400">
          <p>YT Music Downloader — Tauri, Rust &amp; React</p>
          <p>Windows 10/11 x64</p>
        </div>
      </footer>
    </div>
  );
}
