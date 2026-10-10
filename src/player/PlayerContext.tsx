import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import WaveSurfer from "wavesurfer.js";
import { convertFileSrc } from "@tauri-apps/api/core";
import { mediaKindOf, type MediaKind, type MusicFile } from "../services/api";

interface PlayerState {
  queue: MusicFile[];
  current: MusicFile | null;
  currentIndex: number;
  playing: boolean;
  time: number;
  duration: number;
  volume: number;
  shuffle: boolean;
  repeat: boolean;
  error: string | null;
  mediaKind: MediaKind | null;
  waveEl: (el: HTMLDivElement | null) => void;
  videoEl: (el: HTMLVideoElement | null) => void;
  setQueue: (list: MusicFile[]) => void;
  playTrack: (path: string) => void;
  togglePlay: () => void;
  next: () => void;
  prev: () => void;
  seekTo: (s: number) => void;
  setVolume: (v: number) => void;
  toggleShuffle: () => void;
  toggleRepeat: () => void;
}

const PlayerContext = createContext<PlayerState | null>(null);

const LS_VOLUME = "ytmd.volume";
const LS_SHUFFLE = "ytmd.shuffle";
const LS_REPEAT = "ytmd.repeat";

function readLS(key: string, fallback: number | boolean): number | boolean {
  try {
    const v = localStorage.getItem(key);
    if (v === null) return fallback;
    if (typeof fallback === "boolean") return v === "1";
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  } catch {
    return fallback;
  }
}

export function PlayerProvider({ children }: { children: ReactNode }) {
  const [queue, setQueueState] = useState<MusicFile[]>([]);
  const [current, setCurrent] = useState<MusicFile | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState<number>(() => readLS(LS_VOLUME, 0.9) as number);
  const [shuffle, setShuffleState] = useState<boolean>(() => readLS(LS_SHUFFLE, false) as boolean);
  const [repeat, setRepeatState] = useState<boolean>(() => readLS(LS_REPEAT, false) as boolean);
  const [error, setError] = useState<string | null>(null);

  const waveRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  const shuffleRef = useRef(shuffle);
  const repeatRef = useRef(repeat);
  const queueRef = useRef(queue);
  const currentRef = useRef(current);
  const modeRef = useRef<MediaKind | null>(null);
  shuffleRef.current = shuffle;
  repeatRef.current = repeat;
  queueRef.current = queue;
  currentRef.current = current;

  const mediaKind = current ? mediaKindOf(current) : null;

  const currentIndex = useMemo(
    () => (current ? queue.findIndex((f) => f.path === current.path) : -1),
    [queue, current]
  );

  const stopAudio = () => {
    try {
      wsRef.current?.pause();
    } catch {
      /* ignore */
    }
  };

  const stopVideo = () => {
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    v.removeAttribute("src");
    v.load();
  };

  const setVolume = useCallback((v: number) => {
    setVolumeState(v);
    wsRef.current?.setVolume(v);
    if (videoRef.current) videoRef.current.volume = v;
    try {
      localStorage.setItem(LS_VOLUME, String(v));
    } catch {}
  }, []);

  const playByPath = useCallback((path: string) => {
    const list = queueRef.current;
    const found = list.find((f) => f.path === path);
    if (!found) return;
    setError(null);
    const kind = mediaKindOf(found);
    modeRef.current = kind;
    setCurrent(found);
    setDuration(found.duration || 0);
    setTime(0);

    if (kind === "video") {
      stopAudio();
      const v = videoRef.current;
      if (!v) return;
      v.src = convertFileSrc(path);
      v.volume = volume;
      void v.play().catch((e) => setError(String(e)));
      return;
    }

    stopVideo();
    const ws = wsRef.current;
    if (!ws) return;
    ws.load(convertFileSrc(path));
  }, [volume]);

  const pickNext = (dir: 1 | -1): MusicFile | null => {
    const list = queueRef.current;
    if (!list.length) return null;
    let idx = currentRef.current
      ? list.findIndex((f) => f.path === currentRef.current!.path)
      : -1;
    if (idx < 0) idx = dir > 0 ? -1 : list.length;
    if (shuffleRef.current && list.length > 1) {
      let n = idx;
      do {
        n = Math.floor(Math.random() * list.length);
      } while (n === idx);
      return list[n];
    }
    let n = idx + dir;
    if (n >= list.length) {
      if (repeatRef.current) n = 0;
      else return null;
    }
    if (n < 0) {
      if (repeatRef.current) n = list.length - 1;
      else return null;
    }
    return list[n];
  };

  const next = useCallback(() => {
    const picked = pickNext(1);
    if (picked) {
      playByPath(picked.path);
      return;
    }
    if (modeRef.current === "video") {
      const v = videoRef.current;
      if (v) {
        v.pause();
        v.currentTime = 0;
      }
      setPlaying(false);
    } else {
      const ws = wsRef.current;
      if (ws) {
        ws.seekTo(0);
        ws.pause();
      }
    }
  }, [playByPath]);

  const prev = useCallback(() => {
    const picked = pickNext(-1);
    if (picked) playByPath(picked.path);
  }, [playByPath]);

  const setQueue = useCallback((list: MusicFile[]) => {
    setQueueState(list);
    if (currentRef.current && !list.some((f) => f.path === currentRef.current!.path)) return;
    if (!list.length && !currentRef.current) return;
  }, []);

  const playTrack = useCallback(
    (path: string) => {
      if (currentRef.current && path === currentRef.current.path) {
        if (modeRef.current === "video") {
          const v = videoRef.current;
          if (!v) return;
          if (v.paused) void v.play();
          else v.pause();
          return;
        }
        const ws = wsRef.current;
        if (!ws) return;
        if (ws.isPlaying()) ws.pause();
        else void ws.play();
        return;
      }
      playByPath(path);
    },
    [playByPath]
  );

  const togglePlay = useCallback(() => {
    if (!currentRef.current) {
      const list = queueRef.current;
      if (list.length) playByPath(list[0].path);
      return;
    }
    if (modeRef.current === "video") {
      const v = videoRef.current;
      if (!v) return;
      if (v.paused) void v.play();
      else v.pause();
      return;
    }
    const ws = wsRef.current;
    if (!ws) return;
    if (ws.isPlaying()) ws.pause();
    else void ws.play();
  }, [playByPath]);

  const seekTo = useCallback((s: number) => {
    if (modeRef.current === "video") {
      const v = videoRef.current;
      if (v && isFinite(v.duration) && v.duration > 0) {
        v.currentTime = Math.max(0, Math.min(s, v.duration));
      }
      return;
    }
    const ws = wsRef.current;
    if (!ws) return;
    const d = ws.getDuration();
    if (d > 0) ws.seekTo(Math.max(0, Math.min(1, s / d)));
  }, []);

  const toggleShuffle = useCallback(() => {
    setShuffleState((s) => {
      const v = !s;
      try {
        localStorage.setItem(LS_SHUFFLE, v ? "1" : "0");
      } catch {}
      return v;
    });
  }, []);

  const toggleRepeat = useCallback(() => {
    setRepeatState((r) => {
      const v = !r;
      try {
        localStorage.setItem(LS_REPEAT, v ? "1" : "0");
      } catch {}
      return v;
    });
  }, []);

  const setWaveEl = useCallback((el: HTMLDivElement | null) => {
    waveRef.current = el;
  }, []);

  const setVideoEl = useCallback((el: HTMLVideoElement | null) => {
    videoRef.current = el;
    if (el) {
      el.volume = volume;
      el.onplay = () => setPlaying(true);
      el.onpause = () => setPlaying(false);
      el.ontimeupdate = () => setTime(el.currentTime || 0);
      el.onloadedmetadata = () => setDuration(el.duration || 0);
      el.onended = () => next();
      el.onerror = () => setError("Lecture vidéo impossible");
    }
  }, [next, volume]);

  useEffect(() => {
    const el = waveRef.current;
    if (!el) return;
    wsRef.current = WaveSurfer.create({
      container: el,
      height: 46,
      waveColor: "#3f3a4e",
      progressColor: "#FF3B5C",
      cursorColor: "#FF3B5C",
      cursorWidth: 1,
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      normalize: true,
    });
    const ws = wsRef.current;
    ws.setVolume(volume);
    ws.on("ready", () => {
      setDuration(ws.getDuration());
      void ws.play();
      setPlaying(true);
    });
    ws.on("timeupdate", (t: number) => setTime(t));
    ws.on("play", () => setPlaying(true));
    ws.on("pause", () => setPlaying(false));
    ws.on("finish", () => next());
    ws.on("error", (e: unknown) =>
      setError(e instanceof Error ? `${e.name}: ${e.message}` : String(e))
    );
    return () => {
      wsRef.current?.destroy();
      wsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    wsRef.current?.setVolume(volume);
    if (videoRef.current) videoRef.current.volume = volume;
  }, [volume]);

  const value = useMemo<PlayerState>(
    () => ({
      queue,
      current,
      currentIndex,
      playing,
      time,
      duration,
      volume,
      shuffle,
      repeat,
      error,
      mediaKind,
      waveEl: setWaveEl,
      videoEl: setVideoEl,
      setQueue,
      playTrack,
      togglePlay,
      next,
      prev,
      seekTo,
      setVolume,
      toggleShuffle,
      toggleRepeat,
    }),
    [
      queue,
      current,
      currentIndex,
      playing,
      time,
      duration,
      volume,
      shuffle,
      repeat,
      error,
      mediaKind,
      setWaveEl,
      setVideoEl,
      setQueue,
      playTrack,
      togglePlay,
      next,
      prev,
      seekTo,
      setVolume,
      toggleShuffle,
      toggleRepeat,
    ]
  );

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}

export function usePlayer(): PlayerState {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error("usePlayer doit être utilisé dans PlayerProvider");
  return ctx;
}
