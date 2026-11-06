"use client";
import { Check, ChevronDown } from "lucide-react";
import { useCheckout } from "@/components/content/checkout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/display";
import { useSite } from "@/lib/providers";
import { cn, money } from "@/lib/utils";

export function PricingClient() {
  const site = useSite();
  const { open } = useCheckout();
  return (
    <div className="pb-tabbar mx-auto max-w-5xl px-4 pt-8 md:px-6 md:pt-14">
      <div className="mx-auto max-w-xl text-center">
        <h1 className="font-serif text-[32px] font-semibold leading-tight tracking-tight md:text-[44px]">Learn everything, for one simple price</h1>
        <p className="mt-2 text-fg-2">Pay with mobile money. Nothing renews by itself.</p>
      </div>
      <div className="mt-8 grid gap-4 md:mt-12 md:grid-cols-3">
        {site.plans.map((p) => (
          <div key={p.id} className={cn("relative flex flex-col rounded-2xl border bg-surface p-5 shadow-sm", p.highlighted && "border-primary shadow-md ring-1 ring-primary")}>
            {p.highlighted && <Badge tone="primary" className="absolute right-4 top-4">Best value</Badge>}
            <h2 className="font-semibold tracking-tight">{p.name}</h2>
            <p className="mt-0.5 text-sm text-fg-2">{p.description}</p>
            <div className="mt-4"><span className="text-3xl font-semibold tracking-tight tabular-nums">{money(p.effective_price)}</span>{p.promo_price && <s className="ml-2 text-sm text-fg-3">{money(p.price)}</s>}</div>
            <div className="text-[13px] text-fg-3">for {p.duration_days} days</div>
            <ul className="my-5 flex-1 space-y-2 text-sm">{p.features.map((f) => <li key={f} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />{f}</li>)}</ul>
            <Button size="lg" variant={p.highlighted ? "primary" : "secondary"} disabled={!site.checkout_available} onClick={() => open({ type: "plan", id: p.id, title: `${p.name} subscription`, price: p.effective_price, days: p.duration_days })}>
              {site.checkout_available ? `Choose ${p.name}` : "Payments temporarily unavailable"}
            </Button>
          </div>
        ))}
      </div>
      {site.faq.length > 0 && (
        <section className="mx-auto mt-14 max-w-2xl">
          <h2 className="mb-3 text-xl font-semibold tracking-tight">Questions</h2>
          <div className="divide-y rounded-xl border bg-surface">
            {site.faq.map((f) => (
              <details key={f.q} className="group px-4">
                <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 py-2 text-sm font-medium">{f.q}<ChevronDown className="size-4 shrink-0 text-fg-3 transition-transform group-open:rotate-180" aria-hidden /></summary>
                <p className="pb-3.5 text-sm text-fg-2">{f.a}</p>
              </details>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
