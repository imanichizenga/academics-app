"use client";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, Bookmark, Clock, CreditCard, GraduationCap, Receipt, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ContentCard, GRID, GridSkeleton } from "@/components/content/card";
import { useMyAccess } from "@/components/content/paywall";
import { Button } from "@/components/ui/button";
import { Badge, Card as Box, EmptyState, Tabs } from "@/components/ui/display";
import { Link } from "@/components/ui/link";
import { api } from "@/lib/api";
import { useSession } from "@/lib/providers";
import type { Card, Paged } from "@/lib/types";
import { dateLabel, money } from "@/lib/utils";

const TONE: Record<string, "success" | "danger" | "warning" | "neutral"> = { completed: "success", failed: "danger", pending: "warning" };

function Feed({ path, empty }: { path: string; empty: React.ReactNode }) {
  const { data, isLoading } = useQuery({ queryKey: [path], queryFn: () => api<Card[] | Paged<Card>>(path) });
  if (isLoading) return <GridSkeleton count={4} />;
  const rows = Array.isArray(data) ? data : data?.results ?? [];
  return rows.length ? <div className={GRID}>{rows.map((c) => <ContentCard key={c.id} item={c} />)}</div> : <>{empty}</>;
}
function Subscription() {
  const { data } = useMyAccess();
  if (!data) return null;
  if (!data.has_subscription) return (
    <Box className="mb-6 flex flex-wrap items-center gap-3 p-4">
      <div className="grid size-10 place-items-center rounded-lg bg-primary-soft text-primary-ink"><Sparkles className="size-5" aria-hidden /></div>
      <div className="min-w-0 flex-1"><div className="font-medium">{data.subscription_expired ? "Your subscription has ended" : "Unlock every lesson"}</div><div className="text-[13px] text-fg-2">{data.subscription_expired ? "Renew to keep learning." : "Subscribe for full access to all paid lessons."}</div></div>
      <Button asChild><Link href="/pricing">{data.subscription_expired ? "Renew" : "See plans"}</Link></Button>
    </Box>
  );
  const days = data.subscription_expires_at ? Math.max(0, Math.ceil((new Date(data.subscription_expires_at).getTime() - Date.now()) / 86400000)) : null;
  return (
    <Box className="mb-6 flex items-center gap-3 p-4">
      <div className="grid size-10 place-items-center rounded-lg bg-success-soft text-success"><GraduationCap className="size-5" aria-hidden /></div>
      <div className="min-w-0 flex-1"><div className="font-medium">Subscription active</div><div className="text-[13px] text-fg-2">{days != null ? `${days} days left · ends ${dateLabel(data.subscription_expires_at)}` : "No expiry"}</div></div>
      {days != null && days < 7 && <Button asChild size="sm"><Link href="/pricing">Renew</Link></Button>}
    </Box>
  );
}
function Payments() {
  const { data, isLoading } = useQuery({ queryKey: ["orders-mine"], queryFn: () => api<any[]>("/orders/mine/") });
  if (isLoading) return <GridSkeleton count={2} />;
  if (!data?.length) return <EmptyState icon={Receipt} title="No payments yet" text="Your receipts will appear here after your first purchase." action={<Button asChild><Link href="/pricing">See plans</Link></Button>} />;
  return (
    <ul className="divide-y rounded-xl border bg-surface">
      {data.map((o) => (
        <li key={o.id} className="flex items-center gap-3 p-4">
          <CreditCard className="size-5 shrink-0 text-fg-3" aria-hidden />
          <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{o.item_title}</div><div className="text-[13px] text-fg-3">{dateLabel(o.paid_at ?? o.created_at)}{o.payment_provider && ` · ${o.payment_provider}`} · Ref {o.id.slice(0, 8)}</div></div>
          <div className="shrink-0 text-right"><div className="text-sm font-medium tabular-nums">{money(o.amount)}</div><Badge tone={TONE[o.status] ?? "neutral"}>{o.status}</Badge></div>
        </li>
      ))}
    </ul>
  );
}
export function Library() {
  const { user, loading } = useSession();
  const router = useRouter();
  const [tab, setTab] = useState("unlocked");
  useEffect(() => { if (!loading && !user) router.replace("/login?next=/library"); }, [loading, user, router]);
  if (!user) return <div className="mx-auto max-w-6xl px-4 pt-8 md:px-6"><GridSkeleton count={4} /></div>;
  return (
    <div className="pb-tabbar mx-auto max-w-6xl px-4 pt-5 md:px-6 md:pt-8">
      <h1 className="mb-4 text-[26px] font-semibold tracking-tight md:text-3xl">My learning</h1>
      <Subscription />
      <Tabs className="mb-5" value={tab} onChange={setTab} items={[{ value: "unlocked", label: "Unlocked" }, { value: "continue", label: "Continue" }, { value: "bookmarks", label: "Bookmarks" }, { value: "payments", label: "Payments" }]} />
      {tab === "unlocked" && <Feed path="/library/unlocked/" empty={<EmptyState icon={BookOpen} title="Nothing unlocked yet" text="Lessons you buy or subscribe to will live here." action={<Button asChild><Link href="/explore">Browse lessons</Link></Button>} />} />}
      {tab === "continue" && <Feed path="/catalog/continue/" empty={<EmptyState icon={Clock} title="Nothing in progress" text="Start a lesson and we will keep your place." action={<Button asChild><Link href="/explore">Browse lessons</Link></Button>} />} />}
      {tab === "bookmarks" && <Feed path="/library/bookmarks/" empty={<EmptyState icon={Bookmark} title="No bookmarks" text="Tap the bookmark on any lesson to save it for later." action={<Button asChild><Link href="/explore">Browse lessons</Link></Button>} />} />}
      {tab === "payments" && <Payments />}
    </div>
  );
}
