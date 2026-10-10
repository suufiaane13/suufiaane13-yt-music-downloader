import Settings from "../components/Settings";
import PageHeader from "./PageHeader";
import { Settings as SettingsType, EngineCheck } from "../services/api";

interface Props {
  settings: SettingsType;
  onSettingsChange: (s: SettingsType) => void;
  engine: EngineCheck | null;
}

export default function SettingsPage({ settings, onSettingsChange, engine }: Props) {
  const ok =
    !!engine && engine.ytDlp && engine.ffmpeg && engine.ffprobe;

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <PageHeader
        title="Paramètres"
        subtitle="Personnalisez les téléchargements et le moteur"
        right={
          engine ? (
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-2.5">
                <BinDot ok={engine.ytDlp} label="yt-dlp" />
                <BinDot ok={engine.ffmpeg} label="ffmpeg" />
                <BinDot ok={engine.ffprobe} label="ffprobe" />
                <BinDot ok={engine.jsRuntime} label="deno (JS)" />
              </span>
              <span
                className={`badge ${
                  ok
                    ? "bg-green-500/10 text-green-400 border border-green-500/30"
                    : "bg-red-500/10 text-red-400 border border-red-500/30"
                }`}
              >
                {ok ? "Moteur prêt" : "Incomplet"}
              </span>
            </div>
          ) : (
            <span className="badge bg-dark-700/60 text-dark-300 border border-dark-600/60">
              Vérification…
            </span>
          )
        }
      />
      <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-6">
        <Settings settings={settings} onSettingsChange={onSettingsChange} engine={engine} />
      </div>
    </div>
  );
}

function BinDot({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-dark-200 shrink-0">
      <span className={`w-1.5 h-1.5 rounded-full ${ok ? "bg-green-400" : "bg-red-400"}`} />
      {label}
      <span className={`tnum ${ok ? "text-green-400" : "text-red-400"}`}>{ok ? "OK" : "?"}</span>
    </span>
  );
}