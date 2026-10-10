import DownloadForm from "../components/DownloadForm";
import PageHeader from "./PageHeader";
import type { MediaKind } from "../services/api";

interface Props {
  connected: boolean;
  defaultMedia?: MediaKind;
  defaultVideoFormat?: string;
}

export default function BrowsePage({ connected, defaultMedia, defaultVideoFormat }: Props) {
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <PageHeader
        title="Musiques, vidéos & Playlists"
        subtitle="Analysez une vidéo ou une playlist YouTube, choisissez MP3 ou MP4 puis sélectionnez vos titres"
      />
      <DownloadForm
        connected={connected}
        defaultMedia={defaultMedia}
        defaultVideoFormat={defaultVideoFormat}
      />
    </div>
  );
}
