"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, Clock, KeyRound, Loader2, Receipt, Smartphone } from "lucide-react";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Field, Input, PhoneInput } from "@/components/ui/form";
import { Link } from "@/components/ui/link";
import { Sheet } from "@/components/ui/overlay";
import { ApiError, api, post } from "@/lib/api";
import { useSession, useSite, useT } from "@/lib/providers";
import type { Dict } from "@/lib/i18n";
import type { Order, Plan } from "@/lib/types";
import { formatPhone, localPhone, money, normalizePhone } from "@/lib/utils";

export type CheckoutItem = { type: "content"; id: string; title: string; price: number; slug: string } | { type: "plan"; id: string; title: string; price: number; days: number; slug?: string };
type Stage = "form" | "waiting" | "success" | "failed";
const STORE = "checkout";
const NETWORKS = ["M-Pesa", "Airtel Money", "Mixx by Yas", "Halotel"];
const PROMPT_SECONDS = 120;

const makeSchema = (t: Dict) => z.object({
  phone: z.string().refine((v) => normalizePhone(v), t.checkout.enterPhone),
  first_name: z.string().trim().min(1, t.checkout.enterFirst).max(80),
  last_name: z.string().trim().min(1, t.checkout.enterLast).max(80),
  email: z.string().trim().email(t.common.validEmail).or(z.literal("")),
});
type Values = z.infer<ReturnType<typeof makeSchema>>;
/** The plan a single "subscribe" button offers: monthly if there is one, otherwise the highlighted one. */
export const defaultPlan = (plans: Plan[]) => plans.find((p) => p.duration_days === 30) ?? plans.find((p) => p.highlighted) ?? plans[0];
type Claim = { account_created: boolean; username: string; content_slug: string | null; login_required: boolean };

const Ctx = createContext<{ open: (item: CheckoutItem) => void } | null>(null);
export const useCheckout = () => useContext(Ctx)!;

const save = (v: unknown) => { try { sessionStorage.setItem(STORE, JSON.stringify(v)); } catch {} };
const clear = () => { try { sessionStorage.removeItem(STORE); } catch {} };

function Form({ item, onCreated }: { item: CheckoutItem; onCreated: (o: Order) => void }) {
  const { user } = useSession();
  const site = useSite();
  const { t, lang } = useT();
  const [busy, setBusy] = useState(false);
  const [key] = useState(() => crypto.randomUUID()); // one key per attempt: a double tap cannot pay twice
  const choose = site.payment_method === "let_customer_choose";
  const [method, setMethod] = useState(site.payment_method === "hosted_checkout" ? "hosted_checkout" : "ussd_push");
  const form = useForm<Values>({ resolver: zodResolver(makeSchema(t)), defaultValues: { phone: formatPhone(user?.phone), first_name: user?.first_name ?? "", last_name: user?.last_name ?? "", email: user?.email ?? "" } });
  const { errors } = form.formState;
  const submit = form.handleSubmit(async (v) => {
    if (busy) return;
    setBusy(true);
    try {
      const body = { ...v, phone: normalizePhone(v.phone), order_type: item.type === "plan" ? "subscription" : "content_purchase", [item.type === "plan" ? "plan" : "content"]: item.id, method, language: lang };
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
        <div className="min-w-0"><div className="truncate text-sm font-medium">{item.title}</div><div className="text-[13px] text-fg-2">{item.type === "plan" ? t.checkout.days(item.days) : t.checkout.once}</div></div>
        <div className="shrink-0 text-right font-semibold tabular-nums">{money(item.price)}</div>
      </div>
      <Field label={t.checkout.number} error={errors.phone?.message} hint={t.checkout.promptHint}>
        <Controller control={form.control} name="phone" render={({ field }) => <PhoneInput {...field} invalid={!!errors.phone} autoFocus={!user} name="phone" />} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t.common.firstName} error={errors.first_name?.message}><Input autoComplete="given-name" invalid={!!errors.first_name} {...form.register("first_name")} /></Field>
        <Field label={t.common.lastName} error={errors.last_name?.message}><Input autoComplete="family-name" invalid={!!errors.last_name} {...form.register("last_name")} /></Field>
      </div>
      <Field label={t.checkout.emailOptional} error={errors.email?.message}><Input type="email" inputMode="email" autoComplete="email" invalid={!!errors.email} {...form.register("email")} /></Field>
      {choose && (
        <fieldset className="grid grid-cols-2 gap-2">
          <legend className="sr-only">{t.checkout.method}</legend>
          {[["ussd_push", t.checkout.methodPush], ["hosted_checkout", t.checkout.methodPage]].map(([value, label]) => (
            <button key={value} type="button" aria-pressed={method === value} onClick={() => setMethod(value)} className={`h-11 rounded-lg border text-[13px] font-medium ${method === value ? "border-primary bg-primary-soft text-primary-ink" : "border-border-strong text-fg-2"}`}>{label}</button>
          ))}
        </fieldset>
      )}
      <Button type="submit" size="lg" className="w-full" loading={busy}>{t.checkout.pay(money(item.price))}</Button>
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
  const { t } = useT();
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
    try { await post(`/orders/${order.id}/resend/`, { claim_token: token }); toast.success(t.checkout.resent); setLeft(PROMPT_SECONDS); }
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
      <h3 className="text-lg font-semibold tracking-tight">{t.checkout.check}</h3>
      <p className="mx-auto mt-1 max-w-xs text-sm text-fg-2">{t.checkout.enterPin(money(order.amount))}</p>
      <div className="mt-4 flex flex-wrap justify-center gap-1.5">{NETWORKS.map((n) => <span key={n} className="rounded-full border px-2.5 py-1 text-xs font-medium text-fg-2">{n}</span>)}</div>
      <div className="mt-5 inline-flex items-center gap-1.5 text-sm tabular-nums text-fg-2" role="timer"><Clock className="size-4" aria-hidden />{left ? t.checkout.waiting(`${mm}:${ss}`) : t.checkout.noPrompt}</div>
      <div className="mt-5 grid grid-cols-2 gap-2">
        <Button variant="secondary" onClick={cancel} loading={cancelling}>{t.common.cancel}</Button>
        <Button variant={left ? "soft" : "primary"} onClick={resend} loading={resending} disabled={left > PROMPT_SECONDS - 20}>{t.checkout.resend}</Button>
      </div>
    </div>
  );
}

function Success({ claim, onClose, onLeave, order }: { claim: Claim; onClose: () => void; onLeave: () => void; order: Order }) {
  const { t } = useT();
  if (claim.login_required) {
    return (
      <Done title={t.checkout.staffTitle}>
        <p className="text-sm text-fg-2">{t.checkout.staffText}</p>
        <Button asChild size="lg" className="mt-5 w-full"><Link href="/login">{t.common.logIn}</Link></Button>
      </Done>
    );
  }
  const password = localPhone(claim.username);
  return (
    <Done title={t.checkout.inTitle} subtitle={t.checkout.unlocked(order.item_title)}>
      {claim.account_created && (
        <div className="mt-1 rounded-xl border bg-surface-2 p-3.5 text-left text-sm" data-testid="credentials">
          <div className="mb-2 flex items-center gap-2 font-medium"><KeyRound className="size-4 text-primary-ink" aria-hidden />{t.checkout.created}</div>
          <div className="flex items-center justify-between gap-2">
            <p className="min-w-0 text-fg-2">
              <span className="block">{t.checkout.phoneLine}: <strong className="font-semibold tabular-nums text-fg">{formatPhone(claim.username)}</strong></span>
              <span className="block">{t.checkout.passwordLine}: <strong className="font-semibold tabular-nums text-fg">{password}</strong> {t.checkout.yourNumber}</span>
            </p>
            <CopyButton text={password} label={t.banner.copyPassword} className="shrink-0" />
          </div>
          <Button asChild variant="secondary" className="mt-3 w-full"><Link href="/change-password" onClick={onLeave}>{t.checkout.changeNow}</Link></Button>
        </div>
      )}
      <Button size="lg" className="mt-4 w-full" onClick={onClose}>{claim.content_slug ? t.checkout.startLearning : t.checkout.goLibrary}</Button>
      <Button asChild variant="ghost" className="mt-2 w-full"><Link href={`/library/receipts/${order.id}`} onClick={onLeave}><Receipt />{t.checkout.viewReceipt}</Link></Button>
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
function Failed({ order, onRetry, onClose }: { order: Order; onRetry: () => void; onClose: () => void }) {
  const { t } = useT();
  const copy = { failed: t.checkout.failed, expired: t.checkout.expired, voided: t.checkout.voided, cancelled: t.checkout.cancelled };
  const [title, text] = copy[order.status as keyof typeof copy] ?? t.checkout.failed;
  return (
    <div className="pt-2 text-center" data-testid="checkout-failed">
      <div className="mx-auto mb-4 grid size-16 place-items-center rounded-full bg-danger-soft text-danger"><AlertCircle className="size-8" aria-hidden /></div>
      <h3 className="text-lg font-semibold tracking-tight">{title}</h3>
      <p className="mx-auto mt-1 max-w-xs text-sm text-fg-2">{order.failure_reason || text}</p>
      <div className="mt-5 grid grid-cols-2 gap-2"><Button variant="secondary" onClick={onClose}>{t.common.close}</Button><Button onClick={onRetry}>{t.common.tryAgain}</Button></div>
    </div>
  );
}

export function CheckoutProvider({ children }: { children: ReactNode }) {
  const [item, setItem] = useState<CheckoutItem | null>(null);
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<Stage>("form");
  const [order, setOrder] = useState<Order | null>(null);
  const [claim, setClaim] = useState<Claim | null>(null);
  const token = useRef("");
  const client = useQueryClient();
  const router = useRouter();
  const { t } = useT();
  const titles: Record<Stage, string> = { form: t.checkout.complete, waiting: t.checkout.approve, success: t.checkout.successful, failed: t.checkout.notCompleted };

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
      toast.error(error.code === "claim_expired" ? t.checkout.claimExpired : error.message);
      setClaim({ account_created: false, username: "", content_slug: done.content_slug, login_required: true });
      setStage("success");
    }
    clear();
  }, [client, t]);

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
      <Sheet open={open} onOpenChange={(v) => { if (!v) close(); }} title={titles[stage]} dismissible={stage !== "waiting"} size="sm">
        {item && stage === "form" && <Form key={item.id} item={item} onCreated={created} />}
        {order && stage === "waiting" && <Waiting order={order} token={token.current} onDone={finish} onCancel={() => { clear(); setOrder({ ...order, status: "cancelled" }); setStage("failed"); }} />}
        {order && claim && stage === "success" && <Success claim={claim} order={order} onClose={close} onLeave={() => setOpen(false)} />}
        {order && stage === "failed" && item && <Failed order={order} onRetry={() => start(item)} onClose={() => setOpen(false)} />}
      </Sheet>
    </Ctx.Provider>
  );
}
export { Loader2 };
