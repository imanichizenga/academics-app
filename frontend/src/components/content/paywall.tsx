"use client";
import { useQuery } from "@tanstack/react-query";
import { Lock, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { useSession, useSite } from "@/lib/providers";
import type { Detail } from "@/lib/types";
import { money } from "@/lib/utils";
import { useCheckout } from "./checkout";

export function useMyAccess() {
  const { user } = useSession();
  return useQuery({ queryKey: ["access"], enabled: !!user, queryFn: () => api<{ has_subscription: boolean; subscription_expired: boolean; subscription_expires_at: string | null; entitlements: any[] }>("/access/mine/") });
}

export function Paywall({ content, compact }: { content: Pick<Detail, "id" | "slug" | "title" | "effective_price" | "included_in_subscription" | "access_duration_days" | "price">; compact?: boolean }) {
  const site = useSite();
  const { open } = useCheckout();
  const access = useMyAccess();
  const plan = site.plans.find((p) => p.highlighted) ?? site.plans[0];
  const monthly = site.plans.find((p) => p.duration_days === 30) ?? plan;
  const expired = access.data?.subscription_expired;
  return (
    <div data-testid="paywall" className="rounded-2xl border bg-surface p-5 text-center shadow-md">
      <div className="mx-auto mb-3 grid size-11 place-items-center rounded-xl bg-primary-soft text-primary-ink">{expired ? <RefreshCw className="size-5" /> : <Lock className="size-5" />}</div>
      <h2 className="text-lg font-semibold tracking-tight">{expired ? "Your subscription has ended" : "Unlock the full lesson"}</h2>
      {!compact && <p className="mx-auto mt-1 max-w-sm text-sm text-fg-2">{expired ? "Renew to pick up where you left off." : "Pay once for this lesson, or subscribe for everything."}</p>}
      {!site.checkout_available ? (
        <Button size="lg" variant="secondary" disabled className="mt-4 w-full">Payments temporarily unavailable</Button>
      ) : (
        <div className="mx-auto mt-4 grid max-w-sm gap-2">
          {content.effective_price != null && !expired && (
            <Button size="lg" onClick={() => open({ type: "content", id: content.id, title: content.title, price: content.effective_price!, slug: content.slug })}>
              Buy this content — {money(content.effective_price)}
            </Button>
          )}
          {content.included_in_subscription && monthly && (
            <Button size="lg" variant={content.effective_price != null && !expired ? "secondary" : "primary"} onClick={() => open({ type: "plan", id: monthly.id, title: `${monthly.name} subscription`, price: monthly.effective_price, days: monthly.duration_days })}>
              {expired ? "Renew" : "Subscribe"} — {money(monthly.effective_price)} / {monthly.duration_days === 30 ? "month" : `${monthly.duration_days} days`}
            </Button>
          )}
        </div>
      )}
      {content.access_duration_days && content.effective_price != null ? <p className="mt-3 text-[13px] text-fg-3">Purchase gives {content.access_duration_days} days of access.</p> : null}
    </div>
  );
}
