"use client";
import { ArrowRight, CheckCircle2, Info, Megaphone, TriangleAlert, X, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "@/components/ui/link";
import { useSession, useSite, useT } from "@/lib/providers";
import type { Announcement } from "@/lib/types";
import { cn } from "@/lib/utils";

type Tone = Announcement["tone"];
export const TONES: Record<Tone, { icon: LucideIcon; label: string; bar: string; chip: string; card: string; cta: string }> = {
  info: { icon: Info, label: "Information", bar: "bg-info-soft text-info border-info/15", chip: "bg-info/12 text-info", card: "border-info/20 bg-info-soft/60", cta: "bg-info text-white dark:text-black" },
  success: { icon: CheckCircle2, label: "Good news", bar: "bg-success-soft text-success border-success/15", chip: "bg-success/12 text-success", card: "border-success/20 bg-success-soft/60", cta: "bg-success text-white dark:text-black" },
  warning: { icon: TriangleAlert, label: "Important", bar: "bg-warning-soft text-warning border-warning/20", chip: "bg-warning/12 text-warning", card: "border-warning/25 bg-warning-soft/60", cta: "bg-warning text-white dark:text-black" },
  promo: { icon: Megaphone, label: "Offer", bar: "bg-primary text-primary-fg border-transparent", chip: "bg-primary-fg/15 text-primary-fg", card: "border-transparent bg-primary text-primary-fg", cta: "bg-primary-fg text-primary" },
};

/** Swahili text when the visitor reads Swahili and the admin wrote one, otherwise the main text. */
export function localized(a: Announcement, lang: string) {
  const sw = lang === "sw";
  return {
    title: (sw && a.title_sw) || a.title,
    body: (sw && a.body_sw) || a.body,
    label: (sw && a.link_label_sw) || a.link_label,
  };
}

function CtaLink({ href, className, children }: { href: string; className?: string; children: React.ReactNode }) {
  if (href.startsWith("/")) return <Link href={href} spinner="none" className={className}>{children}</Link>;
  return <a href={href} target="_blank" rel="noopener noreferrer" className={className}>{children}</a>;
}

export function AnnouncementBarView({ a, lang, learnMore, dismissLabel, onDismiss, preview }: { a: Announcement; lang: string; learnMore: string; dismissLabel: string; onDismiss?: () => void; preview?: boolean }) {
  const tone = TONES[a.tone] ?? TONES.info;
  const Icon = tone.icon;
  const text = localized(a, lang);
  return (
    <div role={preview ? undefined : "region"} aria-label={preview ? undefined : text.title} data-testid={preview ? undefined : "announcement-bar"} className={cn("no-print border-b", tone.bar)}>
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2.5 md:px-6">
        <span className={cn("grid size-7 shrink-0 place-items-center rounded-full", tone.chip)} aria-hidden><Icon className="size-4" /></span>
        <p className="min-w-0 flex-1 text-[13px] leading-snug md:text-sm">
          <span className="font-semibold">{text.title}</span>
          {text.body && <span className="opacity-90"> <span aria-hidden className="mx-1 hidden md:inline">·</span><span className="line-clamp-2 md:inline">{text.body}</span></span>}
        </p>
        {a.link_url && (
          <CtaLink href={a.link_url} className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-1 text-[13px] font-semibold underline-offset-4 hover:underline md:text-sm">
            {text.label || learnMore}<ArrowRight className="size-3.5" aria-hidden />
          </CtaLink>
        )}
        {a.dismissible && onDismiss && (
          <button type="button" aria-label={dismissLabel} onClick={onDismiss} className="-mr-2 grid size-9 shrink-0 place-items-center rounded-full opacity-70 hover:opacity-100"><X className="size-4" /></button>
        )}
      </div>
    </div>
  );
}

export function AnnouncementCardView({ a, lang, learnMore, dismissLabel, eyebrow, onDismiss, preview }: { a: Announcement; lang: string; learnMore: string; dismissLabel: string; eyebrow: string; onDismiss?: () => void; preview?: boolean }) {
  const tone = TONES[a.tone] ?? TONES.info;
  const Icon = tone.icon;
  const text = localized(a, lang);
  return (
    <article data-testid={preview ? undefined : "announcement-card"} className={cn("relative overflow-hidden rounded-2xl border p-5 shadow-sm md:p-6", tone.card)}>
      {a.tone === "promo" && <span aria-hidden className="pointer-events-none absolute -right-16 -top-20 size-56 rounded-full bg-primary-fg/10 blur-2xl" />}
      <div className="relative flex gap-4">
        <span className={cn("grid size-11 shrink-0 place-items-center rounded-xl", tone.chip)} aria-hidden><Icon className="size-5" /></span>
        <div className="min-w-0 flex-1 pr-6">
          <div className={cn("text-xs font-semibold uppercase tracking-wide", a.tone === "promo" ? "opacity-80" : "text-fg-3")}>{eyebrow}</div>
          <h2 className="mt-1 text-lg font-semibold leading-snug tracking-tight md:text-xl">{text.title}</h2>
          {text.body && <p className={cn("mt-1.5 max-w-2xl text-[15px] leading-relaxed", a.tone === "promo" ? "opacity-90" : "text-fg-2")}>{text.body}</p>}
          {a.link_url && (
            <CtaLink href={a.link_url} className={cn("mt-4 inline-flex h-10 items-center gap-1.5 rounded-lg px-4 text-sm font-semibold shadow-sm hover:opacity-90", tone.cta)}>
              {text.label || learnMore}<ArrowRight className="size-4" aria-hidden />
            </CtaLink>
          )}
        </div>
      </div>
      {a.dismissible && onDismiss && (
        <button type="button" aria-label={dismissLabel} onClick={onDismiss} className="absolute right-2 top-2 grid size-9 place-items-center rounded-full opacity-60 hover:opacity-100"><X className="size-4" /></button>
      )}
    </article>
  );
}

const storageKey = (a: Announcement) => `announcement:${a.id}`;

/** Live announcements for this placement, minus ones this visitor closed (an edit brings them back). */
function useVisible(placement: Announcement["placement"]) {
  const site = useSite();
  const { user, loading } = useSession();
  const [dismissed, setDismissed] = useState<Record<string, string> | null>(null);
  useEffect(() => {
    const seen: Record<string, string> = {};
    for (const a of site.announcements ?? []) {
      try { const v = localStorage.getItem(storageKey(a)); if (v) seen[a.id] = v; } catch {}
    }
    setDismissed(seen);
  }, [site.announcements]);
  const now = Date.now();
  const items = dismissed === null ? [] : (site.announcements ?? []).filter((a) =>
    a.placement === placement && dismissed[a.id] !== a.version && !(a.ends_at && Date.parse(a.ends_at) <= now)
    && (a.audience === "everyone" || (!loading && (a.audience === "members" ? !!user : !user))));
  const dismiss = (a: Announcement) => {
    try { localStorage.setItem(storageKey(a), a.version); } catch {}
    setDismissed((d) => ({ ...d, [a.id]: a.version }));
  };
  return { items, dismiss };
}

export function AnnouncementBar() {
  const { items, dismiss } = useVisible("bar");
  const { t, lang } = useT();
  const first = items[0]; // one bar at a time keeps the top of the page calm
  if (!first) return null;
  return <div className="animate-[announce-in_.32s_var(--ease)]"><AnnouncementBarView a={first} lang={lang} learnMore={t.announce.learnMore} dismissLabel={t.common.dismiss} onDismiss={() => dismiss(first)} /></div>;
}

export function HomeAnnouncements() {
  const { items, dismiss } = useVisible("home");
  const { t, lang } = useT();
  if (!items.length) return null;
  return (
    <section aria-label={t.announce.label} className="mt-8 grid gap-3 md:mt-10 md:gap-4">
      {items.slice(0, 3).map((a) => (
        <div key={a.id} className="animate-[announce-in_.32s_var(--ease)]">
          <AnnouncementCardView a={a} lang={lang} learnMore={t.announce.learnMore} dismissLabel={t.common.dismiss} eyebrow={t.announce.label} onDismiss={() => dismiss(a)} />
        </div>
      ))}
    </section>
  );
}
