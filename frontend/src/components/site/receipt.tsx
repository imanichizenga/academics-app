"use client";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, Printer, Receipt as ReceiptIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { LogoMark } from "@/components/ui/app-loader";
import { Button } from "@/components/ui/button";
import { EmptyState, Skeleton } from "@/components/ui/display";
import { Link } from "@/components/ui/link";
import { api } from "@/lib/api";
import { useSession, useT } from "@/lib/providers";
import type { Receipt } from "@/lib/types";
import { dateLabel, money } from "@/lib/utils";

const PROVIDERS: Record<string, string> = { mpesa: "M-Pesa", airtel: "Airtel Money", airtelmoney: "Airtel Money", mixx: "Mixx by Yas", tigopesa: "Mixx by Yas", halotel: "Halotel", halopesa: "Halotel" };

export function ReceiptView({ id }: { id: string }) {
  const { user, loading } = useSession();
  const { t, lang } = useT();
  const router = useRouter();
  useEffect(() => { if (!loading && !user) router.replace(`/login?next=${encodeURIComponent(`/library/receipts/${id}`)}`); }, [loading, user, router, id]);
  const { data, isLoading } = useQuery({ queryKey: ["receipt", id], enabled: !!user, retry: false, queryFn: () => api<Receipt>(`/orders/${id}/receipt/`) });
  if (!user || isLoading) return <div className="mx-auto max-w-xl px-4 pt-8"><Skeleton className="h-[28rem]" /></div>;
  const back = <Button asChild variant="secondary"><Link href="/library"><ArrowLeft />{t.receipt.back}</Link></Button>;
  if (!data) return <div className="mx-auto max-w-md px-4 pt-16"><EmptyState icon={ReceiptIcon} title={t.receipt.notFound} text={t.receipt.notFoundText} action={back} /></div>;
  const channel = PROVIDERS[data.payment_provider.toLowerCase()] ?? data.payment_provider;
  const rows: [string, string][] = [
    [t.receipt.number, data.number], [t.receipt.date, dateLabel(data.paid_at, lang)],
    [t.receipt.customer, data.customer_name], [t.receipt.phone, data.phone_masked],
    [t.receipt.channel, [t.receipt.mobileMoney, channel].filter(Boolean).join(" · ")], [t.receipt.reference, data.external_reference || "—"],
  ];
  return (
    <div className="pb-tabbar mx-auto max-w-xl px-4 pt-5 md:pt-10">
      <section data-testid="receipt" className="print-sheet rounded-2xl border bg-surface p-5 shadow-sm md:p-8">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5 font-semibold tracking-tight"><LogoMark logo={data.logo_url} className="size-9 shrink-0" /><span className="truncate">{data.site_name}</span></div>
          <h1 className="shrink-0 text-lg font-semibold tracking-tight text-fg-2">{t.receipt.title}</h1>
        </div>
        <div className="mt-6 border-y py-5 text-center">
          <CheckCircle2 className="mx-auto mb-1.5 size-7 text-success" aria-hidden />
          <div className="text-[13px] font-medium text-fg-3">{t.receipt.amount}</div>
          <div className="text-3xl font-semibold tracking-tight tabular-nums">{money(data.amount, data.currency)}</div>
          <div className="mt-1 text-sm text-fg-2">{data.order_type === "subscription" ? t.receipt.subscription : t.receipt.lesson}: {data.item_title}</div>
        </div>
        <dl className="mt-3 divide-y text-sm">
          {rows.map(([label, value]) => <div key={label} className="flex justify-between gap-4 py-2.5"><dt className="shrink-0 text-fg-3">{label}</dt><dd className="min-w-0 break-words text-right font-medium tabular-nums">{value}</dd></div>)}
        </dl>
        <p className="mt-5 text-center text-[13px] text-fg-3">{t.receipt.thanks}</p>
      </section>
      <div className="no-print mt-4 flex flex-wrap justify-between gap-2">{back}<Button onClick={() => window.print()}><Printer />{t.receipt.print}</Button></div>
    </div>
  );
}
