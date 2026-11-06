"use client";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CircleDollarSign, Clock, Eye, HardDrive, MessageSquare, Plus, Users, Wallet } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip as ChartTip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { Badge, Card, EmptyState, PageHeader, Skeleton, StatCard } from "@/components/ui/display";
import { Link } from "@/components/ui/link";
import { api } from "@/lib/api";
import { useSession } from "@/lib/providers";
import { dateTime, money } from "@/lib/utils";

function Health({ label, ok, text, href, icon: Icon }: { label: string; ok: boolean; text: string; href: string; icon: typeof Wallet }) {
  return (
    <Link href={href} spinner="none" className="flex items-center gap-3 rounded-lg p-2 hover:bg-surface-2">
      <Icon className="size-4 text-fg-3" aria-hidden />
      <span className="min-w-0 flex-1 text-sm">{label}</span>
      <Badge tone={ok ? "success" : "warning"}>{text}</Badge>
    </Link>
  );
}
export function Dashboard() {
  const { user } = useSession();
  const { data } = useQuery({ queryKey: ["dashboard"], queryFn: () => api<any>("/admin/dashboard/"), refetchInterval: 60000 });
  const isAdmin = user?.role === "admin";
  return (
    <>
      <PageHeader title="Dashboard" description={`Good to see you, ${user?.first_name || "teacher"}.`} actions={<Button asChild><Link href="/admin/contents/new"><Plus />New content</Link></Button>} />
      {!data ? <div className="space-y-4"><div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-24" />)}</div><Skeleton className="h-72" /></div> : (
        <div className="space-y-4">
          {isAdmin && (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatCard label="Revenue today" value={money(data.revenue_today)} hint={`${money(data.revenue_7d)} in 7 days`} icon={CircleDollarSign} />
              <StatCard label="Last 30 days" value={money(data.revenue_30d)} icon={Wallet} />
              <StatCard label="Active subscriptions" value={data.active_subscriptions} hint={`${data.expiring_soon} expiring soon`} icon={Clock} tone={data.expiring_soon ? "warning" : undefined} />
              <StatCard label="New students" value={data.new_students_30d} hint="in 30 days" icon={Users} />
            </div>
          )}
          <div className="grid gap-4 lg:grid-cols-3 [&>*]:min-w-0">
            {isAdmin && (
              <Card className="p-4 lg:col-span-2">
                <h2 className="mb-3 text-sm font-semibold">Revenue, last 30 days</h2>
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={data.revenue_series} margin={{ left: 0, right: 4, top: 4, bottom: 0 }}>
                      <defs><linearGradient id="rev" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--primary)" stopOpacity={0.28} /><stop offset="100%" stopColor="var(--primary)" stopOpacity={0} /></linearGradient></defs>
                      <CartesianGrid vertical={false} stroke="var(--border)" />
                      <XAxis dataKey="date" tickFormatter={(d) => d.slice(8)} tick={{ fontSize: 12, fill: "var(--fg-3)" }} axisLine={false} tickLine={false} minTickGap={24} />
                      <YAxis width={44} tickFormatter={(v) => (v >= 1000 ? `${v / 1000}k` : v)} tick={{ fontSize: 12, fill: "var(--fg-3)" }} axisLine={false} tickLine={false} />
                      <ChartTip formatter={(v: number) => [money(v), "Revenue"]} contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 13 }} />
                      <Area isAnimationActive={false} type="monotone" dataKey="revenue" stroke="var(--primary)" strokeWidth={2} fill="url(#rev)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </Card>
            )}
            <Card className="p-2">
              <h2 className="p-2 text-sm font-semibold">Health</h2>
              {isAdmin && <Health label="Payment gateway" icon={Wallet} href="/admin/settings/payments" ok={data.gateway_enabled && data.gateway_status === "passed"} text={data.gateway_enabled ? "Live" : data.gateway_status === "passed" ? "Tested, off" : "Not set up"} />}
              {isAdmin && <Health label={`Storage (${data.storage_backend})`} icon={HardDrive} href="/admin/settings/storage" ok={data.storage_status === "passed"} text={data.storage_status === "passed" ? "Healthy" : data.storage_status || "Not tested"} />}
              <Health label="Pending comments" icon={MessageSquare} href="/admin/comments" ok={!data.pending_comments} text={String(data.pending_comments)} />
              <Health label="Failed transcodes" icon={AlertTriangle} href="/admin/media?status=failed" ok={!data.failed_transcodes} text={String(data.failed_transcodes)} />
            </Card>
          </div>
          <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
            <Card className="p-4">
              <h2 className="mb-2 text-sm font-semibold">Top content by views</h2>
              <ul className="divide-y">{data.top_content_views.map((c: any) => <li key={c.id} className="flex items-center gap-3 py-2 text-sm"><Link href={`/admin/contents/${c.id}`} className="min-w-0 flex-1 truncate hover:text-primary-ink">{c.title}</Link><span className="inline-flex items-center gap-1 tabular-nums text-fg-2"><Eye className="size-3.5" aria-hidden />{c.view_count.toLocaleString()}</span></li>)}</ul>
            </Card>
            {isAdmin && (
              <Card className="p-4">
                <h2 className="mb-2 text-sm font-semibold">Top content by revenue</h2>
                <ul className="divide-y">{data.top_content_revenue.map((c: any) => <li key={c.content__slug} className="flex items-center justify-between gap-3 py-2 text-sm"><span className="min-w-0 truncate">{c.content__title}</span><span className="shrink-0 tabular-nums text-fg-2">{money(c.revenue)}</span></li>)}</ul>
              </Card>
            )}
          </div>
          {isAdmin && (
            <Card className="p-4">
              <div className="mb-2 flex items-center justify-between"><h2 className="text-sm font-semibold">Recent payments</h2><Link href="/admin/orders" className="text-[13px] font-medium text-primary-ink">All orders</Link></div>
              {data.recent_payments.length === 0 ? <EmptyState icon={Wallet} title="No payments yet" text="Paid orders will show up here." /> : (
                <ul className="divide-y">{data.recent_payments.map((o: any) => <li key={o.id}><Link href={`/admin/orders/${o.id}`} spinner="none" className="flex items-center gap-3 py-2 text-sm hover:text-primary-ink"><span className="min-w-0 flex-1 truncate">{o.first_name} {o.last_name} · {o.item_title}</span><span className="hidden text-[13px] text-fg-3 sm:block">{dateTime(o.paid_at)}</span><span className="tabular-nums">{money(o.amount)}</span></Link></li>)}</ul>
              )}
            </Card>
          )}
        </div>
      )}
    </>
  );
}
