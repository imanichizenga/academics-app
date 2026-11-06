"use client";
import { useQuery } from "@tanstack/react-query";
import Hls from "hls.js";
import { Check, Gauge, Lock, Maximize, Minimize, Pause, PictureInPicture2, Play, Settings, Volume2, VolumeX } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Dropdown, DropdownContent, DropdownItem, DropdownTrigger } from "@/components/ui/display";
import { api, post } from "@/lib/api";
import { cn, duration as fmt } from "@/lib/utils";

type Stream = { master: string; preview_seconds: number | null; duration: number; poster: string; sprite: string; sprite_meta: { every: number; columns: number; rows: number; w: number; h: number }; renditions: string[] };
const SPEEDS = [0.75, 1, 1.25, 1.5, 2];
const ctrl = "grid size-10 place-items-center rounded-md text-white hover:bg-white/15 [&_svg]:size-5";

export function VideoPlayer({ assetId, contentId, resumeAt, onPreviewEnd }: { assetId: string; contentId?: string; resumeAt?: number; onPreviewEnd?: () => void }) {
  const { data: stream, error } = useQuery({ queryKey: ["stream", assetId], staleTime: 3_000_000, queryFn: () => api<Stream>(`/media/${assetId}/stream/`) });
  const video = useRef<HTMLVideoElement>(null);
  const shell = useRef<HTMLDivElement>(null);
  const hls = useRef<Hls | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [total, setTotal] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [levels, setLevels] = useState<{ index: number; label: string }[]>([]);
  const [level, setLevel] = useState(-1);
  const [full, setFull] = useState(false);
  const [ended, setEnded] = useState(false);
  const [hover, setHover] = useState<{ x: number; t: number } | null>(null);
  const [idle, setIdle] = useState(false);
  const lastSaved = useRef(0);
  const isPreview = stream?.preview_seconds != null;

  useEffect(() => {
    const el = video.current;
    if (!el || !stream) return;
    if (el.canPlayType("application/vnd.apple.mpegurl") && !Hls.isSupported()) el.src = stream.master;
    else if (Hls.isSupported()) {
      const player = new Hls({ capLevelToPlayerSize: true });
      hls.current = player;
      player.loadSource(stream.master);
      player.attachMedia(el);
      player.on(Hls.Events.MANIFEST_PARSED, (_, d) => setLevels(d.levels.map((l, i) => ({ index: i, label: `${l.height}p` })).reverse()));
    }
    return () => { hls.current?.destroy(); hls.current = null; };
  }, [stream]);

  const toggle = useCallback(() => { const el = video.current; if (el) el.paused ? el.play().catch(() => {}) : el.pause(); }, []);
  const seek = useCallback((t: number) => { const el = video.current; if (el) el.currentTime = Math.max(0, Math.min(t, el.duration || t)); }, []);
  const toggleFull = useCallback(() => { document.fullscreenElement ? document.exitFullscreen() : shell.current?.requestFullscreen?.(); }, []);
  useEffect(() => {
    const onFull = () => setFull(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFull);
    return () => document.removeEventListener("fullscreenchange", onFull);
  }, []);
  useEffect(() => {
    if (!playing) { setIdle(false); return; }
    const t = setTimeout(() => setIdle(true), 2600);
    return () => clearTimeout(t);
  }, [playing, time < 0, hover]); // eslint-disable-line

  const onTime = () => {
    const el = video.current!;
    setTime(el.currentTime);
    if (el.buffered.length) setBuffered(el.buffered.end(el.buffered.length - 1));
    if (contentId && !isPreview && Math.abs(el.currentTime - lastSaved.current) > 10) {
      lastSaved.current = el.currentTime;
      api(`/contents/${contentId}/progress/`, { method: "PUT", body: { position_seconds: el.currentTime, percent: Math.round((el.currentTime / (el.duration || 1)) * 100) } }).catch(() => {});
    }
  };
  const onKey = (e: React.KeyboardEvent) => {
    const map: Record<string, () => void> = {
      " ": toggle, k: toggle, f: toggleFull, m: () => { if (video.current) { video.current.muted = !video.current.muted; setMuted(video.current.muted); } },
      ArrowRight: () => seek(time + 5), ArrowLeft: () => seek(time - 5), l: () => seek(time + 10), j: () => seek(time - 10),
    };
    if (map[e.key]) { e.preventDefault(); e.stopPropagation(); map[e.key](); }
  };
  const barRef = useRef<HTMLDivElement>(null);
  const timeAt = (clientX: number) => { const r = barRef.current!.getBoundingClientRect(); return Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * (total || 0); };
  const sprite = stream?.sprite_meta;
  const spriteStyle = hover && sprite?.every && stream?.sprite ? (() => {
    const i = Math.floor(hover.t / sprite.every);
    return { backgroundImage: `url(${stream.sprite})`, backgroundPosition: `-${(i % sprite.columns) * sprite.w}px -${Math.floor(i / sprite.columns) * sprite.h}px`, width: sprite.w, height: sprite.h };
  })() : undefined;

  if (error) return <div className="grid aspect-video place-items-center rounded-xl bg-surface-2 p-6 text-center text-sm text-fg-2">{(error as Error).message}</div>;
  const show = !playing || !idle;
  return (
    <div ref={shell} tabIndex={0} role="group" aria-label="Video player" onKeyDown={onKey} onMouseMove={() => setIdle(false)} onContextMenu={(e) => { if (isPreview) e.preventDefault(); }}
      data-testid="video-player" className={cn("group relative aspect-video overflow-hidden rounded-xl bg-black font-sans text-white", full && "rounded-none")}>
      <video ref={video} poster={stream?.poster} playsInline className="size-full" controlsList="nodownload" onClick={toggle}
        onContextMenu={(e) => e.preventDefault()} onPlay={() => { setPlaying(true); setEnded(false); }} onPause={() => setPlaying(false)} onTimeUpdate={onTime}
        onLoadedMetadata={(e) => { setTotal(e.currentTarget.duration); if (resumeAt && !isPreview && resumeAt < e.currentTarget.duration - 5) e.currentTarget.currentTime = resumeAt; }}
        onEnded={() => { setEnded(true); if (isPreview) onPreviewEnd?.(); }} />
      {!playing && !ended && <button aria-label="Play video" onClick={toggle} className="absolute left-1/2 top-1/2 grid size-16 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-primary text-primary-fg shadow-lg"><Play className="size-7 translate-x-0.5" fill="currentColor" /></button>}
      {ended && isPreview && (
        <div data-testid="preview-ended" className="absolute inset-0 grid place-items-center bg-black/75 p-4 text-center backdrop-blur-sm">
          <div><Lock className="mx-auto mb-2 size-7" aria-hidden /><p className="font-semibold">That was the free preview</p><p className="text-sm text-white/75">Unlock this lesson below to keep watching.</p></div>
        </div>
      )}
      {isPreview && !ended && <span className="absolute left-3 top-3 rounded-md bg-black/60 px-2 py-1 text-xs font-medium backdrop-blur-sm">Preview · {stream?.preview_seconds}s</span>}
      <div className={cn("absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-3 pb-1.5 pt-10 transition-opacity", show ? "opacity-100" : "opacity-0 focus-within:opacity-100")}>
        {hover && spriteStyle && <div className="pointer-events-none absolute bottom-16 -translate-x-1/2 overflow-hidden rounded border border-white/30" style={{ left: hover.x, ...spriteStyle }} />}
        <div ref={barRef} role="slider" tabIndex={-1} aria-label="Seek" aria-valuenow={Math.round(time)} aria-valuemin={0} aria-valuemax={Math.round(total)} className="relative flex h-5 cursor-pointer items-center"
          onMouseMove={(e) => { const r = barRef.current!.getBoundingClientRect(); setHover({ x: e.clientX - r.left + 12, t: timeAt(e.clientX) }); }} onMouseLeave={() => setHover(null)} onClick={(e) => seek(timeAt(e.clientX))}>
          <div className="relative h-1 w-full overflow-hidden rounded-full bg-white/25">
            <div className="absolute inset-y-0 left-0 bg-white/35" style={{ width: `${total ? (buffered / total) * 100 : 0}%` }} />
            <div className="absolute inset-y-0 left-0 bg-primary" style={{ width: `${total ? (time / total) * 100 : 0}%` }} />
          </div>
        </div>
        <div className="flex items-center gap-0.5">
          <button className={ctrl} aria-label={playing ? "Pause" : "Play"} onClick={toggle}>{playing ? <Pause /> : <Play />}</button>
          <button className={ctrl} aria-label={muted ? "Unmute" : "Mute"} onClick={() => { if (video.current) { video.current.muted = !muted; setMuted(!muted); } }}>{muted ? <VolumeX /> : <Volume2 />}</button>
          <span className="ml-1 text-xs tabular-nums text-white/85">{fmt(time) || "0:00"} / {fmt(total || stream?.duration) || "0:00"}</span>
          <div className="ml-auto flex items-center gap-0.5">
            <Dropdown>
              <DropdownTrigger className={ctrl} aria-label="Playback speed"><Gauge /></DropdownTrigger>
              <DropdownContent className="min-w-28" >{SPEEDS.map((s) => <DropdownItem key={s} onSelect={() => { if (video.current) video.current.playbackRate = s; setSpeed(s); }}>{speed === s ? <Check /> : <span className="size-4" />}{s}x</DropdownItem>)}</DropdownContent>
            </Dropdown>
            {levels.length > 1 && (
              <Dropdown>
                <DropdownTrigger className={ctrl} aria-label="Video quality"><Settings /></DropdownTrigger>
                <DropdownContent className="min-w-28">
                  {[{ index: -1, label: "Auto" }, ...levels].map((l) => <DropdownItem key={l.index} onSelect={() => { if (hls.current) hls.current.currentLevel = l.index; setLevel(l.index); }}>{level === l.index ? <Check /> : <span className="size-4" />}{l.label}</DropdownItem>)}
                </DropdownContent>
              </Dropdown>
            )}
            <button className={cn(ctrl, "hidden sm:grid")} aria-label="Picture in picture" onClick={() => { document.pictureInPictureElement ? document.exitPictureInPicture() : video.current?.requestPictureInPicture?.(); }}><PictureInPicture2 /></button>
            <button className={ctrl} aria-label={full ? "Exit fullscreen" : "Fullscreen"} onClick={toggleFull}>{full ? <Minimize /> : <Maximize />}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
export { post };
