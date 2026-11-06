import { ArrowRight, Check } from "lucide-react";
import { ContinueLearning, HomeRefresh } from "@/components/site/home";
import { MeetTeacher } from "@/components/site/teacher";
import { ContentCard } from "@/components/content/card";
import { Button } from "@/components/ui/button";
import { Carousel } from "@/components/ui/carousel";
import { Link } from "@/components/ui/link";
import { getSite, getT, serverGet } from "@/lib/server";
import type { Card, CategoryNode } from "@/lib/types";
import { GRID, money } from "@/lib/utils";

function Section({ title, href, more, children }: { title: string; href?: string; more?: string; children: React.ReactNode }) {
  return (
    <section className="mt-10 md:mt-14">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold tracking-tight md:text-xl">{title}</h2>
        {href && <Link href={href} className="inline-flex items-center gap-1 text-sm font-medium text-primary-ink">{more}<ArrowRight className="size-4" aria-hidden /></Link>}
      </div>
      {children}
    </section>
  );
}

export default async function HomePage() {
  const [site, t, home, categories] = await Promise.all([
    getSite(),
    getT(),
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
            <Button asChild size="lg"><Link href="/explore">{t.home.start}</Link></Button>
            <Button asChild size="lg" variant="secondary"><Link href="/pricing">{t.home.plans}</Link></Button>
          </div>
        </section>
        {featured.length > 0 && (
          <section aria-label={t.home.featured} className="mt-8 md:mt-12">
            <Carousel label={t.home.featured}>
              {featured.map((c, i) => <ContentCard key={c.id} item={c} variant="large" priority={i < 2} className="w-[84%] shrink-0 sm:w-[46%] lg:w-[31.4%]" />)}
            </Carousel>
          </section>
        )}
        <ContinueLearning />
        {categories && categories.length > 0 && (
          <Section title={t.home.subjects}>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
              {categories.map((c) => (
                <Link key={c.id} href={`/explore?category=${c.slug}`} spinner="overlay" className="group rounded-xl border bg-surface p-4 shadow-sm hover:shadow-md">
                  <span className="mb-3 block size-2.5 rounded-full" style={{ background: c.color || "var(--primary)" }} aria-hidden />
                  <div className="font-semibold tracking-tight">{c.name}</div>
                  <div className="mt-0.5 text-[13px] text-fg-3">{t.home.lessons(c.content_count)}</div>
                </Link>
              ))}
            </div>
          </Section>
        )}
        {home && home.latest_free.length > 0 && <Section title={t.home.free} href="/explore?access=free" more={t.home.seeAll}><div className={GRID}>{home.latest_free.slice(0, 4).map((c) => <ContentCard key={c.id} item={c} />)}</div></Section>}
        {home && home.popular.length > 0 && <Section title={t.home.popular} href="/explore?sort=popular" more={t.home.seeAll}><div className={GRID}>{home.popular.slice(0, 4).map((c) => <ContentCard key={c.id} item={c} />)}</div></Section>}
        {site.teacher.name && <Section title={t.home.meet}><MeetTeacher /></Section>}
        {site.plans.length > 0 && (
          <Section title={t.home.subscription} href="/pricing" more={t.home.seeAll}>
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
