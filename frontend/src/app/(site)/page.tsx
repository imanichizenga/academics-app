import { ArrowRight, Check } from "lucide-react";
import { ContinueLearning, HomeRefresh } from "@/components/site/home";
import { ContentCard, GRID } from "@/components/content/card";
import { Button } from "@/components/ui/button";
import { Link } from "@/components/ui/link";
import { getSite, serverGet } from "@/lib/server";
import type { Card, CategoryNode } from "@/lib/types";
import { money } from "@/lib/utils";

function Section({ title, href, children }: { title: string; href?: string; children: React.ReactNode }) {
  return (
    <section className="mt-10 md:mt-14">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold tracking-tight md:text-xl">{title}</h2>
        {href && <Link href={href} className="inline-flex items-center gap-1 text-sm font-medium text-primary-ink">See all<ArrowRight className="size-4" aria-hidden /></Link>}
      </div>
      {children}
    </section>
  );
}

export default async function HomePage() {
  const [site, home, categories] = await Promise.all([
    getSite(),
    serverGet<{ featured: Card[]; latest_free: Card[]; popular: Card[] }>("/catalog/home/"),
    serverGet<CategoryNode[]>("/catalog/categories/", 60),
  ]);
  const featured = home?.featured ?? [];
  return (
    <HomeRefresh>
      <div className="pb-tabbar mx-auto max-w-6xl px-4 md:px-6">
        <section className="pt-8 md:pt-16">
          <h1 className="max-w-2xl font-serif text-[34px] font-semibold leading-[1.08] tracking-tight md:text-[52px]">{site.hero_title}</h1>
          <p className="mt-3 max-w-xl text-[17px] leading-relaxed text-fg-2">{site.hero_subtitle}</p>
          <div className="mt-6 flex flex-wrap gap-2">
            <Button asChild size="lg"><Link href="/explore">Start learning</Link></Button>
            <Button asChild size="lg" variant="secondary"><Link href="/pricing">See plans</Link></Button>
          </div>
        </section>
        {featured.length > 0 && (
          <section aria-label="Featured" className="mt-8 md:mt-12">
            <div className="scroll-x -mx-4 flex gap-4 px-4 md:mx-0 md:px-0">
              {featured.map((c, i) => <ContentCard key={c.id} item={c} priority={i < 2} className="w-[84%] shrink-0 sm:w-[46%] lg:w-[31.4%]" />)}
            </div>
          </section>
        )}
        <ContinueLearning />
        {categories && categories.length > 0 && (
          <Section title="Browse by subject">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
              {categories.map((c) => (
                <Link key={c.id} href={`/explore?category=${c.slug}`} spinner="overlay" className="group rounded-xl border bg-surface p-4 shadow-sm hover:shadow-md">
                  <span className="mb-3 block size-2.5 rounded-full" style={{ background: c.color || "var(--primary)" }} aria-hidden />
                  <div className="font-semibold tracking-tight">{c.name}</div>
                  <div className="mt-0.5 text-[13px] text-fg-3">{c.content_count} lessons</div>
                </Link>
              ))}
            </div>
          </Section>
        )}
        {home && home.latest_free.length > 0 && <Section title="Latest free lessons" href="/explore?access=free"><div className={GRID}>{home.latest_free.slice(0, 4).map((c) => <ContentCard key={c.id} item={c} />)}</div></Section>}
        {home && home.popular.length > 0 && <Section title="Popular right now" href="/explore?sort=popular"><div className={GRID}>{home.popular.slice(0, 4).map((c) => <ContentCard key={c.id} item={c} />)}</div></Section>}
        {site.plans.length > 0 && (
          <Section title="One subscription, everything unlocked" href="/pricing">
            <div className="grid gap-4 md:grid-cols-3">
              {site.plans.slice(0, 3).map((p) => (
                <div key={p.id} className="rounded-xl border bg-surface p-5 shadow-sm">
                  <div className="font-semibold tracking-tight">{p.name}</div>
                  <div className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">{money(p.effective_price)}</div>
                  <ul className="mt-3 space-y-1.5 text-sm text-fg-2">{p.features.slice(0, 2).map((f) => <li key={f} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />{f}</li>)}</ul>
                </div>
              ))}
            </div>
          </Section>
        )}
      </div>
    </HomeRefresh>
  );
}
