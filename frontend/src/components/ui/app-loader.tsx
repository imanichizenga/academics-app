"use client";
import { useEffect, useState } from "react";

/** Branded screen for the very first load of a session only. */
export function AppLoader({ name, logo }: { name: string; logo?: string }) {
  const [show, setShow] = useState(true);
  const [fading, setFading] = useState(false);
  useEffect(() => {
    let seen = false;
    try { seen = Boolean(sessionStorage.getItem("booted")); sessionStorage.setItem("booted", "1"); } catch {}
    if (seen) { setShow(false); return; }
    const fade = setTimeout(() => setFading(true), 420);
    const hide = setTimeout(() => setShow(false), 680);
    return () => { clearTimeout(fade); clearTimeout(hide); };
  }, []);
  if (!show) return null;
  return (
    <div
      id="app-loader"
      aria-hidden
      className="fixed inset-0 z-[90] grid place-items-center bg-bg"
      style={{ opacity: fading ? 0 : 1, transition: "opacity 260ms var(--ease)" }}
    >
      <div className="flex flex-col items-center gap-3">
        <LogoMark logo={logo} className="size-14" animated />
        <span className="text-sm font-medium tracking-tight text-fg-2">{name}</span>
      </div>
    </div>
  );
}
export function LogoMark({ logo, className, animated }: { logo?: string; className?: string; animated?: boolean }) {
  if (logo) return <img src={logo} alt="" className={`${className} rounded-[28%] object-cover`} />;
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden>
      <rect width="48" height="48" rx="13" fill="var(--primary)" />
      <path d="M14 13h9.5c8 0 12.5 4.6 12.5 11s-4.500 11-12.500 11H14z M20 18.700v10.600h3.300c4.300 0 6.700-2.100 6.700-5.300s-2.400-5.300-6.700-5.300z"
        fill={animated ? "none" : "var(--primary-fg)"} fillRule="evenodd"
        stroke={animated ? "var(--primary-fg)" : "none"} strokeWidth={animated ? 2 : 0} strokeDasharray={animated ? 120 : undefined}
        style={animated ? { animation: "mark-draw 1.1s var(--ease) infinite alternate" } : undefined} />
    </svg>
  );
}
