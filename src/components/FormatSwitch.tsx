import type { MediaKind } from "../services/api";

const VIDEO_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "best", label: "Meilleure" },
  { value: "1080", label: "1080p" },
  { value: "720", label: "720p" },
  { value: "480", label: "480p" },
];

/** Libellé compact du format, réutilisé dans les boutons et les sous-titres. */
export function formatLabel(media: MediaKind, videoFormat: string): string {
  return media === "video" ? `MP4 · ${videoFormat === "best" ? "meilleure" : `${videoFormat}p`}` : "MP3";
}

interface Props {
  media: MediaKind;
  videoFormat: string;
  onMediaChange: (media: MediaKind) => void;
  onVideoFormatChange: (value: string) => void;
  /** Version resserrée pour les barres d'outils. */
  compact?: boolean;
}

/**
 * Sélecteur MP3 / MP4 + résolution vidéo.
 *
 * Le format est choisi au lancement de chaque téléchargement : les réglages
 * globaux ne servent que de valeur par défaut (voir les Paramètres).
 */
export default function FormatSwitch({
  media,
  videoFormat,
  onMediaChange,
  onVideoFormatChange,
  compact = false,
}: Props) {
  return (
    <div className="flex items-center gap-2 shrink-0">
      <div
        className="flex items-center gap-0.5 bg-dark-800/60 border border-dark-700/70 rounded-lg p-0.5"
        role="group"
        aria-label="Format de téléchargement"
      >
        {(["audio", "video"] as MediaKind[]).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => onMediaChange(value)}
            aria-pressed={media === value}
            title={value === "audio" ? "Télécharger l'audio en MP3" : "Télécharger la vidéo en MP4"}
            className={`h-7 px-2.5 rounded-md text-[11px] font-semibold transition-colors ${
              media === value
                ? value === "video"
                  ? "bg-violet-500/20 text-violet-200 border border-violet-500/40"
                  : "bg-accent-500/20 text-accent-200 border border-accent-500/40"
                : "text-dark-300 hover:text-white border border-transparent"
            }`}
          >
            {value === "audio" ? "MP3" : "MP4"}
          </button>
        ))}
      </div>

      {media === "video" && (
        <div className="flex items-center gap-0.5 bg-dark-800/60 border border-dark-700/70 rounded-lg p-0.5">
          {VIDEO_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => onVideoFormatChange(opt.value)}
              aria-pressed={videoFormat === opt.value}
              title={`Qualité vidéo : ${opt.label}`}
              className={`h-7 px-2 rounded-md text-[11px] font-medium transition-colors ${
                videoFormat === opt.value
                  ? "bg-violet-500/20 text-violet-200 border border-violet-500/40"
                  : "text-dark-300 hover:text-white border border-transparent"
              }`}
            >
              {compact ? opt.value.replace("best", "Max") : opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
