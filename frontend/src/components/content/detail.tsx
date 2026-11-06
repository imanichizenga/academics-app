"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bookmark, Download, Heart, List, Lock, Share2 } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Avatar, Badge } from "@/components/ui/display";
import { Link } from "@/components/ui/link";
import { Sheet, useIsMobile } from "@/components/ui/overlay";
import { api, post } from "@/lib/api";
import { AuthorCard } from "@/components/site/teacher";
import { useSession, useT } from "@/lib/providers";
import type { Card, Detail } from "@/lib/types";
import { GRID, cn, dateLabel, duration, fileSize } from "@/lib/utils";
import { AudioPlayer } from "./audio";
import { BodyRenderer, FileCard, useFileDownload } from "./body";
import { AccessBadge, ContentCard } from "./card";
import { Comments } from "./comments";
import { Paywall } from "./paywall";

const VideoPlayer = dynamic(() => import("./video").then((m) => m.VideoPlayer), { ssr: false, loading: () => <div className="skeleton aspect-video rounded-xl" /> });
const PdfViewer = dynamic(() => import("./pdf").then((m) => m.PdfViewer), { ssr: false, loading: () => <div className="skeleton h-[70vh] rounded-xl" /> });

function deviceId() {
  try {
    let id = localStorage.getItem("device");
    if (!id) { id = crypto.randomUUID(); localStorage.setItem("device", id); }
    return id;
  } catch { return ""; }
}

function ReadingBar() {
  const [p, setP] = useState(0);
  useEffect(() => {
    const on = () => { const h = document.documentElement; setP(Math.min(100, (scrollY / Math.max(1, h.scrollHeight - h.clientHeight)) * 100)); };
    on();
    addEventListener("scroll", on, { passive: true });
    return () => removeEventListener("scroll", on);
  }, []);
  return <div aria-hidden className="safe-top pointer-events-none fixed inset-x-0 top-14 z-30 h-[2px] md:top-16"><div className="h-full bg-primary" style={{ width: `${p}%` }} /></div>;
}

function useToc(html: string) {
  return useMemo(() => [...html.matchAll(/<h([23]) id="([^"]+)"[^>]*>(.*?)<\/h[23]>/g)].map((m) => ({ level: Number(m[1]), id: m[2], text: m[3].replace(/<[^>]+>/g, "") })), [html]);
}
function Toc({ items, onPick }: { items: { level: number; id: string; text: string }[]; onPick?: () => void }) {
  return (
    <ul className="space-y-1 text-[13px]">
      {items.map((i) => <li key={i.id} style={{ paddingLeft: (i.level - 2) * 12 }}><a href={`#${i.id}`} onClick={onPick} className="block py-1 text-fg-2 hover:text-fg">{i.text}</a></li>)}
    </ul>
  );
}

function Actions({ item }: { item: Detail }) {
  const { user } = useSession();
  const { t } = useT();
  const client = useQueryClient();
  const [liked, setLiked] = useState(item.user_state.liked);
  const [likes, setLikes] = useState(item.like_count);
  const [saved, setSaved] = useState(item.user_state.bookmarked);
  useEffect(() => { setLiked(item.user_state.liked); setSaved(item.user_state.bookmarked); setLikes(item.like_count); }, [item.user_state, item.like_count]);
  const mustLogin = () => { toast(t.auth.loginToSave, { action: { label: t.common.logIn, onClick: () => { location.href = "/login"; } } }); };
  const like = async () => {
    if (!user) return mustLogin();
    const on = !liked;
    setLiked(on); setLikes((n) => n + (on ? 1 : -1));
    try { await post(`/contents/${item.id}/like/`); } catch { setLiked(!on); setLikes((n) => n + (on ? -1 : 1)); toast.error(t.lesson.couldNotSave); }
  };
  const save = async () => {
    if (!user) return mustLogin();
    const on = !saved;
    setSaved(on);
    try { await post(`/contents/${item.id}/bookmark/`); client.invalidateQueries({ queryKey: ["bookmarks"] }); toast.success(on ? t.lesson.savedOn : t.lesson.savedOff); } catch { setSaved(!on); toast.error(t.lesson.couldNotSave); }
  };
  const share = async () => {
    const url = location.href;
    if (navigator.share) { await navigator.share({ title: item.title, url }).catch(() => {}); return; }
    await navigator.clipboard?.writeText(url);
    toast.success(t.lesson.linkCopied);
  };
  return (
    <div className="flex items-center gap-1">
      {item.allow_reactions && <Button variant="ghost" size="sm" aria-pressed={liked} aria-label={t.lesson.like} className={cn(liked && "text-danger")} onClick={like}><Heart fill={liked ? "currentColor" : "none"} />{likes || ""}</Button>}
      {item.allow_bookmarks && <Button variant="ghost" size="sm" aria-pressed={saved} aria-label={t.lesson.bookmark} className={cn(saved && "text-primary-ink")} onClick={save}><Bookmark fill={saved ? "currentColor" : "none"} /></Button>}
      <Button variant="ghost" size="sm" aria-label={t.lesson.share} onClick={share}><Share2 /></Button>
    </div>
  );
}

function MainMedia({ item }: { item: Detail }) {
  const media = item.main_media;
  const { start, busy } = useFileDownload();
  const { t } = useT();
  if (!media) return null;
  if (media.status !== "ready") return <div className="my-6 grid aspect-video place-items-center rounded-xl bg-surface-2 text-sm text-fg-2">{t.lesson.preparing}</div>;
  if (media.kind === "video") return <div className="my-6"><VideoPlayer assetId={media.id} contentId={item.id} resumeAt={item.user_state.position_seconds} /></div>;
  if (media.kind === "audio") return <div className="my-6"><AudioPlayer assetId={media.id} title={media.original_filename} /></div>;
  if (media.kind === "pdf") return (
    <div className="my-6 space-y-3">
      <PdfViewer assetId={media.id} slug={item.slug} />
      {item.allow_download && item.has_access && <Button variant="secondary" loading={busy} onClick={() => start(media.id)}><Download />{t.lesson.downloadPdf} · {fileSize(media.size)}</Button>}
    </div>
  );
  return (
    <div className="my-6">
      {media.thumbnail_url && <img src={media.thumbnail_url} alt="" className="mb-3 max-h-80 rounded-xl border" />}
      {item.has_access && item.allow_download ? <FileCard assetId={media.id} filename={media.original_filename} size={media.size} kind={media.kind} /> : !item.has_access ? null : <p className="text-sm text-fg-2">{t.lesson.downloadsOff}</p>}
    </div>
  );
}

export function ContentDetail({ initial, related }: { initial: Detail; related: Card[] }) {
  const { user } = useSession();
  const { t, lang } = useT();
  const query = useQuery({ queryKey: ["content", initial.slug], queryFn: () => api<Detail>(`/catalog/contents/${initial.slug}/`), initialData: initial, initialDataUpdatedAt: 0, staleTime: 0, refetchOnMount: "always" });
  const client = useQueryClient();
  useEffect(() => { client.invalidateQueries({ queryKey: ["content", initial.slug] }); }, [user?.id, client, initial.slug]);
  const item = query.data;
  const toc = useToc(item.body_html);
  const mobile = useIsMobile();
  const [tocOpen, setTocOpen] = useState(false);
  const viewed = useRef(false);
  const lastSent = useRef(0);

  useEffect(() => {
    if (viewed.current) return;
    viewed.current = true;
    api(`/contents/${item.id}/view/`, { method: "POST", headers: { "X-Device-Id": deviceId() } }).catch(() => {});
  }, [item.id]);
  useEffect(() => {
    if (!user || item.main_media?.kind === "video" || !item.has_access) return;
    const send = () => {
      const h = document.documentElement;
      const percent = Math.round((scrollY / Math.max(1, h.scrollHeight - h.clientHeight)) * 100);
      if (percent - lastSent.current < 5) return;
      lastSent.current = percent;
      api(`/contents/${item.id}/progress/`, { method: "PUT", body: { percent } }).catch(() => {});
    };
    const timer = setInterval(send, 5000);
    return () => clearInterval(timer);
  }, [user, item.id, item.has_access, item.main_media?.kind]);

  const locked = !item.has_access;
  const media = item.main_media?.duration ? duration(item.main_media.duration) : item.main_media?.page_count ? t.card.pages(item.main_media.page_count) : item.reading_time ? t.card.minRead(item.reading_time) : "";
  const hasToc = toc.length > 2 && !locked;
  return (
    <>
      <ReadingBar />
      <article className="pb-tabbar mx-auto max-w-6xl px-4 pt-5 md:px-6 md:pt-10">
        <div className={cn(hasToc && "lg:grid lg:grid-cols-[minmax(0,42rem)_230px] lg:justify-center lg:gap-12")}>
          <div className={cn("measure mx-auto min-w-0", hasToc && "lg:mx-0")}>
            <header>
              <div className="flex flex-wrap items-center gap-2 text-[13px] text-fg-2">
                {item.category && <Link href={`/explore?category=${item.category.slug}`} className="font-medium text-primary-ink">{item.category.name}</Link>}
                <span aria-hidden>·</span><span>{t.types[item.content_type]}</span>
                <AccessBadge item={item} />
              </div>
              <h1 className="mt-2 text-[28px] font-semibold leading-[1.15] tracking-tight md:text-[40px]">{item.title}</h1>
              {item.subtitle && <p className="mt-2 font-serif text-lg leading-snug text-fg-2 md:text-xl">{item.subtitle}</p>}
              <div className="mt-5 flex items-center justify-between gap-3 border-y py-2.5">
                <div className="flex min-w-0 items-center gap-2.5">
                  <Avatar name={item.author?.name ?? t.lesson.teacher} className="size-8" />
                  <div className="min-w-0 text-[13px] leading-tight">
                    <div className="truncate font-medium">{item.author?.name ?? t.lesson.teacher}</div>
                    <div className="truncate text-fg-3">{dateLabel(item.published_at, lang)}{media && ` · ${media}`}</div>
                  </div>
                </div>
                <Actions item={item} />
              </div>
            </header>
            {item.cover_full_url && !["video"].includes(item.main_media?.kind ?? "") && item.content_type !== "document" && <img src={item.cover_full_url} alt="" className="mt-6 aspect-video w-full rounded-xl object-cover" fetchPriority="high" />}
            <MainMedia item={item} />
            {mobile && toc.length > 2 && !locked && <Button variant="secondary" size="sm" className="mt-5" onClick={() => setTocOpen(true)}><List />{t.lesson.contents}</Button>}
            <div className={cn("relative mt-6", locked && "max-h-[420px] overflow-hidden")}>
              <div className="prose-reading" data-testid="article-body"><BodyRenderer html={item.body_html} slug={item.slug} /></div>
              {locked && item.body_html && <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-bg to-transparent" />}
            </div>
            {locked && <div className="relative mt-4"><Paywall content={item} /></div>}
            {item.attachments.length > 0 && (
              <section className="mt-8 space-y-2" aria-label={t.paywall.attachments}>
                <h2 className="text-sm font-semibold">{t.paywall.attachments}</h2>
                {item.attachments.map((a) => locked ? (
                  <div key={a.id} className="flex items-center gap-3 rounded-xl border p-3 text-sm text-fg-2"><Lock className="size-4" aria-hidden /><span className="truncate">{a.original_filename}</span></div>
                ) : <FileCard key={a.id} assetId={a.id} filename={a.original_filename} size={a.size} kind={a.kind} />)}
              </section>
            )}
            {item.tags.length > 0 && <div className="mt-8 flex flex-wrap gap-1.5">{item.tags.map((t) => <Link key={t.id} href={`/explore?tag=${t.slug}`} className="rounded-full border px-2.5 py-1 text-[13px] text-fg-2 hover:text-fg">#{t.name}</Link>)}</div>}
            <AuthorCard />
            {item.allow_comments && <Comments contentId={item.id} count={item.comment_count} canPost={!locked} />}
          </div>
          {hasToc && <aside className="hidden lg:block"><nav aria-label={t.lesson.toc} className="sticky top-24"><div className="mb-2 text-[13px] font-semibold">{t.lesson.inLesson}</div><Toc items={toc} /></nav></aside>}
        </div>
        {related.length > 0 && (
          <section className="mt-14" aria-label={t.lesson.related}>
            <h2 className="mb-4 text-lg font-semibold tracking-tight">{t.lesson.keepLearning}</h2>
            <div className={GRID}>{related.slice(0, 4).map((c) => <ContentCard key={c.id} item={c} />)}</div>
          </section>
        )}
      </article>
      <Sheet open={tocOpen} onOpenChange={setTocOpen} title={t.lesson.inLesson}><Toc items={toc} onPick={() => setTocOpen(false)} /></Sheet>
    </>
  );
}
export { Badge };
