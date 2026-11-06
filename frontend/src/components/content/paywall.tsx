"use client";
import { useQuery } from "@tanstack/react-query";
import { Lock, RefreshCw } from "lucide-react";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Link } from "@/components/ui/link";
import { api } from "@/lib/api";
import { useSession, useSite, useT } from "@/lib/providers";
import type { Detail } from "@/lib/types";
import { money } from "@/lib/utils";
import { defaultPlan, useCheckout } from "./checkout";

export function useMyAccess() {
  const { user } = useSession();
  return useQuery({ queryKey: ["access"], enabled: !!user, queryFn: () => api<{ has_subscription: boolean; subscription_expired: boolean; subscription_expires_at: string | null; entitlements: any[] }>("/access/mine/") });
}

export function AlreadyPaid({ next }: { next: string }) {
  const { user, loading } = useSession();
  const { t } = useT();
  if (user || loading) return null;
  return <Link href={`/login?next=${encodeURIComponent(next)}`} className="mt-3 inline-flex min-h-9 items-center text-sm font-medium text-primary-ink">{t.paywall.already}</Link>;
}

export function Paywall({ content, compact }: { content: Pick<Detail, "id" | "slug" | "title" | "effective_price" | "included_in_subscription" | "access_duration_days" | "price">; compact?: boolean }) {
  const site = useSite();
  const { t } = useT();
  const { open } = useCheckout();
  const access = useMyAccess();
  const path = usePathname();
  const plan = content.included_in_subscription ? defaultPlan(site.plans) : undefined;
  const expired = !!access.data?.subscription_expired;
  const price = content.effective_price;
  const buy = () => open({ type: "content", id: content.id, title: content.title, price: price!, slug: content.slug });
  const subscribe = () => open({ type: "plan", id: plan!.id, title: t.pricing.planTitle(plan!.name), price: plan!.effective_price, days: plan!.duration_days });
  const period = plan?.duration_days === 30 ? t.paywall.month : t.paywall.days(plan?.duration_days ?? 0);
  const renewing = expired && !!plan;
  const title = renewing ? t.paywall.ended : price == null ? t.paywall.subscribersOnly : t.paywall.unlock;
  const text = renewing ? t.paywall.endedText : price == null ? t.paywall.subscribersText : t.paywall.unlockText;
  return (
    <div id="paywall" data-testid="paywall" className="scroll-mt-24 rounded-2xl border bg-surface p-5 text-center shadow-md">
      <div className="mx-auto mb-3 grid size-11 place-items-center rounded-xl bg-primary-soft text-primary-ink">{renewing ? <RefreshCw className="size-5" aria-hidden /> : <Lock className="size-5" aria-hidden />}</div>
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      {!compact && <p className="mx-auto mt-1 max-w-sm text-sm text-fg-2">{text}</p>}
      {!site.checkout_available ? (
        <Button size="lg" variant="secondary" disabled className="mt-4 w-full">{t.paywall.unavailable}</Button>
      ) : (
        <div className="mx-auto mt-4 grid max-w-sm gap-2">
          {renewing && <Button size="lg" onClick={subscribe}>{t.paywall.renew}</Button>}
          {price != null && <Button size="lg" variant={renewing ? "secondary" : "primary"} className="h-auto min-h-12 whitespace-normal py-2" onClick={buy}>{renewing ? t.paywall.buyOnly(money(price)) : t.paywall.buy(money(price))}</Button>}
          {!renewing && plan && <Button size="lg" variant={price != null ? "secondary" : "primary"} className="h-auto min-h-12 whitespace-normal py-2" onClick={subscribe}>{t.paywall.subscribe(money(plan.effective_price), period)}</Button>}
          {renewing && site.plans.length > 1 && <Link href="/pricing" className="inline-flex min-h-9 items-center justify-center text-sm font-medium text-primary-ink">{t.paywall.compare}</Link>}
        </div>
      )}
      <AlreadyPaid next={path} />
      {content.access_duration_days && price != null ? <p className="mt-3 text-[13px] text-fg-3">{t.paywall.grants(content.access_duration_days)}</p> : null}
    </div>
  );
}
