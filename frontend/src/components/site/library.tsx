"use client";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, Bookmark, ChevronRight, Clock, CreditCard, GraduationCap, Receipt, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ContentCard, GridSkeleton } from "@/components/content/card";
import { useMyAccess } from "@/components/content/paywall";
import { Button } from "@/components/ui/button";
import { Badge, Card as Box, EmptyState, Tabs } from "@/components/ui/display";
import { Link } from "@/components/ui/link";
import { api } from "@/lib/api";
import { useSession, useT } from "@/lib/providers";
import type { Card, Paged } from "@/lib/types";
import { GRID, dateLabel, money } from "@/lib/utils";

const TONE: Record<string, "success" | "danger" | "warning" | "neutral"> = { completed: "success", failed: "danger", pending: "warning" };

function Feed({ path, empty }: { path: string; empty: React.ReactNode }) {
  const { data, isLoading } = useQuery({ queryKey: [path], queryFn: () => api<Card[] | Paged<Card>>(path) });
  if (isLoading) return <GridSkeleton count={4} />;
  const rows = Array.isArray(data) ? data : data?.results ?? [];
  return rows.length ? <div className={GRID}>{rows.map((c) => <ContentCard key={c.id} item={c} />)}</div> : <>{empty}</>;
}
function Subscription() {
  const { data } = useMyAccess();
  const { t, lang } = useT();
  if (!data) return null;
  if (!data.has_subscription) return (
    <Box className="mb-6 flex flex-wrap items-center gap-3 p-4">
      <div className="grid size-10 place-items-center rounded-lg bg-primary-soft text-primary-ink"><Sparkles className="size-5" aria-hidden /></div>
      <div className="min-w-0 flex-1"><div className="font-medium">{data.subscription_expired ? t.library.ended : t.library.unlockAll}</div><div className="text-[13px] text-fg-2">{data.subscription_expired ? t.library.renewText : t.library.subscribeText}</div></div>
      <Button asChild><Link href="/pricing">{data.subscription_expired ? t.library.renew : t.library.plans}</Link></Button>
    </Box>
  );
  const days = data.subscription_expires_at ? Math.max(0, Math.ceil((new Date(data.subscription_expires_at).getTime() - Date.now()) / 86400000)) : null;
  return (
    <Box className="mb-6 flex items-center gap-3 p-4">
      <div className="grid size-10 place-items-center rounded-lg bg-success-soft text-success"><GraduationCap className="size-5" aria-hidden /></div>
      <div className="min-w-0 flex-1"><div className="font-medium">{t.library.active}</div><div className="text-[13px] text-fg-2">{days != null ? t.library.daysLeft(days, dateLabel(data.subscription_expires_at, lang)) : t.library.noExpiry}</div></div>
      {days != null && days < 7 && <Button asChild size="sm"><Link href="/pricing">{t.library.renew}</Link></Button>}
    </Box>
  );
}
function Payments() {
  const { t, lang } = useT();
  const { data, isLoading } = useQuery({ queryKey: ["orders-mine"], queryFn: () => api<any[]>("/orders/mine/") });
  if (isLoading) return <GridSkeleton count={2} />;
  if (!data?.length) return <EmptyState icon={Receipt} title={t.library.noPayments} text={t.library.noPaymentsText} action={<Button asChild><Link href="/pricing">{t.library.plans}</Link></Button>} />;
  return (
    <ul className="divide-y rounded-xl border bg-surface">
      {data.map((o) => {
        const row = (<>
          <CreditCard className="size-5 shrink-0 text-fg-3" aria-hidden />
          <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{o.item_title}</div><div className="text-[13px] text-fg-3">{dateLabel(o.paid_at ?? o.created_at, lang)}{o.payment_provider && ` · ${o.payment_provider}`} · {t.library.ref} {o.id.slice(0, 8)}</div></div>
          <div className="shrink-0 text-right"><div className="text-sm font-medium tabular-nums">{money(o.amount)}</div><Badge tone={TONE[o.status] ?? "neutral"}>{t.library.status[o.status] ?? o.status}</Badge></div>
        </>);
        return <li key={o.id}>{o.status === "completed"
          ? <Link href={`/library/receipts/${o.id}`} spinner="none" aria-label={`${t.library.receipt}: ${o.item_title}`} className="flex items-center gap-3 p-4 hover:bg-surface-2">{row}<ChevronRight className="size-4 shrink-0 text-fg-3" aria-hidden /></Link>
          : <div className="flex items-center gap-3 p-4">{row}</div>}</li>;
      })}
    </ul>
  );
}
export function Library() {
  const { user, loading } = useSession();
  const { t } = useT();
  const router = useRouter();
  const [tab, setTab] = useState("unlocked");
  useEffect(() => { if (!loading && !user) router.replace("/login?next=/library"); }, [loading, user, router]);
  if (!user) return <div className="mx-auto max-w-6xl px-4 pt-8 md:px-6"><GridSkeleton count={4} /></div>;
  const browse = <Button asChild><Link href="/explore">{t.common.browse}</Link></Button>;
  return (
    <div className="pb-tabbar mx-auto max-w-6xl px-4 pt-5 md:px-6 md:pt-8">
      <h1 className="mb-4 text-[26px] font-semibold tracking-tight md:text-3xl">{t.library.title}</h1>
      <Subscription />
      <Tabs className="mb-5" value={tab} onChange={setTab} items={[{ value: "unlocked", label: t.library.tabUnlocked }, { value: "continue", label: t.library.tabContinue }, { value: "bookmarks", label: t.library.tabBookmarks }, { value: "payments", label: t.library.tabPayments }]} />
      {tab === "unlocked" && <Feed path="/library/unlocked/" empty={<EmptyState icon={BookOpen} title={t.library.noUnlocked} text={t.library.noUnlockedText} action={browse} />} />}
      {tab === "continue" && <Feed path="/catalog/continue/" empty={<EmptyState icon={Clock} title={t.library.noProgress} text={t.library.noProgressText} action={browse} />} />}
      {tab === "bookmarks" && <Feed path="/library/bookmarks/" empty={<EmptyState icon={Bookmark} title={t.library.noBookmarks} text={t.library.noBookmarksText} action={browse} />} />}
      {tab === "payments" && <Payments />}
    </div>
  );
}
