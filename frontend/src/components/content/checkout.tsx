"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, Clock, KeyRound, Loader2, Smartphone } from "lucide-react";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Field, Input, PhoneInput } from "@/components/ui/form";
import { Link } from "@/components/ui/link";
import { Sheet } from "@/components/ui/overlay";
import { ApiError, api, post } from "@/lib/api";
import { useSession, useSite } from "@/lib/providers";
import type { Order } from "@/lib/types";
import { money, normalizePhone } from "@/lib/utils";

export type CheckoutItem = { type: "content"; id: string; title: string; price: number; slug: string } | { type: "plan"; id: string; title: string; price: number; days: number; slug?: string };
type Stage = "form" | "waiting" | "success" | "failed";
const STORE = "checkout";
const NETWORKS = ["M-Pesa", "Airtel Money", "Mixx by Yas", "Halotel"];
const PROMPT_SECONDS = 120;

const schema = z.object({
  phone: z.string().refine((v) => normalizePhone(v), "Enter a Tanzanian mobile number, like 0712 345 678"),
  first_name: z.string().trim().min(1, "Enter your first name").max(80),
  last_name: z.string().trim().min(1, "Enter your last name").max(80),
  email: z.string().trim().email("Enter a valid email").or(z.literal("")),
});
type Values = z.infer<typeof schema>;
type Claim = { account_created: boolean; username: string; content_slug: string | null; login_required: boolean };

const Ctx = createContext<{ open: (item: CheckoutItem) => void } | null>(null);
export const useCheckout = () => useContext(Ctx)!;

const save = (v: unknown) => { try { sessionStorage.setItem(STORE, JSON.stringify(v)); } catch {} };
const clear = () => { try { sessionStorage.removeItem(STORE); } catch {} };

function Form({ item, onCreated }: { item: CheckoutItem; onCreated: (o: Order) => void }) {
  const { user } = useSession();
  const site = useSite();
  const [busy, setBusy] = useState(false);
  const [key] = useState(() => crypto.randomUUID()); // one key per attempt: a double tap cannot pay twice
  const choose = site.payment_method === "let_customer_choose";
  const [method, setMethod] = useState(site.payment_method === "hosted_checkout" ? "hosted_checkout" : "ussd_push");
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { phone: user?.phone ? `0${user.phone.slice(3)}` : "", first_name: user?.first_name ?? "", last_name: user?.last_name ?? "", email: user?.email ?? "" } });
  const { errors } = form.formState;
  const submit = form.handleSubmit(async (v) => {
    if (busy) return;
    setBusy(true);
    try {
      const body = { ...v, phone: normalizePhone(v.phone), order_type: item.type === "plan" ? "subscription" : "content_purchase", [item.type === "plan" ? "plan" : "content"]: item.id, method };
      const order = await post<Order>("/checkout/", body, { "Idempotency-Key": key });
      onCreated(order);
    } catch (e) {
      const error = e as ApiError;
      Object.entries(error.fields).forEach(([name, message]) => form.setError(name as keyof Values, { message }));
      toast.error(error.message);
      setBusy(false);
    }
  });
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div className="flex items-center justify-between gap-3 rounded-xl bg-surface-2 p-3.5">
        <div className="min-w-0"><div className="truncate text-sm font-medium">{item.title}</div><div className="text-[13px] text-fg-2">{item.type === "plan" ? `${item.days} days of full access` : "One-time purchase"}</div></div>
        <div className="shrink-0 text-right font-semibold tabular-nums">{money(item.price)}</div>
      </div>
      <Field label="Mobile money number" error={errors.phone?.message} hint="We send a payment prompt to this phone">
        <Controller control={form.control} name="phone" render={({ field }) => <PhoneInput {...field} invalid={!!errors.phone} autoFocus={!user} name="phone" />} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="First name" error={errors.first_name?.message}><Input autoComplete="given-name" invalid={!!errors.first_name} {...form.register("first_name")} /></Field>
        <Field label="Last name" error={errors.last_name?.message}><Input autoComplete="family-name" invalid={!!errors.last_name} {...form.register("last_name")} /></Field>
      </div>
      <Field label="Email (optional)" error={errors.email?.message}><Input type="email" inputMode="email" autoComplete="email" invalid={!!errors.email} {...form.register("email")} /></Field>
      {choose && (
        <fieldset className="grid grid-cols-2 gap-2">
          <legend className="sr-only">Payment method</legend>
          {[["ussd_push", "Prompt on my phone"], ["hosted_checkout", "Secure payment page"]].map(([value, label]) => (
            <button key={value} type="button" aria-pressed={method === value} onClick={() => setMethod(value)} className={`h-11 rounded-lg border text-[13px] font-medium ${method === value ? "border-primary bg-primary-soft text-primary-ink" : "border-border-strong text-fg-2"}`}>{label}</button>
          ))}
        </fieldset>
      )}
      <Button type="submit" size="lg" className="w-full" loading={busy}>Pay {money(item.price)}</Button>
      <p className="text-center text-[13px] text-fg-3">{NETWORKS.join(" · ")}</p>
    </form>
  );
}

function PhoneArt() {
  return (
    <div className="relative mx-auto mb-5 grid size-28 place-items-center" aria-hidden>
      <span className="animate-ring absolute inset-2 rounded-full bg-primary/15" />
      <span className="animate-ring absolute inset-2 rounded-full bg-primary/15" style={{ animationDelay: "0.8s" }} />
      <div className="animate-buzz relative grid h-20 w-12 place-items-center rounded-xl border-2 border-primary bg-surface shadow-md"><Smartphone className="size-6 text-primary-ink" /></div>
    </div>
  );
}

function Waiting({ order, token, onDone, onCancel }: { order: Order; token: string; onDone: (o: Order) => void; onCancel: () => void }) {
  const site = useSite();
  const [left, setLeft] = useState(PROMPT_SECONDS);
  const status = useQuery({
    queryKey: ["order", order.id], refetchInterval: Math.max(site.poll_seconds, 2) * 1000, refetchIntervalInBackground: true, gcTime: 0,
    queryFn: () => api<Order>(`/orders/${order.id}/status/`),
  });
  useEffect(() => { if (status.data && status.data.status !== "pending") onDone(status.data); }, [status.data, onDone]);
  useEffect(() => { const t = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000); return () => clearInterval(t); }, []);
  const [resending, setResending] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const resend = async () => {
    setResending(true);
    try { await post(`/orders/${order.id}/resend/`, { claim_token: token }); toast.success("Prompt sent again"); setLeft(PROMPT_SECONDS); }
    catch (e) { toast.error((e as ApiError).message); } finally { setResending(false); }
  };
  const cancel = async () => {
    setCancelling(true);
    try { await post(`/orders/${order.id}/cancel/`, { claim_token: token }); } catch {}
    onCancel();
  };
  const mm = Math.floor(left / 60), ss = String(left % 60).padStart(2, "0");
  return (
    <div className="pt-2 text-center" data-testid="checkout-waiting">
      <PhoneArt />
      <h3 className="text-lg font-semibold tracking-tight">Check your phone</h3>
      <p className="mx-auto mt-1 max-w-xs text-sm text-fg-2">Enter your PIN on the prompt to approve {money(order.amount)}. Keep this screen open.</p>
      <div className="mt-4 flex flex-wrap justify-center gap-1.5">{NETWORKS.map((n) => <span key={n} className="rounded-full border px-2.5 py-1 text-xs font-medium text-fg-2">{n}</span>)}</div>
      <div className="mt-5 inline-flex items-center gap-1.5 text-sm tabular-nums text-fg-2" role="timer"><Clock className="size-4" aria-hidden />{left ? `Waiting for you · ${mm}:${ss}` : "No prompt yet? Send it again."}</div>
      <div className="mt-5 grid grid-cols-2 gap-2">
        <Button variant="secondary" onClick={cancel} loading={cancelling}>Cancel</Button>
        <Button variant={left ? "soft" : "primary"} onClick={resend} loading={resending} disabled={left > PROMPT_SECONDS - 20}>Resend prompt</Button>
      </div>
    </div>
  );
}

function Success({ claim, onClose, order }: { claim: Claim; onClose: () => void; order: Order }) {
  if (claim.login_required) {
    return (
      <Done title="Payment received">
        <p className="text-sm text-fg-2">This number belongs to a staff account, so please log in with your password to continue.</p>
        <Button asChild size="lg" className="mt-5 w-full"><Link href="/login">Log in</Link></Button>
      </Done>
    );
  }
  return (
    <Done title="You are in" subtitle={`${order.item_title} is unlocked.`}>
      {claim.account_created && (
        <div className="mt-1 rounded-xl border bg-surface-2 p-3.5 text-left text-sm">
          <div className="mb-1 flex items-center gap-2 font-medium"><KeyRound className="size-4 text-primary-ink" aria-hidden />Your account was created</div>
          <p className="text-fg-2">Username: <strong className="font-semibold text-fg tabular-nums">{claim.username}</strong></p>
          <p className="text-fg-2">Your password is your phone number. Please change it.</p>
          <Button asChild variant="secondary" className="mt-3 w-full"><Link href="/change-password" onClick={onClose}>Change password now</Link></Button>
        </div>
      )}
      <Button size="lg" className="mt-4 w-full" onClick={onClose}>{claim.content_slug ? "Start learning" : "Go to my library"}</Button>
    </Done>
  );
}
function Done({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="pt-2 text-center" data-testid="checkout-success">
      <div className="animate-pop mx-auto mb-4 grid size-16 place-items-center rounded-full bg-success-soft text-success"><CheckCircle2 className="size-9" aria-hidden /></div>
      <h3 className="text-xl font-semibold tracking-tight">{title}</h3>
      {subtitle && <p className="mb-4 mt-1 text-sm text-fg-2">{subtitle}</p>}
      {children}
    </div>
  );
}
const FAIL_COPY: Record<string, [string, string]> = {
  failed: ["The payment did not go through", "It was declined or timed out. You were not charged."],
  expired: ["The prompt expired", "We did not get an approval in time. You were not charged."],
  voided: ["The payment was cancelled", "You were not charged."],
  cancelled: ["Payment cancelled", "You cancelled this payment. If you already approved it, it will still unlock."],
};
function Failed({ order, onRetry, onClose }: { order: Order; onRetry: () => void; onClose: () => void }) {
  const [title, text] = FAIL_COPY[order.status] ?? FAIL_COPY.failed;
  return (
    <div className="pt-2 text-center" data-testid="checkout-failed">
      <div className="mx-auto mb-4 grid size-16 place-items-center rounded-full bg-danger-soft text-danger"><AlertCircle className="size-8" aria-hidden /></div>
      <h3 className="text-lg font-semibold tracking-tight">{title}</h3>
      <p className="mx-auto mt-1 max-w-xs text-sm text-fg-2">{order.failure_reason || text}</p>
      <div className="mt-5 grid grid-cols-2 gap-2"><Button variant="secondary" onClick={onClose}>Close</Button><Button onClick={onRetry}>Try again</Button></div>
    </div>
  );
}

const TITLES: Record<Stage, string> = { form: "Complete your payment", waiting: "Approve on your phone", success: "Payment successful", failed: "Payment not completed" };

export function CheckoutProvider({ children }: { children: ReactNode }) {
  const [item, setItem] = useState<CheckoutItem | null>(null);
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<Stage>("form");
  const [order, setOrder] = useState<Order | null>(null);
  const [claim, setClaim] = useState<Claim | null>(null);
  const token = useRef("");
  const client = useQueryClient();
  const router = useRouter();

  const finish = useCallback(async (done: Order) => {
    setOrder(done);
    if (done.status !== "completed") { clear(); setStage("failed"); return; }
    try {
      const result = await post<Claim>(`/orders/${done.id}/claim/`, { claim_token: token.current });
      setClaim(result);
      await client.invalidateQueries();
      setStage("success");
    } catch (e) {
      const error = e as ApiError;
      toast.error(error.code === "claim_expired" ? "Payment received. Please log in to continue." : error.message);
      setClaim({ account_created: false, username: "", content_slug: done.content_slug, login_required: true });
      setStage("success");
    }
    clear();
  }, [client]);

  const created = useCallback((o: Order) => {
    token.current = o.claim_token ?? "";
    save({ order: o, token: token.current, item });
    setOrder(o);
    if (o.method === "hosted_checkout" && o.checkout_url) { location.href = o.checkout_url; return; }
    setStage("waiting");
  }, [item]);

  // A reload, or coming back from hosted checkout, resumes the same order.
  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(STORE) ?? "null");
      if (saved?.order) { token.current = saved.token; setItem(saved.item); setOrder(saved.order); setStage("waiting"); setOpen(true); }
    } catch {}
  }, []);

  const start = useCallback((next: CheckoutItem) => { setItem(next); setOrder(null); setClaim(null); setStage("form"); setOpen(true); }, []);
  const close = () => {
    setOpen(false);
    if (stage === "success" && claim && !claim.login_required) {
      router.push(claim.content_slug ? `/content/${claim.content_slug}` : "/library");
      router.refresh();
    }
  };
  const value = useMemo(() => ({ open: start }), [start]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <Sheet open={open} onOpenChange={(v) => { if (!v) close(); }} title={TITLES[stage]} dismissible={stage !== "waiting"} size="sm">
        {item && stage === "form" && <Form key={item.id} item={item} onCreated={created} />}
        {order && stage === "waiting" && <Waiting order={order} token={token.current} onDone={finish} onCancel={() => { clear(); setOrder({ ...order, status: "cancelled" }); setStage("failed"); }} />}
        {order && claim && stage === "success" && <Success claim={claim} order={order} onClose={close} />}
        {order && stage === "failed" && item && <Failed order={order} onRetry={() => start(item)} onClose={() => setOpen(false)} />}
      </Sheet>
    </Ctx.Provider>
  );
}
export { Loader2 };
