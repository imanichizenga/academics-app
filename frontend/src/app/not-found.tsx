import Link from "next/link";
import { getT } from "@/lib/server";

export default async function NotFound() {
  const t = await getT();
  return (
    <main className="grid min-h-dvh place-items-center p-6 text-center">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t.common.notFound}</h1>
        <p className="mt-2 text-fg-2">{t.common.notFoundText}</p>
        <Link href="/" className="mt-5 inline-flex h-11 items-center rounded-lg bg-primary px-5 text-sm font-medium text-primary-fg">{t.common.goHome}</Link>
      </div>
    </main>
  );
}
