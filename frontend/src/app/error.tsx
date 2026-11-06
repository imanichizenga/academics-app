"use client";
import { useT } from "@/lib/providers";

export default function Error({ reset }: { error: Error; reset: () => void }) {
  const { t } = useT();
  return (
    <main className="grid min-h-[60dvh] place-items-center p-6 text-center">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{t.common.somethingWrong}</h1>
        <p className="mt-2 text-fg-2">{t.common.pleaseTryAgain}</p>
        <button onClick={reset} className="mt-5 inline-flex h-11 items-center rounded-lg bg-primary px-5 text-sm font-medium text-primary-fg">{t.common.tryAgain}</button>
      </div>
    </main>
  );
}
