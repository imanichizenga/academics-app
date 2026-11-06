"use client";
import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

/** Native-style pull on phones. Inert with a mouse, and while the page is scrolled. */
export function PullToRefresh({ onRefresh, children }: { onRefresh: () => Promise<unknown>; children: ReactNode }) {
  const [pull, setPull] = useState(0);
  const [busy, setBusy] = useState(false);
  const start = useRef<number | null>(null);
  const distance = useRef(0);
  useEffect(() => {
    const down = (e: TouchEvent) => { start.current = scrollY <= 0 ? e.touches[0].clientY : null; };
    const move = (e: TouchEvent) => {
      if (start.current == null) return;
      distance.current = Math.max(0, Math.min(90, (e.touches[0].clientY - start.current) * 0.5));
      setPull(distance.current);
    };
    const up = async () => {
      if (start.current != null && distance.current > 60) {
        setBusy(true);
        await onRefresh().catch(() => {});
        setBusy(false);
      }
      start.current = null;
      distance.current = 0;
      setPull(0);
    };
    addEventListener("touchstart", down, { passive: true });
    addEventListener("touchmove", move, { passive: true });
    addEventListener("touchend", up);
    return () => { removeEventListener("touchstart", down); removeEventListener("touchmove", move); removeEventListener("touchend", up); };
  }, [onRefresh]);
  const height = busy ? 44 : pull;
  return (
    <>
      <div aria-hidden className="grid place-items-center overflow-hidden" style={{ height, transition: pull ? undefined : "height 200ms var(--ease)" }}>
        <Loader2 className={busy ? "size-5 animate-spin text-primary-ink" : "size-5 text-fg-3"} style={busy ? undefined : { transform: `rotate(${pull * 4}deg)` }} />
      </div>
      {children}
    </>
  );
}
