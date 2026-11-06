import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
export const money = (value?: number | null, currency = "TZS") =>
  value == null ? "" : `${currency} ${value.toLocaleString("en-US")}`;
export function fileSize(bytes?: number | null) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), 3);
  return `${(bytes / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`;
}
export function duration(seconds?: number | null) {
  if (!seconds) return "";
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}
export const dateLabel = (value?: string | null) =>
  value ? new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "";
export const dateTime = (value?: string | null) =>
  value ? new Date(value).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";
export function timeAgo(value?: string | null) {
  if (!value) return "never";
  const seconds = Math.max(1, (Date.now() - new Date(value).getTime()) / 1000);
  const steps: [number, string][] = [[31536000, "y"], [2592000, "mo"], [86400, "d"], [3600, "h"], [60, "m"], [1, "s"]];
  for (const [size, unit] of steps) if (seconds >= size) return `${Math.floor(seconds / size)}${unit} ago`;
  return "now";
}
/** Mirrors the backend: 07XX, 06XX, +255, 255 all become 255XXXXXXXXX, or null when invalid. */
export function normalizePhone(raw: string) {
  let d = raw.replace(/[^\d+]/g, "");
  if (d.startsWith("+")) d = d.slice(1);
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("0")) d = `255${d.slice(1)}`;
  else if (/^[67]/.test(d)) d = `255${d}`;
  return /^255[67]\d{8}$/.test(d) ? d : null;
}
export function formatPhoneInput(raw: string) {
  const keepPlus = raw.trim().startsWith("+");
  const d = raw.replace(/\D/g, "").slice(0, 12);
  const groups = d.startsWith("255") ? [3, 3, 3, 3] : [4, 3, 3];
  const out: string[] = [];
  let i = 0;
  for (const n of groups) {
    if (i >= d.length) break;
    out.push(d.slice(i, i + n));
    i += n;
  }
  return (keepPlus ? "+" : "") + out.join(" ");
}
export const contentTypeLabel: Record<string, string> = { article: "Article", document: "Document", video: "Video", audio: "Audio", mixed: "Course" };
