"use client";
import { useQuery } from "@tanstack/react-query";
import { Headphones, Pause, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { duration } from "@/lib/utils";

export function AudioPlayer({ assetId, title }: { assetId: string; title: string }) {
  const { data } = useQuery({ queryKey: ["preview", assetId], queryFn: () => api<{ url: string; preview: boolean; seconds?: number }>(`/media/${assetId}/preview/`) });
  const ref = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [total, setTotal] = useState(0);
  useEffect(() => { setPlaying(false); setTime(0); }, [data?.url]);
  return (
    <div className="flex items-center gap-3 rounded-xl border bg-surface p-3 font-sans shadow-sm">
      <Button size="icon" aria-label={playing ? "Pause" : "Play"} disabled={!data} className="rounded-full" onClick={() => (ref.current?.paused ? ref.current.play() : ref.current?.pause())}>{playing ? <Pause /> : <Play />}</Button>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2 text-[13px]">
          <span className="flex min-w-0 items-center gap-1.5 truncate font-medium"><Headphones className="size-3.5 shrink-0 text-fg-3" aria-hidden />{title}{data?.preview && " (preview)"}</span>
          <span className="shrink-0 tabular-nums text-fg-3">{duration(time) || "0:00"} / {duration(total) || "0:00"}</span>
        </div>
        <input type="range" aria-label="Seek" min={0} max={total || 1} step={0.1} value={time} className="mt-1 w-full accent-[var(--primary)]"
          onChange={(e) => { if (ref.current) ref.current.currentTime = Number(e.target.value); }} />
      </div>
      {data && <audio ref={ref} src={data.url} preload="metadata" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)} onLoadedMetadata={(e) => setTotal(e.currentTarget.duration)} />}
    </div>
  );
}
