"use client";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useT } from "@/lib/providers";
import { cn } from "@/lib/utils";
import { IconButton } from "./button";

/** Every horizontal row: swipe on phones; previous and next buttons with soft edges from md up. */
export function Carousel({ children, label }: { children: ReactNode; label: string }) {
  const { t } = useT();
  const track = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ start: true, end: true });
  const measure = useCallback(() => {
    const el = track.current;
    if (el) setEdge({ start: el.scrollLeft < 8, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 8 });
  }, []);
  useEffect(() => {
    const el = track.current;
    if (!el) return;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    el.addEventListener("scroll", measure, { passive: true });
    return () => { observer.disconnect(); el.removeEventListener("scroll", measure); };
  }, [measure]);
  const move = (direction: number) => { const el = track.current; if (el) el.scrollBy({ left: direction * el.clientWidth * 0.85, behavior: "smooth" }); };
  const fits = edge.start && edge.end;
  return (
    <div role="group" aria-label={label} className="relative">
      <div ref={track} data-testid="carousel" className="scroll-x carousel -mx-4 flex gap-4 px-4 md:mx-0 md:px-0">{children}</div>
      <div aria-hidden className={cn("pointer-events-none absolute inset-y-0 left-0 hidden w-14 bg-gradient-to-r from-bg to-transparent transition-opacity md:block", edge.start && "opacity-0")} />
      <div aria-hidden className={cn("pointer-events-none absolute inset-y-0 right-0 hidden w-14 bg-gradient-to-l from-bg to-transparent transition-opacity md:block", edge.end && "opacity-0")} />
      {!fits && (<>
        <IconButton label={t.common.previous} variant="secondary" size="icon-sm" disabled={edge.start} onClick={() => move(-1)} className="absolute -left-3 top-1/2 hidden -translate-y-1/2 rounded-full active:-translate-y-1/2 md:inline-flex"><ChevronLeft /></IconButton>
        <IconButton label={t.common.next} variant="secondary" size="icon-sm" disabled={edge.end} onClick={() => move(1)} className="absolute -right-3 top-1/2 hidden -translate-y-1/2 rounded-full active:-translate-y-1/2 md:inline-flex"><ChevronRight /></IconButton>
      </>)}
    </div>
  );
}
