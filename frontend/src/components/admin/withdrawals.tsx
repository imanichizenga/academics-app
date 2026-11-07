"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDownToLine, ArrowLeft, ArrowRight, Banknote, CheckCircle2, Clock3, CreditCard, Info, Landmark, Loader2, RefreshCw, ShieldCheck, Smartphone, TriangleAlert, Wallet } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { DataTable, useDebounced, type Column } from "@/components/ui/data-table";
import { Avatar, Badge, Card, PageHeader, Skeleton, StatCard, Tabs } from "@/components/ui/display";
import { Field, Input, PasswordInput, PhoneInput, Select, Switch } from "@/components/ui/form";
import { Link } from "@/components/ui/link";
import { Sheet } from "@/components/ui/overlay";
import { ApiError, api, post } from "@/lib/api";
import { useAction } from "@/lib/providers";
import { useTable } from "@/lib/use-table";
import type { Paged } from "@/lib/types";
import { cn, dateTime, formatPhone, localPhone, money } from "@/lib/utils";
import { StepIcon } from "./settings";

type Check = { key: string; title: string; status: "ok" | "fail"; detail?: string; fix?: string };
type Destination = { channel: "mobile" | "bank"; recipient_name: string; recipient_phone: string; recipient_bank: string; recipient_account: string };
type Summary = {
  currency: string; min_amount: number; arrival_minutes: number; ready: boolean; balance: number | null; checks: Check[];
  earned: { total: number; count: number; subscriptions: number; content: number };
  withdrawn: { total: number; count: number; fees: number };
  pending: { total: number; count: number };
  since_last: { from: string | null; total: number; count: number };
  last_destination: Destination | null;
};
type Earning = { id: string; first_name: string; last_name: string; phone: string; item_title: string; order_type: string; type_label: string; amount: number; payment_provider: string; paid_at: string };
type Payout = Destination & { id: string; amount: number; fee: number; total: number; status: "pending" | "completed" | "failed" | "reversed"; status_label: string; snippe_reference: string; external_reference: string; failure_reason: string; narration: string; timeline: { at: string; event: string; detail: string }[]; requested_by_name: string; created_at: string; completed_at: string | null };

const SUMMARY = "/admin/withdrawals/summary/";
const PAYOUTS = "/admin/payouts/";
const EARNINGS = "/admin/withdrawals/earnings/";
const PAYOUT_TONE = { pending: "warning", completed: "success", failed: "danger", reversed: "neutral" } as const;
const BANKS = [["CRDB", "CRDB Bank"], ["NMB", "NMB Bank"], ["NBC", "NBC Bank"], ["ABSA", "Absa Bank"], ["STANBIC", "Stanbic Bank"], ["EXIM", "Exim Bank"], ["DTB", "Diamond Trust Bank"], ["EQUITY", "Equity Bank"], ["KCB", "KCB Bank"], ["AZANIA", "Azania Bank"]].map(([value, label]) => ({ value, label }));
const EVENTS: Record<string, string> = { requested: "Withdrawal requested", sent: "Accepted by Snippe", send_uncertain: "Waiting for Snippe to confirm", rejected: "Rejected by Snippe", completed: "Money arrived", failed: "Failed", reversed: "Reversed, money returned to balance" };
const destinationLabel = (p: Destination) => (p.channel === "mobile" ? formatPhone(p.recipient_phone) : `${p.recipient_bank} · ${p.recipient_account}`);
const TypeBadge = ({ type, label }: { type: string; label: string }) => <Badge tone={type === "subscription" ? "primary" : "info"}>{type === "subscription" ? "Subscription" : label === "Content purchase" ? "Lesson" : label}</Badge>;

export function Withdrawals() {
  const summary = useQuery({ queryKey: [SUMMARY], queryFn: () => api<Summary>(SUMMARY) });
  const [tab, setTab] = useState("earnings");
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<Payout | null>(null);
  const s = summary.data;
  const canWithdraw = !!s?.ready && (s.balance ?? 0) >= s.min_amount;
  return (
    <>
      <PageHeader title="Withdrawals" description="Move what you have earned from Snippe to your own phone or bank account."
        actions={<Button size="lg" disabled={!canWithdraw} onClick={() => setOpen(true)} data-testid="withdraw-open"><ArrowDownToLine />Withdraw funds</Button>} />
      {!s ? <div className="grid gap-3 md:grid-cols-4"><Skeleton className="h-36 md:col-span-2" /><Skeleton className="h-36" /><Skeleton className="h-36" /></div> : (
        <>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <Card className="relative overflow-hidden border-transparent bg-primary p-5 text-primary-fg md:col-span-2" >
              <span aria-hidden className="pointer-events-none absolute -right-10 -top-16 size-48 rounded-full bg-primary-fg/10 blur-2xl" />
              <div className="relative">
                <div className="flex items-center gap-2 text-[13px] font-medium opacity-85"><Wallet className="size-4" />Available to withdraw now</div>
                <div className="mt-2 text-[34px] font-semibold leading-none tracking-tight tabular-nums" data-testid="available">{s.balance == null ? "—" : money(s.balance)}</div>
                <p className="mt-2 text-[13px] opacity-85">{s.balance == null ? "Snippe could not be reached. See the checks below." : "Live from your Snippe balance. Money already withdrawn is not in this number."}</p>
                {s.since_last.count > 0 && <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-primary-fg/15 px-2.5 py-1 text-xs font-medium">+{money(s.since_last.total)} from {s.since_last.count} {s.since_last.count === 1 ? "payment" : "payments"} since {s.since_last.from ? "your last withdrawal" : "you started"}</p>}
              </div>
            </Card>
            <div data-testid="withdrawn"><StatCard label="Already withdrawn" icon={CheckCircle2} value={money(s.withdrawn.total)} hint={s.withdrawn.count ? `${s.withdrawn.count} ${s.withdrawn.count === 1 ? "withdrawal" : "withdrawals"} · ${money(s.withdrawn.fees)} in fees` : "Nothing withdrawn yet"} /></div>
            <div data-testid="pending"><StatCard label="On the way" icon={Clock3} tone={s.pending.count ? "warning" : undefined} value={money(s.pending.total)} hint={s.pending.count ? `Usually arrives within ${s.arrival_minutes} minutes` : "No withdrawal in progress"} /></div>
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <StatCard label="Total earned, all time" icon={Banknote} value={money(s.earned.total)} hint={`${s.earned.count} paid ${s.earned.count === 1 ? "order" : "orders"}`} />
            <StatCard label="From subscriptions" icon={CreditCard} value={money(s.earned.subscriptions)} />
            <StatCard label="From lesson purchases" icon={CreditCard} value={money(s.earned.content)} />
          </div>
          <Readiness s={s} />
        </>
      )}
      <div className="mt-6">
        <Tabs value={tab} onChange={setTab} items={[{ value: "earnings", label: "Who paid you" }, { value: "history", label: <span className="inline-flex items-center gap-1.5">Withdrawal history{!!s?.pending.count && <Badge tone="warning">{s.pending.count}</Badge>}</span> }]} />
        <div className="mt-4">{tab === "earnings" ? <Earnings /> : <History onOpen={setDetail} />}</div>
      </div>
      {open && s && <WithdrawSheet s={s} onClose={() => setOpen(false)} />}
      {detail && <PayoutDetail payout={detail} onClose={() => setDetail(null)} />}
    </>
  );
}

function Readiness({ s }: { s: Summary }) {
  const [expanded, setExpanded] = useState(!s.ready);
  return (
    <Card className={cn("mt-3 p-4", !s.ready && "border-warning/40")}>
      <button type="button" className="flex w-full items-center gap-3 text-left" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
        {s.ready ? <ShieldCheck className="size-5 shrink-0 text-success" /> : <TriangleAlert className="size-5 shrink-0 text-warning" />}
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">{s.ready ? "Snippe is ready for withdrawals" : "Snippe is not ready for withdrawals yet"}</span>
          <span className="block text-[13px] text-fg-2">{s.ready ? "How withdrawals work, and what Snippe checked." : "Fix the step below, then refresh this page."}</span>
        </span>
        <span className="text-[13px] font-medium text-primary-ink">{expanded ? "Hide" : "Show"}</span>
      </button>
      {expanded && (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <ol className="divide-y rounded-xl border" data-testid="payout-checks">
            {s.checks.map((c) => (
              <li key={c.key} className="flex gap-3 p-3" data-status={c.status}>
                <span className="mt-0.5 shrink-0"><StepIcon status={c.status} /></span>
                <div className="min-w-0"><div className="text-sm font-medium">{c.title}</div>{c.detail && <p className="text-[13px] text-fg-2">{c.detail}</p>}{c.fix && c.status !== "ok" && <p className="mt-0.5 text-[13px] font-medium text-warning">{c.fix}</p>}</div>
              </li>
            ))}
          </ol>
          <div className="rounded-xl bg-surface-2 p-4 text-[13px] text-fg-2">
            <div className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-fg"><Info className="size-4" />How a withdrawal works</div>
            <ol className="list-decimal space-y-1.5 pl-4">
              <li>Snippe quotes its withdrawal fee for the amount you choose. The fee comes out of your balance, on top of the amount.</li>
              <li>The smallest withdrawal is {money(s.min_amount)}. Mobile money goes to M-Pesa, Airtel Money, Mixx by Yas or HaloPesa; banks by account number.</li>
              <li>Funds usually arrive within {s.arrival_minutes} minutes. This page updates by itself when Snippe confirms.</li>
              <li>Your Snippe API key needs the <code className="rounded bg-surface px-1">disbursement:create</code> and <code className="rounded bg-surface px-1">disbursement:read</code> permissions.</li>
            </ol>
            {!s.ready && <Button asChild variant="secondary" size="sm" className="mt-3"><Link href="/admin/settings/payments">Open payment settings</Link></Button>}
          </div>
        </div>
      )}
    </Card>
  );
}

function Earnings() {
  const table = useTable<Earning>(EARNINGS);
  const columns: Column<Earning>[] = [
    { key: "who", header: "Customer", cell: (r) => <div className="flex min-w-0 items-center gap-2.5"><Avatar name={`${r.first_name} ${r.last_name}`} className="size-8 shrink-0" /><div className="min-w-0"><div className="truncate font-medium">{r.first_name} {r.last_name}</div><div className="truncate text-[13px] text-fg-3">{formatPhone(r.phone)}</div></div></div> },
    { key: "item", header: "Paid for", cell: (r) => <div className="min-w-0"><div className="truncate">{r.item_title}</div><div className="mt-0.5"><TypeBadge type={r.order_type} label={r.type_label} /></div></div> },
    { key: "amount", header: "Amount", sortable: true, cell: (r) => <span className="font-medium tabular-nums">{money(r.amount)}</span> },
    { key: "provider", header: "Network", mobile: false, cell: (r) => <span className="text-fg-2">{r.payment_provider || "—"}</span> },
    { key: "paid_at", header: "Paid", sortable: true, cell: (r) => <span className="whitespace-nowrap text-fg-2">{dateTime(r.paid_at)}</span> },
  ];
  return (
    <DataTable columns={columns} rows={table.rows} rowId={(r) => r.id} loading={table.query.isLoading} total={table.total} page={table.page} totalPages={table.totalPages} onPage={table.setPage}
      search={table.search} onSearch={table.setSearch} searchPlaceholder="Name, phone or lesson" ordering={table.ordering} onOrdering={table.setOrdering}
      filters={<>
        <Select label="Type" className="w-44" value={table.filters.order_type || "all"} onChange={(v) => table.setFilter("order_type", v === "all" ? "" : v)} options={[{ value: "all", label: "Everyone who paid" }, { value: "subscription", label: "Subscribers" }, { value: "content_purchase", label: "Lesson buyers" }]} />
        <Switch label="Since last withdrawal" checked={table.filters.since_last === "1"} onChange={(v) => table.setFilter("since_last", v ? "1" : "")} />
      </>}
      empty={{ icon: Banknote, title: "No payments yet", text: "Subscribers and lesson buyers appear here as soon as they pay." }} />
  );
}

function History({ onOpen }: { onOpen: (p: Payout) => void }) {
  const table = useTable<Payout>(PAYOUTS, {}, { refetchInterval: 15000 });
  const columns: Column<Payout>[] = [
    { key: "amount", header: "Amount", cell: (r) => <div><div className="font-medium tabular-nums">{money(r.amount)}</div><div className="text-[13px] text-fg-3">Fee {money(r.fee)}</div></div> },
    { key: "to", header: "To", cell: (r) => <div className="min-w-0"><div className="truncate">{r.recipient_name}</div><div className="flex items-center gap-1 truncate text-[13px] text-fg-3">{r.channel === "mobile" ? <Smartphone className="size-3.5" /> : <Landmark className="size-3.5" />}{destinationLabel(r)}</div></div> },
    { key: "status", header: "Status", cell: (r) => <Badge tone={PAYOUT_TONE[r.status]}>{r.status === "pending" && <Loader2 className="animate-spin" />}{r.status_label}</Badge> },
    { key: "created_at", header: "Requested", mobile: false, cell: (r) => <span className="whitespace-nowrap text-fg-2">{dateTime(r.created_at)}</span> },
  ];
  return <DataTable columns={columns} rows={table.rows} rowId={(r) => r.id} loading={table.query.isLoading} total={table.total} page={table.page} totalPages={table.totalPages} onPage={table.setPage} onRowClick={onOpen}
    empty={{ icon: Wallet, title: "No withdrawals yet", text: "When you withdraw, each one is listed here with its status." }} />;
}

function PayoutDetail({ payout, onClose }: { payout: Payout; onClose: () => void }) {
  const client = useQueryClient();
  const [p, setP] = useState(payout);
  const recheck = useAction(() => post<Payout & { gateway_status: string }>(`${PAYOUTS}${p.id}/recheck/`), { success: (r) => `Snippe says: ${r.gateway_status}`, onSuccess: (r) => { setP(r); client.invalidateQueries({ queryKey: [SUMMARY] }); client.invalidateQueries({ queryKey: [PAYOUTS] }); } });
  return (
    <Sheet open onOpenChange={(v) => !v && onClose()} title={`Withdrawal of ${money(p.amount)}`} footer={p.status === "pending" ? <Button variant="secondary" loading={recheck.isPending} onClick={() => recheck.mutate()}><RefreshCw />Check with Snippe</Button> : undefined}>
      <div className="space-y-4">
        <div className="flex items-center gap-2"><Badge tone={PAYOUT_TONE[p.status]}>{p.status_label}</Badge>{p.failure_reason && <span className="text-[13px] text-danger">{p.failure_reason}</span>}</div>
        <dl className="divide-y rounded-xl border text-sm">
          {[["You receive", money(p.amount)], ["Snippe fee", money(p.fee)], ["Taken from balance", money(p.total)], ["To", `${p.recipient_name} · ${destinationLabel(p)}`], ["Snippe reference", p.snippe_reference || "—"], ["Network reference", p.external_reference || "—"], ["Requested by", p.requested_by_name || "—"]].map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4 px-3 py-2.5"><dt className="text-fg-2">{k}</dt><dd className="text-right font-medium tabular-nums">{v}</dd></div>
          ))}
        </dl>
        <ol className="space-y-3 border-l pl-4">
          {p.timeline.map((t, i) => (
            <li key={i} className="relative"><span className="absolute -left-[21px] top-1.5 size-2.5 rounded-full bg-primary" aria-hidden /><div className="text-sm font-medium">{EVENTS[t.event] ?? t.event}</div><div className="text-[13px] text-fg-3">{dateTime(t.at)}{t.detail && ` · ${t.detail}`}</div></li>
          ))}
        </ol>
      </div>
    </Sheet>
  );
}

const STEPS = ["Review", "Amount", "Confirm"];
type Quote = { amount: number; fee: number; total: number };

function WithdrawSheet({ s, onClose }: { s: Summary; onClose: () => void }) {
  const client = useQueryClient();
  const [step, setStep] = useState(0);
  const [clientKey] = useState(() => crypto.randomUUID());
  const last = s.last_destination;
  const [amount, setAmount] = useState("");
  const [dest, setDest] = useState<Destination>({ channel: last?.channel ?? "mobile", recipient_name: last?.recipient_name ?? "", recipient_phone: last?.recipient_phone ? localPhone(last.recipient_phone) : "", recipient_bank: last?.recipient_bank ?? "CRDB", recipient_account: last?.recipient_account ?? "" });
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState<Payout | null>(null);
  const value = Number(amount.replace(/\D/g, "")) || 0;
  const debounced = useDebounced(value, 350);
  const balance = s.balance ?? 0;
  const quote = useQuery({ queryKey: ["payout-quote", debounced], queryFn: () => api<Quote>(`/admin/withdrawals/quote/?amount=${debounced}`), enabled: debounced >= s.min_amount, retry: false, staleTime: 60_000 });
  const q = quote.data && quote.data.amount === value ? quote.data : null;
  const over = !!q && q.total > balance;
  const tooSmall = value > 0 && value < s.min_amount;
  const destOk = dest.recipient_name.trim().length > 1 && (dest.channel === "mobile" ? dest.recipient_phone.replace(/\D/g, "").length >= 10 : !!dest.recipient_bank && dest.recipient_account.trim().length >= 5);
  const fillMax = async () => {
    try {
      const first = await api<Quote>(`/admin/withdrawals/quote/?amount=${balance}`);
      setAmount(String(Math.max(0, balance - first.fee)));
    } catch (e) { setErrors({ amount: (e as ApiError).message }); }
  };
  const submit = useAction(() => post<Payout>(PAYOUTS, { amount: value, ...dest, password, client_key: clientKey }), {
    onSuccess: (r) => { setDone(r); [SUMMARY, PAYOUTS, EARNINGS].forEach((k) => client.invalidateQueries({ queryKey: [k] })); },
    onError: (e) => setErrors(Object.keys(e.fields).length ? e.fields : { submit: e.message }),
  });

  if (done) {
    return (
      <Sheet open onOpenChange={(v) => !v && onClose()} title="Withdrawal sent" footer={<Button className="w-full md:w-auto" onClick={onClose}>Done</Button>}>
        <div className="py-2 text-center" data-testid="withdraw-done">
          <div className="relative mx-auto grid size-20 place-items-center">
            <span className="absolute inset-0 animate-[ring_1.6s_var(--ease)_infinite] rounded-full bg-success/25" aria-hidden />
            <span className="relative grid size-16 animate-[pop_.4s_var(--ease)] place-items-center rounded-full bg-success-soft text-success"><Clock3 className="size-8" /></span>
          </div>
          <h3 className="mt-4 text-xl font-semibold tracking-tight">Please wait about {s.arrival_minutes} minutes</h3>
          <p className="mx-auto mt-1.5 max-w-sm text-sm text-fg-2">{money(done.amount)} is on its way to {done.recipient_name} ({destinationLabel(done)}). Funds usually arrive within {s.arrival_minutes} minutes. You can close this window; the status updates in Withdrawal history.</p>
          <dl className="mx-auto mt-5 max-w-sm divide-y rounded-xl border text-left text-sm">
            <div className="flex justify-between px-3 py-2"><dt className="text-fg-2">Status</dt><dd><Badge tone={PAYOUT_TONE[done.status]}>{done.status_label}</Badge></dd></div>
            <div className="flex justify-between px-3 py-2"><dt className="text-fg-2">Taken from balance</dt><dd className="font-medium tabular-nums">{money(done.total)}</dd></div>
            {done.snippe_reference && <div className="flex justify-between px-3 py-2"><dt className="text-fg-2">Reference</dt><dd className="font-mono text-[13px]">{done.snippe_reference}</dd></div>}
          </dl>
        </div>
      </Sheet>
    );
  }

  const footer = (
    <div className="flex w-full items-center justify-between gap-2">
      {step > 0 ? <Button variant="ghost" onClick={() => setStep(step - 1)}><ArrowLeft />Back</Button> : <Button variant="ghost" onClick={onClose}>Cancel</Button>}
      {step === 0 && <Button onClick={() => setStep(1)}>Continue<ArrowRight /></Button>}
      {step === 1 && <Button disabled={!q || over || !destOk || quote.isFetching} onClick={() => setStep(2)}>Review withdrawal<ArrowRight /></Button>}
      {step === 2 && <Button loading={submit.isPending} disabled={!password} onClick={() => { setErrors({}); submit.mutate(); }} data-testid="withdraw-confirm"><ShieldCheck />Withdraw {money(q?.amount)}</Button>}
    </div>
  );
  return (
    <Sheet open onOpenChange={(v) => !v && !submit.isPending && onClose()} title="Withdraw funds" size="lg" dismissible={!submit.isPending} footer={footer}>
      <ol className="mb-5 flex items-center gap-2" aria-label="Steps">
        {STEPS.map((label, i) => (
          <li key={label} className="flex flex-1 items-center gap-2" aria-current={i === step ? "step" : undefined}>
            <span className={cn("grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold", i < step ? "bg-primary text-primary-fg" : i === step ? "bg-primary-soft text-primary-ink ring-2 ring-primary" : "bg-surface-2 text-fg-3")}>{i < step ? "✓" : i + 1}</span>
            <span className={cn("text-[13px] font-medium", i === step ? "text-fg" : "text-fg-3")}>{label}</span>
            {i < STEPS.length - 1 && <span className="h-px flex-1 bg-border" aria-hidden />}
          </li>
        ))}
      </ol>
      {step === 0 && <ReviewStep s={s} />}
      {step === 1 && (
        <div className="space-y-5">
          <div className="flex items-center justify-between rounded-xl bg-surface-2 px-4 py-3 text-sm"><span className="text-fg-2">Available in Snippe</span><span className="font-semibold tabular-nums">{money(balance)}</span></div>
          <Field label="Amount to receive (TZS)" error={errors.amount || (tooSmall ? `The smallest withdrawal is ${money(s.min_amount)}.` : over ? `Amount plus fee is ${money(q!.total)}, more than your balance.` : undefined)}>
            <div className="flex gap-2">
              <Input inputMode="numeric" autoFocus className="text-lg font-semibold tabular-nums" placeholder={String(s.min_amount)} value={value ? value.toLocaleString("en-US") : ""} onChange={(e) => { setErrors({}); setAmount(e.target.value); }} invalid={tooSmall || over} data-testid="withdraw-amount" />
              <Button variant="secondary" onClick={fillMax}>Max</Button>
            </div>
          </Field>
          <div className="rounded-xl border p-3 text-sm" aria-live="polite">
            {value < s.min_amount ? <p className="text-fg-3">Enter at least {money(s.min_amount)} to see Snippe&apos;s fee.</p>
              : quote.isError ? <p className="text-danger">{(quote.error as ApiError).message}</p>
              : !q ? <p className="flex items-center gap-2 text-fg-3"><Loader2 className="size-4 animate-spin" />Asking Snippe for the fee…</p>
              : <dl className="space-y-1.5">
                  <div className="flex justify-between"><dt className="text-fg-2">You receive</dt><dd className="font-medium tabular-nums">{money(q.amount)}</dd></div>
                  <div className="flex justify-between"><dt className="text-fg-2">Snippe fee</dt><dd className="tabular-nums">{money(q.fee)}</dd></div>
                  <div className="flex justify-between border-t pt-1.5"><dt className="font-medium">Taken from balance</dt><dd className={cn("font-semibold tabular-nums", over && "text-danger")}>{money(q.total)}</dd></div>
                </dl>}
          </div>
          <div>
            <div className="mb-1.5 text-[13px] font-medium">Send to</div>
            <div className="grid grid-cols-2 gap-2">
              {([["mobile", "Mobile money", Smartphone], ["bank", "Bank account", Landmark]] as const).map(([key, label, Icon]) => (
                <button key={key} type="button" aria-pressed={dest.channel === key} onClick={() => setDest({ ...dest, channel: key })} className={cn("flex items-center gap-2 rounded-xl border p-3 text-sm font-medium hover:bg-surface-2", dest.channel === key && "border-primary bg-primary-soft text-primary-ink hover:bg-primary-soft")}><Icon className="size-4" />{label}</button>
              ))}
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {dest.channel === "mobile" ? (
              <Field label="Phone number" error={errors.recipient_phone} hint="M-Pesa, Airtel Money, Mixx by Yas or HaloPesa"><PhoneInput value={dest.recipient_phone} onChange={(recipient_phone) => setDest({ ...dest, recipient_phone })} invalid={!!errors.recipient_phone} /></Field>
            ) : (
              <>
                <Field label="Bank"><Select value={dest.recipient_bank} onChange={(recipient_bank) => setDest({ ...dest, recipient_bank })} options={BANKS} /></Field>
                <Field label="Account number" error={errors.recipient_account}><Input inputMode="numeric" value={dest.recipient_account} onChange={(e) => setDest({ ...dest, recipient_account: e.target.value })} invalid={!!errors.recipient_account} /></Field>
              </>
            )}
            <Field label="Name on the account" error={errors.recipient_name} hint={dest.channel === "bank" ? "Must match the bank's records" : undefined} className={dest.channel === "bank" ? "md:col-span-2" : undefined}><Input value={dest.recipient_name} onChange={(e) => setDest({ ...dest, recipient_name: e.target.value })} invalid={!!errors.recipient_name} /></Field>
          </div>
          {last && <p className="text-[13px] text-fg-3">Filled in from your last withdrawal.</p>}
        </div>
      )}
      {step === 2 && q && (
        <div className="space-y-4">
          <div className="rounded-2xl border bg-surface-2/60 p-5 text-center">
            <div className="text-[13px] font-medium text-fg-2">You are withdrawing</div>
            <div className="mt-1 text-[34px] font-semibold leading-none tracking-tight tabular-nums">{money(q.amount)}</div>
            <div className="mt-2 inline-flex items-center gap-1.5 text-sm text-fg-2">{dest.channel === "mobile" ? <Smartphone className="size-4" /> : <Landmark className="size-4" />}to {dest.recipient_name} · {dest.channel === "mobile" ? dest.recipient_phone : `${dest.recipient_bank} ${dest.recipient_account}`}</div>
          </div>
          <dl className="divide-y rounded-xl border text-sm">
            {[["Snippe fee", money(q.fee)], ["Taken from balance", money(q.total)], ["Balance after", money(balance - q.total)], ["Expected arrival", `Within about ${s.arrival_minutes} minutes`]].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 px-3 py-2.5"><dt className="text-fg-2">{k}</dt><dd className="font-medium tabular-nums">{v}</dd></div>
            ))}
          </dl>
          <Field label="Your admin password" error={errors.password} hint="Needed for every withdrawal, so nobody else can move your money."><PasswordInput autoFocus autoComplete="current-password" value={password} onChange={(e) => { setPassword(e.target.value); setErrors({}); }} invalid={!!errors.password} data-testid="withdraw-password" /></Field>
          {errors.submit && <p role="alert" className="flex items-start gap-2 rounded-lg bg-danger-soft p-3 text-sm text-danger"><TriangleAlert className="mt-0.5 size-4 shrink-0" />{errors.submit}</p>}
          <p className="text-[13px] text-fg-3">Check the number carefully. Once Snippe sends the money it cannot be called back.</p>
        </div>
      )}
    </Sheet>
  );
}

function ReviewStep({ s }: { s: Summary }) {
  const query = useQuery({ queryKey: [EARNINGS, "since"], queryFn: () => api<Paged<Earning>>(`${EARNINGS}?since_last=1&page_size=50`) });
  const rows = query.data?.results ?? [];
  const totals = useMemo(() => rows.reduce((t, r) => ({ ...t, [r.order_type]: (t[r.order_type] ?? 0) + r.amount }), {} as Record<string, number>), [rows]);
  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-semibold tracking-tight">{s.since_last.from ? "Paid since your last withdrawal" : "Everyone who has paid you"}</h3>
        <p className="text-[13px] text-fg-2">{s.since_last.from ? `Since ${dateTime(s.since_last.from)}` : "You have not withdrawn before."} · {s.since_last.count} {s.since_last.count === 1 ? "payment" : "payments"}, {money(s.since_last.total)}</p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-xl bg-primary-soft p-3"><div className="text-xs font-medium text-primary-ink">Subscriptions</div><div className="mt-0.5 font-semibold tabular-nums">{money(totals.subscription ?? 0)}</div></div>
        <div className="rounded-xl bg-info-soft p-3"><div className="text-xs font-medium text-info">Lesson purchases</div><div className="mt-0.5 font-semibold tabular-nums">{money(totals.content_purchase ?? 0)}</div></div>
      </div>
      {query.isLoading ? <Skeleton className="h-48" /> : rows.length === 0 ? (
        <p className="rounded-xl border border-dashed p-6 text-center text-sm text-fg-3">No new payments since your last withdrawal. You can still withdraw what is left in Snippe.</p>
      ) : (
        <ul className="max-h-[42dvh] divide-y overflow-y-auto rounded-xl border" data-testid="withdraw-payers">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center gap-3 px-3 py-2.5">
              <Avatar name={`${r.first_name} ${r.last_name}`} className="size-8 shrink-0" />
              <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{r.first_name} {r.last_name} <span className="font-normal text-fg-3">· {formatPhone(r.phone)}</span></div><div className="flex items-center gap-1.5 truncate text-[13px] text-fg-3"><TypeBadge type={r.order_type} label={r.type_label} /><span className="truncate">{r.item_title}</span></div></div>
              <div className="text-right"><div className="text-sm font-medium tabular-nums">{money(r.amount)}</div><div className="text-xs text-fg-3">{dateTime(r.paid_at)}</div></div>
            </li>
          ))}
        </ul>
      )}
      {(query.data?.count ?? 0) > rows.length && <p className="text-[13px] text-fg-3">Showing the latest {rows.length} of {query.data!.count}. See all under “Who paid you”.</p>}
      <p className="flex items-start gap-2 rounded-lg bg-surface-2 p-3 text-[13px] text-fg-2"><Info className="mt-0.5 size-4 shrink-0" />You withdraw from your Snippe balance ({money(s.balance)}), which can differ slightly from these totals because Snippe keeps its collection fees.</p>
    </div>
  );
}
