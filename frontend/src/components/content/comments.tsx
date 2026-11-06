"use client";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { Flag, GraduationCap, Heart, MessageCircle, MoreHorizontal, Pencil, Pin, Reply, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button, IconButton } from "@/components/ui/button";
import { Avatar, Badge, Dropdown, DropdownContent, DropdownItem, DropdownTrigger, EmptyState, Skeleton } from "@/components/ui/display";
import { Field, Input, Textarea } from "@/components/ui/form";
import { Link } from "@/components/ui/link";
import { Sheet, useIsMobile } from "@/components/ui/overlay";
import { ApiError, api, del, patch, post } from "@/lib/api";
import { useAction, useSession, useSite } from "@/lib/providers";
import type { Comment, Paged } from "@/lib/types";
import { cn, timeAgo } from "@/lib/utils";

type Pages = { pages: Paged<Comment>[]; pageParams: unknown[] };

function Composer({ contentId, parent, onDone, autoFocus, initial, commentId, submitLabel }: { contentId: string; parent?: string; onDone?: () => void; autoFocus?: boolean; initial?: string; commentId?: string; submitLabel?: string }) {
  const [body, setBody] = useState(initial ?? "");
  const [guest, setGuest] = useState("");
  const { user } = useSession();
  const client = useQueryClient();
  const key = ["comments", contentId];
  const send = useAction(
    () => (commentId ? patch<Comment>(`/comments/${commentId}/`, { body }) : post<Comment>(`/contents/${contentId}/comments/`, { body, parent, guest_name: guest })),
    {
      onSuccess: (saved) => {
        setBody("");
        if (saved.status === "pending") toast.success("Thanks! Your comment is waiting for approval.");
        if (saved.status === "spam") toast.info("Your comment is being reviewed.");
        client.invalidateQueries({ queryKey: key });
        onDone?.();
      },
      onError: (e) => {
        client.invalidateQueries({ queryKey: key });
        toast.error(e.message);
      },
    },
  );
  const submit = () => {
    if (!body.trim() || send.isPending) return;
    if (!commentId && user) { // optimistic: the comment appears at once and is reconciled on response
      client.setQueryData<Pages>(key, (data) => {
        if (!data) return data;
        const fake: Comment = { id: `tmp-${Date.now()}`, body, parent: parent ?? null, status: "approved", is_pinned: false, like_count: 0, created_at: new Date().toISOString(), edited_at: null, author_name: `${user.first_name} ${user.last_name}`.trim() || user.phone, is_teacher: user.role !== "student", is_mine: true, can_edit: false, liked: false, replies: [] };
        const pages = data.pages.map((p, i) => {
          if (parent) return { ...p, results: p.results.map((c) => (c.id === parent ? { ...c, replies: [...c.replies, fake] } : c)) };
          return i === 0 ? { ...p, results: [...p.results, fake] } : p;
        });
        return { ...data, pages };
      });
    }
    send.mutate();
  };
  return (
    <div className="space-y-2">
      {!user && <Field label="Your name"><Input value={guest} onChange={(e) => setGuest(e.target.value)} maxLength={80} /></Field>}
      <Textarea aria-label="Your comment" placeholder={parent ? "Write a reply" : "Share a thought or ask a question"} value={body} onChange={(e) => setBody(e.target.value)} autoFocus={autoFocus} maxLength={4000} />
      <div className="flex justify-end gap-2">
        {onDone && <Button variant="ghost" size="sm" onClick={onDone}>Cancel</Button>}
        <Button size="sm" onClick={submit} loading={send.isPending} disabled={!body.trim()}>{submitLabel ?? (parent ? "Reply" : "Comment")}</Button>
      </div>
    </div>
  );
}

function Item({ c, contentId, closed, onReply }: { c: Comment; contentId: string; closed?: boolean; onReply: (c: Comment) => void }) {
  const { user } = useSession();
  const [editing, setEditing] = useState(false);
  const [liked, setLiked] = useState(c.liked);
  const [likes, setLikes] = useState(c.like_count);
  const client = useQueryClient();
  const refresh = () => client.invalidateQueries({ queryKey: ["comments", contentId] });
  const like = async () => {
    if (!user) { toast("Log in to like comments"); return; }
    const on = !liked;
    setLiked(on); setLikes((n) => n + (on ? 1 : -1));
    try { await post(`/comments/${c.id}/like/`); } catch (e) { setLiked(!on); setLikes((n) => n + (on ? -1 : 1)); toast.error((e as ApiError).message); }
  };
  const remove = useAction(() => del(`/comments/${c.id}/`), { success: "Comment deleted", onSuccess: refresh });
  const report = useAction(() => post(`/comments/${c.id}/report/`), { success: "Thanks, the teacher will take a look." });
  const pending = c.id.startsWith("tmp-");
  return (
    <div className={cn("flex gap-3", pending && "opacity-60")}>
      <Avatar name={c.author_name} className={cn(c.is_teacher && "bg-primary text-primary-fg")} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="text-sm font-medium">{c.author_name}</span>
          {c.is_teacher && <Badge tone="primary"><GraduationCap />Teacher</Badge>}
          {c.is_pinned && <Badge><Pin />Pinned</Badge>}
          <span className="text-[13px] text-fg-3">{timeAgo(c.created_at)}{c.edited_at && " · edited"}</span>
        </div>
        {editing ? <div className="mt-2"><Composer contentId={contentId} commentId={c.id} initial={c.body} submitLabel="Save" autoFocus onDone={() => setEditing(false)} /></div>
          : <p className="mt-0.5 whitespace-pre-wrap break-words text-[15px] leading-relaxed">{c.body}</p>}
        {!editing && !pending && (
          <div className="-ml-2 mt-0.5 flex items-center">
            <Button variant="ghost" size="sm" aria-pressed={liked} className={cn(liked && "text-danger")} onClick={like}><Heart fill={liked ? "currentColor" : "none"} />{likes || ""}</Button>
            {!closed && <Button variant="ghost" size="sm" onClick={() => onReply(c)}><Reply />Reply</Button>}
            <Dropdown>
              <DropdownTrigger asChild><IconButton label="More" size="icon-sm"><MoreHorizontal /></IconButton></DropdownTrigger>
              <DropdownContent>
                {c.can_edit && <DropdownItem onSelect={() => setEditing(true)}><Pencil />Edit</DropdownItem>}
                {c.can_edit && <DropdownItem danger onSelect={() => remove.mutate()}><Trash2 />Delete</DropdownItem>}
                {!c.is_mine && <DropdownItem onSelect={() => report.mutate()}><Flag />Report</DropdownItem>}
              </DropdownContent>
            </Dropdown>
          </div>
        )}
      </div>
    </div>
  );
}

export function Comments({ contentId, count, canPost }: { contentId: string; count: number; canPost: boolean }) {
  const site = useSite();
  const { user } = useSession();
  const mobile = useIsMobile();
  const [replyTo, setReplyTo] = useState<Comment | null>(null);
  const [composing, setComposing] = useState(false);
  const query = useInfiniteQuery({
    queryKey: ["comments", contentId], initialPageParam: 1,
    queryFn: ({ pageParam }) => api<Paged<Comment>>(`/contents/${contentId}/comments/?page=${pageParam}`),
    getNextPageParam: (last) => last.next ?? undefined,
  });
  const rows = query.data?.pages.flatMap((p) => p.results) ?? [];
  const guestsOk = site.guest_comment_policy !== "login_required";
  const allowed = canPost && (user || guestsOk);
  return (
    <section id="comments" aria-label="Comments" className="mt-12 border-t pt-8">
      <h2 className="mb-5 text-lg font-semibold tracking-tight">Comments{count ? ` (${count})` : ""}</h2>
      {allowed ? (mobile ? <Button variant="secondary" className="w-full justify-start text-fg-3" onClick={() => setComposing(true)}><MessageCircle />Add a comment</Button> : <Composer contentId={contentId} />)
        : !user && !guestsOk ? <p className="rounded-xl bg-surface-2 p-4 text-sm text-fg-2"><Link href="/login" className="font-medium text-primary-ink">Log in</Link> to join the discussion.</p>
          : <p className="rounded-xl bg-surface-2 p-4 text-sm text-fg-2">Unlock this lesson to join the discussion.</p>}
      <div className="mt-6 space-y-6">
        {query.isLoading ? <Skeleton className="h-20" /> : rows.length === 0 ? <EmptyState icon={MessageCircle} title="No comments yet" text="Be the first to share a thought or ask a question." /> : rows.map((c) => (
          <div key={c.id} className="space-y-4">
            <Item c={c} contentId={contentId} closed={!allowed} onReply={setReplyTo} />
            {c.replies.length > 0 && <div className="ml-6 space-y-4 border-l pl-4 md:ml-12">{c.replies.map((r) => <Item key={r.id} c={r} contentId={contentId} closed={!allowed} onReply={() => setReplyTo(c)} />)}</div>}
            {replyTo?.id === c.id && !mobile && <div className="ml-12"><Composer contentId={contentId} parent={c.id} autoFocus onDone={() => setReplyTo(null)} /></div>}
          </div>
        ))}
      </div>
      {query.hasNextPage && <Button variant="secondary" className="mt-6 w-full" loading={query.isFetchingNextPage} onClick={() => query.fetchNextPage()}>Show more comments</Button>}
      {mobile && (
        <Sheet open={composing || !!replyTo} onOpenChange={(v) => { if (!v) { setComposing(false); setReplyTo(null); } }} title={replyTo ? `Reply to ${replyTo.author_name}` : "Add a comment"}>
          <Composer contentId={contentId} parent={replyTo?.id} autoFocus onDone={() => { setComposing(false); setReplyTo(null); }} />
        </Sheet>
      )}
    </section>
  );
}
