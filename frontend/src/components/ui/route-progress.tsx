"use client";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";

function Bar() {
  const pathname = usePathname();
  const search = useSearchParams();
  const [width, setWidth] = useState(0);
  const [visible, setVisible] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
      const anchor = (event.target as HTMLElement).closest?.("a");
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href, location.href);
      if (url.origin !== location.origin || (url.pathname === location.pathname && url.search === location.search)) return;
      setVisible(true);
      setWidth(14);
      if (timer.current) clearInterval(timer.current);
      timer.current = setInterval(() => setWidth((w) => (w < 88 ? w + (92 - w) * 0.09 : w)), 180);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  useEffect(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    setWidth((w) => (w ? 100 : 0));
    const hide = setTimeout(() => { setVisible(false); setWidth(0); }, 240);
    return () => clearTimeout(hide);
  }, [pathname, search]);

  return (
    <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 z-[80] h-[2.5px]" style={{ opacity: visible ? 1 : 0, transition: "opacity 200ms" }}>
      <div className="h-full bg-primary shadow-[0_0_8px_var(--primary)]" style={{ width: `${width}%`, transition: "width 200ms var(--ease)" }} />
    </div>
  );
}
export function RouteProgress() {
  return <Suspense fallback={null}><Bar /></Suspense>;
}
