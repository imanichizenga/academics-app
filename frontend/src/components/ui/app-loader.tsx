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
        <LogoMark logo={logo} name={name} className="size-14" animated />
        <span className="text-sm font-medium tracking-tight text-fg-2">{name}</span>
      </div>
    </div>
  );
}
/** The uploaded logo, or the first letter of the site name on the brand colour. */
export function LogoMark({ logo, name, className, animated }: { logo?: string; name: string; className?: string; animated?: boolean }) {
  if (logo) return <img src={logo} alt="" className={`${className} rounded-[28%] object-cover`} />;
  const initial = Array.from(name.trim())[0]?.toUpperCase() ?? "";
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden>
      <rect width="48" height="48" rx="13" fill="var(--primary)" />
      <text x="24" y="25" textAnchor="middle" dominantBaseline="central" fontSize="28" fontWeight="700"
        fill={animated ? "none" : "var(--primary-fg)"}
        stroke={animated ? "var(--primary-fg)" : "none"} strokeWidth={animated ? 1.5 : 0} strokeDasharray={animated ? 120 : undefined}
        style={animated ? { animation: "mark-draw 1.1s var(--ease) infinite alternate" } : undefined}>{initial}</text>
    </svg>
  );
}
