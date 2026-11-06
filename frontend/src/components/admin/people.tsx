"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, CheckCircle2, Clock, CreditCard, Download, Eye, KeyRound, MoreHorizontal, Plus, RefreshCw, ShieldCheck, Trash2, UserPlus, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, IconButton } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Avatar, Badge, Card, Dropdown, DropdownContent, DropdownItem, DropdownSeparator, DropdownTrigger, EmptyState, PageHeader, Skeleton, Tabs } from "@/components/ui/display";
import { Field, Input, PasswordInput, PhoneInput, Select } from "@/components/ui/form";
import { Link } from "@/components/ui/link";
import { ConfirmSheet, Sheet } from "@/components/ui/overlay";
import { api, patch, post } from "@/lib/api";
import { useAction } from "@/lib/providers";
import { useTable } from "@/lib/use-table";
import { dateLabel, dateTime, formatPhone, money, normalizePhone, timeAgo } from "@/lib/utils";

const ORDER_TONE: Record<string, "success" | "danger" | "warning" | "neutral"> = { completed: "success", failed: "danger", pending: "warning", expired: "neutral", cancelled: "neutral", voided: "neutral" };
const OrderBadge = ({ s }: { s: string }) => <Badge tone={ORDER_TONE[s]}>{s}</Badge>;
const ORDER_EVENTS: Record<string, string> = { created: "Order created", push_sent: "USSD push sent", push_resent: "USSD push resent", session_created: "Hosted session created", webhook_received: "Webhook received", payment_completed: "Payment completed", account_created: "Account created", entitlement_granted: "Entitlement granted", payment_failed: "Payment failed", payment_expired: "Payment expired", payment_voided: "Payment voided", payment_cancelled: "Cancelled by customer", amount_mismatch: "Amount mismatch", duplicate_ignored: "Duplicate ignored", gateway_rejected: "Gateway rejected" };
const download = (path: string) => { location.href = `/api/v1${path}`; };

type OrderRow = { id: string; phone: string; first_name: string; last_name: string; amount: number; status: string; order_type: string; item_title: string; created_at: string; payment_provider: string };
export function Orders() {
  const table = useTable<OrderRow>("/admin/orders/");
  const router = useRouter();
  const columns: Column<OrderRow>[] = [
    { key: "item", header: "Item", cell: (r) => <div className="min-w-0"><div className="truncate font-medium">{r.item_title}</div><div className="truncate text-[13px] text-fg-3">{r.first_name} {r.last_name} · {formatPhone(r.phone)}</div></div> },
    { key: "amount", header: "Amount", sortable: true, cell: (r) => <span className="tabular-nums">{money(r.amount)}</span> },
    { key: "status", header: "Status", cell: (r) => <OrderBadge s={r.status} /> },
    { key: "provider", header: "Network", mobile: false, cell: (r) => <span className="text-fg-2">{r.payment_provider || "—"}</span> },
    { key: "created_at", header: "Created", sortable: true, cell: (r) => <span className="whitespace-nowrap text-fg-2">{dateTime(r.created_at)}</span> },
  ];
  return (
    <>
      <PageHeader title="Orders" description="Every payment attempt, with its full history." actions={<Button variant="secondary" onClick={() => download(`/admin/orders/export/?${table.params}`)}><Download />Export CSV</Button>} />
      <DataTable columns={columns} rows={table.rows} rowId={(r) => r.id} loading={table.query.isLoading} total={table.total} page={table.page} totalPages={table.totalPages} onPage={table.setPage} search={table.search} onSearch={table.setSearch} searchPlaceholder="Phone, reference or item" ordering={table.ordering} onOrdering={table.setOrdering} onRowClick={(r) => router.push(`/admin/orders/${r.id}`)}
        filters={<>
          <Select label="Status" className="w-32" placeholder="Status" value={table.filters.status} onChange={(v) => table.setFilter("status", v)} options={[{ value: "", label: "All" }, ...Object.keys(ORDER_TONE).map((s) => ({ value: s, label: s[0].toUpperCase() + s.slice(1) }))]} />
          <Select label="Type" className="w-36" placeholder="Type" value={table.filters.order_type} onChange={(v) => table.setFilter("order_type", v)} options={[{ value: "", label: "All types" }, { value: "content_purchase", label: "Content" }, { value: "subscription", label: "Subscription" }, { value: "gateway_test", label: "Gateway test" }]} />
          <Input aria-label="From date" type="date" className="w-40" value={table.filters.date_from ?? ""} onChange={(e) => table.setFilter("date_from", e.target.value)} />
          <Input aria-label="To date" type="date" className="w-40" value={table.filters.date_to ?? ""} onChange={(e) => table.setFilter("date_to", e.target.value)} />
        </>}
        empty={{ icon: CreditCard, title: "No orders", text: "Orders appear here as soon as someone checks out." }} />
    </>
  );
}
export function OrderDetail({ id }: { id: string }) {
  const { data, refetch } = useQuery({ queryKey: ["order-admin", id], queryFn: () => api<any>(`/admin/orders/${id}/`) });
  const recheck = useAction(() => post(`/admin/orders/${id}/recheck/`), { success: (r) => `Snippe says: ${r.gateway_status}`, onSuccess: () => refetch() });
  if (!data) return <Skeleton className="h-96" />;
  return (
    <>
      <PageHeader title={data.item_title} description={<span className="inline-flex items-center gap-2">{money(data.amount)} <OrderBadge s={data.status} /></span>} actions={<Button variant="secondary" loading={recheck.isPending} onClick={() => recheck.mutate()}><RefreshCw />Re-check with Snippe</Button>} />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-4 lg:col-span-2">
          <h2 className="mb-3 text-sm font-semibold">Timeline</h2>
          <ol className="space-y-3 border-l pl-4">
            {data.timeline.map((t: any, i: number) => (
              <li key={i} className="relative">
                <span className="absolute -left-[21px] top-1.5 size-2.5 rounded-full bg-primary" aria-hidden />
                <div className="text-sm font-medium">{ORDER_EVENTS[t.event] ?? t.event}</div>
                <div className="text-[13px] text-fg-3">{dateTime(t.at)}{t.detail && ` · ${t.detail}`}</div>
              </li>
            ))}
          </ol>
        </Card>
        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold">Customer</h2>
          <dl className="space-y-2 text-sm">
            <div><dt className="text-[13px] text-fg-3">Name</dt><dd>{data.first_name} {data.last_name}</dd></div>
            <div><dt className="text-[13px] text-fg-3">Phone</dt><dd className="tabular-nums">{formatPhone(data.phone)}</dd></div>
            {data.user && <div><Link href={`/admin/users/${data.user}`} className="text-primary-ink">Open user</Link></div>}
            {data.status === "completed" && data.order_type !== "gateway_test" && <div><Link href={`/library/receipts/${data.id}`} className="text-primary-ink">Open receipt</Link></div>}
            <div><dt className="text-[13px] text-fg-3">Reference</dt><dd className="break-all">{data.snippe_reference || "—"}</dd></div>
            <div><dt className="text-[13px] text-fg-3">Network</dt><dd>{data.payment_provider || "—"}</dd></div>
            {data.failure_reason && <div><dt className="text-[13px] text-fg-3">Reason</dt><dd className="text-danger">{data.failure_reason}</dd></div>}
          </dl>
        </Card>
        <Card className="p-4 lg:col-span-3">
          <h2 className="mb-2 text-sm font-semibold">Gateway payloads</h2>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="min-w-0"><div className="mb-1 text-[13px] text-fg-3">Request</div><pre className="max-h-72 overflow-auto rounded-lg bg-surface-2 p-3 text-xs">{JSON.stringify(data.raw_request, null, 2)}</pre></div>
            <div className="min-w-0"><div className="mb-1 text-[13px] text-fg-3">Response</div><pre className="max-h-72 overflow-auto rounded-lg bg-surface-2 p-3 text-xs">{JSON.stringify(data.raw_response, null, 2)}</pre></div>
          </div>
        </Card>
      </div>
    </>
  );
}

type UserRow = { id: string; phone: string; first_name: string; last_name: string; email: string; role: string; is_active: boolean; source: string; date_joined: string; last_seen: string | null; has_subscription: boolean; must_change_password: boolean };
const SOURCES: Record<string, string> = { self_signup: "Signed up", auto_created_by_payment: "From payment", admin_created: "Added by admin" };
const nameOf = (u: UserRow) => `${u.first_name} ${u.last_name}`.trim() || formatPhone(u.phone);
export function UsersList() {
  const table = useTable<UserRow>("/admin/users/");
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ phone: "", first_name: "", last_name: "", role: "student" });
  const key = "/admin/users/";
  const bulk = useAction((v: { ids: string[]; action: string }) => post("/admin/users/bulk/", v), { success: (r) => `${r.count} users updated`, invalidate: [[key]] });
  const create = useAction(() => post("/admin/users/", { ...form, phone: normalizePhone(form.phone) ?? form.phone }), { success: "User added. Their password is their phone number.", invalidate: [[key]], onSuccess: () => setAdding(false) });
  const columns: Column<UserRow>[] = [
    { key: "first_name", header: "Name", sortable: true, cell: (r) => <div className="flex min-w-0 items-center gap-2.5"><Avatar name={nameOf(r)} className="size-8" /><div className="min-w-0"><div className="truncate font-medium">{nameOf(r)}</div><div className="truncate text-[13px] tabular-nums text-fg-3">{formatPhone(r.phone)}</div></div></div> },
    { key: "role", header: "Role", cell: (r) => <Badge tone={r.role === "student" ? "neutral" : "primary"}>{r.role}</Badge> },
    { key: "state", header: "Status", cell: (r) => (r.is_active ? (r.has_subscription ? <Badge tone="success">Subscribed</Badge> : <Badge>Active</Badge>) : <Badge tone="danger">Suspended</Badge>) },
    { key: "source", header: "Source", mobile: false, cell: (r) => <span className="text-fg-2">{SOURCES[r.source]}</span> },
    { key: "date_joined", header: "Joined", sortable: true, mobile: false, cell: (r) => <span className="whitespace-nowrap text-fg-2">{dateLabel(r.date_joined)}</span> },
    { key: "last_seen", header: "Last seen", sortable: true, mobile: false, cell: (r) => <span className="whitespace-nowrap text-fg-2">{timeAgo(r.last_seen)}</span> },
  ];
  return (
    <>
      <PageHeader title="Users" description="Students, editors and admins." actions={<><Button variant="secondary" onClick={() => download(`/admin/users/export/?${table.params}`)}><Download />Export CSV</Button><Button onClick={() => setAdding(true)}><UserPlus />Add user</Button></>} />
      <DataTable columns={columns} rows={table.rows} rowId={(r) => r.id} loading={table.query.isLoading} total={table.total} page={table.page} totalPages={table.totalPages} onPage={table.setPage} search={table.search} onSearch={table.setSearch} searchPlaceholder="Name, phone or email" ordering={table.ordering} onOrdering={table.setOrdering} onRowClick={(r) => router.push(`/admin/users/${r.id}`)}
        filters={<>
          <Select label="Role" className="w-28" placeholder="Role" value={table.filters.role} onChange={(v) => table.setFilter("role", v)} options={[{ value: "", label: "All roles" }, { value: "student", label: "Student" }, { value: "editor", label: "Editor" }, { value: "admin", label: "Admin" }]} />
          <Select label="Status" className="w-32" placeholder="Status" value={table.filters.is_active} onChange={(v) => table.setFilter("is_active", v)} options={[{ value: "", label: "Any status" }, { value: "true", label: "Active" }, { value: "false", label: "Suspended" }]} />
          <Select label="Subscription" className="w-36" placeholder="Subscription" value={table.filters.has_subscription} onChange={(v) => table.setFilter("has_subscription", v)} options={[{ value: "", label: "Any plan" }, { value: "true", label: "Subscribed" }, { value: "false", label: "Not subscribed" }]} />
          <Select label="Source" className="w-36" placeholder="Source" value={table.filters.source} onChange={(v) => table.setFilter("source", v)} options={[{ value: "", label: "Any source" }, ...Object.entries(SOURCES).map(([value, label]) => ({ value, label }))]} />
          <Input aria-label="Joined after" type="date" className="w-40" value={table.filters.joined_after ?? ""} onChange={(e) => table.setFilter("joined_after", e.target.value)} />
        </>}
        bulkActions={(ids, clear) => (<>
          <Button size="sm" variant="secondary" onClick={() => bulk.mutate({ ids, action: "activate" }, { onSuccess: clear })}>Activate</Button>
          <Button size="sm" variant="secondary" onClick={() => bulk.mutate({ ids, action: "suspend" }, { onSuccess: clear })}>Suspend</Button>
          <Button size="sm" variant="secondary" onClick={() => bulk.mutate({ ids, action: "force_password_change" }, { onSuccess: clear })}>Force password change</Button>
        </>)}
        empty={{ icon: Users, title: "No users found", text: "Change your filters, or add someone yourself.", action: <Button onClick={() => setAdding(true)}><UserPlus />Add user</Button> }} />
      <Sheet open={adding} onOpenChange={setAdding} title="Add a user" description="Their first password is their phone number, and they must change it." size="sm" footer={<Button loading={create.isPending} onClick={() => create.mutate()}>Add user</Button>}>
        <div className="space-y-4">
          <Field label="Phone number"><PhoneInput value={form.phone} onChange={(phone) => setForm({ ...form, phone })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="First name"><Input value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} /></Field>
            <Field label="Last name"><Input value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} /></Field>
          </div>
          <Field label="Role"><Select value={form.role} onChange={(role) => setForm({ ...form, role })} options={[{ value: "student", label: "Student" }, { value: "editor", label: "Editor" }, { value: "admin", label: "Admin" }]} /></Field>
        </div>
      </Sheet>
    </>
  );
}
function Grant({ userId, open, onOpenChange, onDone }: { userId: string; open: boolean; onOpenChange: (v: boolean) => void; onDone: () => void }) {
  const [kind, setKind] = useState("subscription");
  const [plan, setPlan] = useState("");
  const [content, setContent] = useState("");
  const [days, setDays] = useState("");
  const [reason, setReason] = useState("");
  const plans = useQuery({ queryKey: ["admin-plans"], enabled: open, queryFn: () => api<any[]>("/admin/plans/") });
  const contents = useQuery({ queryKey: ["paid-contents"], enabled: open, queryFn: () => api<any>("/admin/contents/?access_level=paid&page_size=100") });
  const grant = useAction(() => post(`/admin/users/${userId}/grant/`, { kind, plan, content, days: days || null, reason }), { success: "Access granted", onSuccess: () => { onOpenChange(false); onDone(); } });
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Grant access" size="sm" footer={<Button disabled={!reason.trim() || (kind === "subscription" ? !plan : !content)} loading={grant.isPending} onClick={() => grant.mutate()}>Grant</Button>}>
      <div className="space-y-4">
        <Field label="What"><Select value={kind} onChange={setKind} options={[{ value: "subscription", label: "Subscription" }, { value: "content", label: "One lesson" }]} /></Field>
        {kind === "subscription" ? <Field label="Plan"><Select value={plan} onChange={setPlan} options={(plans.data ?? []).map((p) => ({ value: p.id, label: p.name }))} /></Field>
          : <Field label="Lesson"><Select value={content} onChange={setContent} options={(contents.data?.results ?? []).map((c: any) => ({ value: c.id, label: c.title }))} /></Field>}
        <Field label="Days" hint={kind === "subscription" ? "Empty uses the plan length" : "Empty means lifetime"}><Input type="number" min={1} value={days} onChange={(e) => setDays(e.target.value)} /></Field>
        <Field label="Reason"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why, for the audit trail" /></Field>
      </div>
    </Sheet>
  );
}
export function UserDetail({ id }: { id: string }) {
  const { data, refetch } = useQuery({ queryKey: ["user-admin", id], queryFn: () => api<any>(`/admin/users/${id}/detail_data/`) });
  const client = useQueryClient();
  const [tab, setTab] = useState("access");
  const [grant, setGrant] = useState(false);
  const [reset, setReset] = useState(false);
  const [custom, setCustom] = useState("");
  const [anon, setAnon] = useState(false);
  const [entAction, setEntAction] = useState<{ ent: any; kind: "revoke" | "extend" } | null>(null);
  const [reason, setReason] = useState("");
  const [days, setDays] = useState("30");
  const done = () => { refetch(); client.invalidateQueries({ queryKey: ["/admin/users/"] }); };
  const update = useAction((v: object) => patch(`/admin/users/${id}/`, v), { success: "User updated", onSuccess: done });
  const resetPw = useAction(() => post(`/admin/users/${id}/reset-password/`, { password: custom }), { success: "Password reset. Their sessions were ended.", onSuccess: () => { setReset(false); setCustom(""); done(); } });
  const force = useAction(() => post(`/admin/users/${id}/force-password-change/`), { success: "They must change their password at next login", onSuccess: done });
  const anonymise = useAction(() => post(`/admin/users/${id}/anonymise/`), { success: "User anonymised", onSuccess: () => { setAnon(false); done(); } });
  const viewAs = useAction(() => post(`/admin/users/${id}/impersonate/`), { onSuccess: () => { location.href = "/"; } });
  const entitlement = useAction(() => post(`/admin/users/${id}/entitlements/${entAction!.ent.id}/${entAction!.kind}/`, { reason, days: Number(days) }), { success: "Access updated", onSuccess: () => { setEntAction(null); setReason(""); done(); } });
  if (!data) return <Skeleton className="h-96" />;
  const u: UserRow = data.user;
  return (
    <>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Avatar name={nameOf(u)} className="size-12 text-base" />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[22px] font-semibold tracking-tight">{nameOf(u)}</h1>
          <div className="flex flex-wrap items-center gap-2 text-sm text-fg-2"><span className="tabular-nums">{formatPhone(u.phone)}</span><Badge tone={u.role === "student" ? "neutral" : "primary"}>{u.role}</Badge>{!u.is_active && <Badge tone="danger">Suspended</Badge>}{u.must_change_password && <Badge tone="warning">Must change password</Badge>}</div>
        </div>
        <div className="flex gap-2">
          {u.role === "student" && <Button variant="secondary" loading={viewAs.isPending} onClick={() => viewAs.mutate()}><Eye />View as student</Button>}
          <Dropdown>
            <DropdownTrigger asChild><IconButton label="User actions" variant="secondary"><MoreHorizontal /></IconButton></DropdownTrigger>
            <DropdownContent>
              <DropdownItem onSelect={() => setReset(true)}><KeyRound />Reset password</DropdownItem>
              <DropdownItem onSelect={() => force.mutate()}><ShieldCheck />Force password change</DropdownItem>
              <DropdownItem onSelect={() => update.mutate({ is_active: !u.is_active })}>{u.is_active ? <Ban /> : <CheckCircle2 />}{u.is_active ? "Suspend" : "Activate"}</DropdownItem>
              <DropdownSeparator />
              {["student", "editor", "admin"].filter((r) => r !== u.role).map((r) => <DropdownItem key={r} onSelect={() => update.mutate({ role: r })}>Make {r}</DropdownItem>)}
              <DropdownSeparator />
              <DropdownItem danger onSelect={() => setAnon(true)}><Trash2 />Delete and anonymise</DropdownItem>
            </DropdownContent>
          </Dropdown>
        </div>
      </div>
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card className="p-3"><div className="text-[13px] text-fg-3">Joined</div><div className="text-sm font-medium">{dateLabel(u.date_joined)}</div></Card>
        <Card className="p-3"><div className="text-[13px] text-fg-3">Last seen</div><div className="text-sm font-medium">{timeAgo(u.last_seen)}</div></Card>
        <Card className="p-3"><div className="text-[13px] text-fg-3">Source</div><div className="text-sm font-medium">{SOURCES[u.source]}</div></Card>
        <Card className="p-3"><div className="text-[13px] text-fg-3">Subscription</div><div className="text-sm font-medium">{data.subscription_expires_at ? `Until ${dateLabel(data.subscription_expires_at)}` : "None"}</div></Card>
      </div>
      <Tabs className="mb-4" value={tab} onChange={setTab} items={[{ value: "access", label: `Access (${data.entitlements.length})` }, { value: "orders", label: `Orders (${data.orders.length})` }, { value: "comments", label: `Comments (${data.comments.length})` }, { value: "audit", label: "Audit trail" }]} />
      {tab === "access" && (
        <Card className="p-4">
          <div className="mb-2 flex items-center justify-between"><h2 className="text-sm font-semibold">Entitlements</h2><Button size="sm" onClick={() => setGrant(true)}><Plus />Grant access</Button></div>
          {data.entitlements.length === 0 ? <p className="py-6 text-center text-sm text-fg-2">No access yet.</p> : (
            <ul className="divide-y">
              {data.entitlements.map((e: any) => (
                <li key={e.id} className="flex flex-wrap items-center gap-2 py-2.5">
                  <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{e.title}</div><div className="text-[13px] text-fg-3">{e.kind} · {e.expires_at ? `until ${dateLabel(e.expires_at)}` : "lifetime"} · by {e.granted_by}{e.reason && ` · ${e.reason}`}</div></div>
                  <Badge tone={e.is_current ? "success" : "neutral"}>{e.is_current ? "Active" : "Ended"}</Badge>
                  <Button size="sm" variant="ghost" onClick={() => setEntAction({ ent: e, kind: "extend" })}><Clock />Extend</Button>
                  {e.is_active && <Button size="sm" variant="ghost" className="text-danger" onClick={() => setEntAction({ ent: e, kind: "revoke" })}>Revoke</Button>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
      {tab === "orders" && (data.orders.length === 0 ? <EmptyState icon={CreditCard} title="No orders" text="This person has not paid for anything." /> : <Card className="divide-y">{data.orders.map((o: any) => <Link key={o.id} href={`/admin/orders/${o.id}`} spinner="none" className="flex items-center gap-3 p-3 text-sm hover:bg-surface-2"><span className="min-w-0 flex-1 truncate">{o.item_title}</span><span className="tabular-nums">{money(o.amount)}</span><OrderBadge s={o.status} /></Link>)}</Card>)}
      {tab === "comments" && (data.comments.length === 0 ? <EmptyState icon={Users} title="No comments" text="This person has not commented." /> : <Card className="divide-y">{data.comments.map((c: any) => <div key={c.id} className="p-3 text-sm"><p>{c.body}</p><div className="mt-0.5 text-[13px] text-fg-3">{timeAgo(c.created_at)} · {c.status}</div></div>)}</Card>)}
      {tab === "audit" && (data.audit.length === 0 ? <EmptyState icon={ShieldCheck} title="No changes logged" text="Admin changes to this user appear here." /> : <Card className="divide-y">{data.audit.map((a: any) => <div key={a.id} className="p-3 text-sm"><code className="text-[13px]">{a.action}</code><div className="text-[13px] text-fg-3">{a.actor_label} · {dateTime(a.timestamp)}</div></div>)}</Card>)}
      <Grant userId={id} open={grant} onOpenChange={setGrant} onDone={done} />
      <Sheet open={reset} onOpenChange={setReset} title="Reset password" description="Leave empty to reset it to their phone number. They must change it at next login." size="sm" footer={<Button loading={resetPw.isPending} onClick={() => resetPw.mutate()}>Reset password</Button>}>
        <Field label="New password (optional)"><PasswordInput autoComplete="new-password" value={custom} onChange={(e) => setCustom(e.target.value)} /></Field>
      </Sheet>
      <ConfirmSheet open={anon} onOpenChange={setAnon} title="Delete and anonymise?" text="Their name, phone and email are erased. Order totals stay for your records. This cannot be undone." confirmLabel="Anonymise" danger loading={anonymise.isPending} onConfirm={() => anonymise.mutate()} />
      <Sheet open={!!entAction} onOpenChange={(v) => { if (!v) setEntAction(null); }} title={entAction?.kind === "revoke" ? "Revoke access" : "Extend access"} description={entAction?.ent.title} size="sm" footer={<Button disabled={!reason.trim()} variant={entAction?.kind === "revoke" ? "danger" : "primary"} loading={entitlement.isPending} onClick={() => entitlement.mutate()}>{entAction?.kind === "revoke" ? "Revoke" : "Extend"}</Button>}>
        <div className="space-y-4">
          {entAction?.kind === "extend" && <Field label="Days to add"><Input type="number" min={1} value={days} onChange={(e) => setDays(e.target.value)} /></Field>}
          <Field label="Reason"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why, for the audit trail" /></Field>
        </div>
      </Sheet>
    </>
  );
}
