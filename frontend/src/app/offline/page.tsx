import { getT } from "@/lib/server";

export const metadata = { title: "Offline" };
export default async function Offline() {
  const t = await getT();
  return (
    <main className="grid min-h-dvh place-items-center p-6 text-center">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t.common.offline}</h1>
        <p className="mt-2 text-fg-2">{t.common.offlineText}</p>
        <a href="/" className="mt-5 inline-flex h-11 items-center rounded-lg bg-primary px-5 text-sm font-medium text-primary-fg">{t.common.tryAgain}</a>
      </div>
    </main>
  );
}
