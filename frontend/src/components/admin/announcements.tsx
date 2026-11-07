"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Eye, Globe, Home, Languages, Megaphone, PanelTop, Pencil, Plus, Trash2, Users } from "lucide-react";
import { useState } from "react";
import { AnnouncementBarView, AnnouncementCardView, TONES } from "@/components/site/announcements";
import { Button, IconButton } from "@/components/ui/button";
import { Badge, Card, EmptyState, Skeleton, Tabs } from "@/components/ui/display";
import { Field, Input, Select, Switch, Textarea } from "@/components/ui/form";
import { ConfirmSheet, Sheet } from "@/components/ui/overlay";
import { ApiError, api, del, patch, post } from "@/lib/api";
import { useAction } from "@/lib/providers";
import type { Announcement } from "@/lib/types";
import { cn, dateTime } from "@/lib/utils";

type Row = Announcement & { is_active: boolean; starts_at: string | null; state: "live" | "scheduled" | "ended" | "off"; created_at: string; updated_at: string; created_by_name: string };
const PATH = "/admin/announcements/";
const STATE: Record<Row["state"], { label: string; tone: "success" | "info" | "neutral" }> = {
  live: { label: "Live", tone: "success" }, scheduled: { label: "Scheduled", tone: "info" }, ended: { label: "Ended", tone: "neutral" }, off: { label: "Hidden", tone: "neutral" },
};
const AUDIENCE = [{ value: "everyone", label: "Everyone" }, { value: "guests", label: "Visitors who are not logged in" }, { value: "members", label: "Logged-in learners" }];
const BLANK: Partial<Row> = { title: "", body: "", title_sw: "", body_sw: "", link_url: "", link_label: "", link_label_sw: "", tone: "info", placement: "bar", audience: "everyone", dismissible: true, is_active: true, starts_at: null, ends_at: null };

/** <input type="datetime-local"> speaks local time without a zone; the API speaks ISO. */
const toLocal = (iso?: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const fromLocal = (value: string) => (value ? new Date(value).toISOString() : null);

function schedule(a: Partial<Row>) {
  if (a.starts_at && a.ends_at) return `${dateTime(a.starts_at)} → ${dateTime(a.ends_at)}`;
  if (a.starts_at) return `From ${dateTime(a.starts_at)}`;
  if (a.ends_at) return `Until ${dateTime(a.ends_at)}`;
  return "No end date";
}

export function Announcements() {
  const client = useQueryClient();
  const query = useQuery({ queryKey: [PATH], queryFn: () => api<Row[]>(PATH) });
  const [editing, setEditing] = useState<Partial<Row> | null>(null);
  const [removing, setRemoving] = useState<Row | null>(null);
  const refresh = () => client.invalidateQueries({ queryKey: [PATH] });
  const toggle = useAction(({ id, is_active }: { id: string; is_active: boolean }) => patch<Row>(`${PATH}${id}/`, { is_active }), {
    success: (r) => (r.is_active ? (r.state === "scheduled" ? "Turned on. It will appear when its start time comes." : "Announcement is now visible") : "Announcement hidden"), onSuccess: refresh,
  });
  const remove = useAction(() => del(`${PATH}${removing!.id}/`), { success: "Announcement deleted", onSuccess: () => { setRemoving(null); refresh(); } });
  const rows = query.data ?? [];
  const live = rows.filter((r) => r.state === "live").length;
  return (
    <div className="space-y-4">
      <Card className="space-y-4 p-4 md:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold tracking-tight">Announcements</h2>
            <p className="mt-0.5 max-w-xl text-sm text-fg-2">Tell visitors about new lessons, offers or changes. Switch one off at any time and it leaves the site within about 10 seconds.</p>
            {rows.length > 0 && <p className="mt-1.5 text-[13px] text-fg-3">{live} live · {rows.length} in total</p>}
          </div>
          <Button onClick={() => setEditing({ ...BLANK })}><Plus />New announcement</Button>
        </div>
        {query.isLoading ? <Skeleton className="h-40" /> : rows.length === 0 ? (
          <EmptyState icon={Megaphone} title="No announcements yet" text="Create one to show a message across the site or on the home page." action={<Button variant="secondary" onClick={() => setEditing({ ...BLANK })}><Plus />Write the first one</Button>} />
        ) : (
          <ul className="divide-y rounded-xl border" data-testid="announcement-list">
            {rows.map((a) => {
              const tone = TONES[a.tone];
              const Icon = tone.icon;
              return (
                <li key={a.id} className="flex items-start gap-3 p-3 md:p-4">
                  <span className={cn("mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg", a.tone === "promo" ? "bg-primary text-primary-fg" : tone.chip)} aria-hidden><Icon className="size-4" /></span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate font-medium">{a.title}</span>
                      <Badge tone={STATE[a.state].tone}>{a.state === "live" && <span className="size-1.5 rounded-full bg-current" aria-hidden />}{STATE[a.state].label}</Badge>
                    </div>
                    {a.body && <p className="mt-0.5 line-clamp-1 text-[13px] text-fg-2">{a.body}</p>}
                    <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-fg-3">
                      <span className="inline-flex items-center gap-1">{a.placement === "bar" ? <PanelTop className="size-3.5" /> : <Home className="size-3.5" />}{a.placement === "bar" ? "Bar on every page" : "Home page card"}</span>
                      <span className="inline-flex items-center gap-1"><Users className="size-3.5" />{AUDIENCE.find((x) => x.value === a.audience)?.label}</span>
                      <span className="inline-flex items-center gap-1"><CalendarClock className="size-3.5" />{schedule(a)}</span>
                      {a.title_sw && <span className="inline-flex items-center gap-1"><Languages className="size-3.5" />Swahili too</span>}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Switch label={<span className="sr-only">Show {a.title}</span>} checked={a.is_active} disabled={toggle.isPending} onChange={(is_active) => toggle.mutate({ id: a.id, is_active })} />
                    <IconButton label="Edit" size="icon-sm" onClick={() => setEditing(a)}><Pencil /></IconButton>
                    <IconButton label="Delete" size="icon-sm" onClick={() => setRemoving(a)}><Trash2 /></IconButton>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      {editing && <Editor initial={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh(); }} />}
      <ConfirmSheet open={!!removing} onOpenChange={(v) => !v && setRemoving(null)} title="Delete this announcement?" text={removing ? `"${removing.title}" will be removed for good. To hide it for now, switch it off instead.` : ""} confirmLabel="Delete" danger loading={remove.isPending} onConfirm={() => remove.mutate()} />
    </div>
  );
}

function Choice({ active, onClick, icon: Icon, title, text }: { active: boolean; onClick: () => void; icon: typeof Home; title: string; text: string }) {
  return (
    <button type="button" aria-pressed={active} onClick={onClick} className={cn("flex items-start gap-2.5 rounded-xl border p-3 text-left hover:bg-surface-2", active && "border-primary bg-primary-soft hover:bg-primary-soft")}>
      <Icon className={cn("mt-0.5 size-4 shrink-0 text-fg-3", active && "text-primary-ink")} aria-hidden />
      <span><span className="block text-sm font-medium">{title}</span><span className="block text-xs text-fg-3">{text}</span></span>
    </button>
  );
}

function Editor({ initial, onClose, onSaved }: { initial: Partial<Row>; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<Partial<Row>>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [swahili, setSwahili] = useState(!!(initial.title_sw || initial.body_sw));
  const [previewLang, setPreviewLang] = useState("en");
  const set = (p: Partial<Row>) => setF((x) => ({ ...x, ...p }));
  const body = { title: f.title, body: f.body, title_sw: f.title_sw, body_sw: f.body_sw, link_url: f.link_url, link_label: f.link_label, link_label_sw: f.link_label_sw, tone: f.tone, placement: f.placement, audience: f.audience, dismissible: f.dismissible, is_active: f.is_active, starts_at: f.starts_at, ends_at: f.ends_at };
  const save = useAction(() => (f.id ? patch(`${PATH}${f.id}/`, body) : post(PATH, body)), {
    success: (r: Row) => (r.state === "live" ? "Published. Visitors can see it now." : r.state === "scheduled" ? "Saved. It will appear at the start time." : "Saved as hidden"),
    onSuccess: onSaved, onError: (e: ApiError) => { setErrors(e.fields); if (!Object.keys(e.fields).length) setErrors({ title: e.message }); },
  });
  const preview = { id: "preview", version: "", title: f.title || "Your headline", body: f.body ?? "", title_sw: f.title_sw ?? "", body_sw: f.body_sw ?? "", link_url: f.link_url ?? "", link_label: f.link_label ?? "", link_label_sw: f.link_label_sw ?? "", tone: f.tone!, placement: f.placement!, audience: f.audience!, dismissible: !!f.dismissible, ends_at: null } as Announcement;
  const scheduled = f.is_active && f.starts_at && Date.parse(f.starts_at) > Date.now();
  const saveLabel = !f.is_active ? "Save hidden" : scheduled ? "Schedule" : f.id ? "Save and publish" : "Publish now";
  return (
    <Sheet open onOpenChange={(v) => !v && onClose()} title={f.id ? "Edit announcement" : "New announcement"} size="lg"
      footer={<div className="flex w-full items-center justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={save.isPending} disabled={!f.title?.trim()} onClick={() => save.mutate()}>{saveLabel}</Button></div>}>
      <div className="space-y-5">
        <div className="rounded-xl border bg-surface-2 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-fg-2"><Eye className="size-3.5" />Preview · {f.placement === "bar" ? "top of every page" : "home page"}</span>
            {swahili && <Tabs value={previewLang} onChange={setPreviewLang} className="border-0" items={[{ value: "en", label: "English" }, { value: "sw", label: "Swahili" }]} />}
          </div>
          <div className="overflow-hidden rounded-lg border bg-bg" data-testid="announcement-preview">
            {f.placement === "bar"
              ? <><AnnouncementBarView preview a={preview} lang={previewLang} learnMore="Learn more" dismissLabel="Dismiss" onDismiss={() => {}} /><div className="space-y-2 p-4" aria-hidden><div className="h-3 w-2/3 rounded bg-surface-2" /><div className="h-3 w-1/2 rounded bg-surface-2" /></div></>
              : <div className="p-3"><AnnouncementCardView preview a={preview} lang={previewLang} learnMore="Learn more" dismissLabel="Dismiss" eyebrow={previewLang === "sw" ? "Tangazo" : "Announcement"} onDismiss={() => {}} /></div>}
          </div>
        </div>

        <div className="space-y-4">
          <Field label="Headline" error={errors.title} hint={`${(f.title ?? "").length}/120`}><Input maxLength={120} value={f.title ?? ""} placeholder="New exam revision lessons are live" onChange={(e) => set({ title: e.target.value })} invalid={!!errors.title} /></Field>
          <Field label="Message (optional)" error={errors.body} hint={`${(f.body ?? "").length}/400`}><Textarea rows={2} maxLength={400} value={f.body ?? ""} placeholder="One or two short sentences." onChange={(e) => set({ body: e.target.value })} /></Field>
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_200px]">
            <Field label="Button link (optional)" error={errors.link_url} hint="A page here, like /pricing, or a full https:// link"><Input value={f.link_url ?? ""} placeholder="/pricing" onChange={(e) => set({ link_url: e.target.value })} invalid={!!errors.link_url} /></Field>
            <Field label="Button text"><Input maxLength={40} value={f.link_label ?? ""} placeholder="Learn more" disabled={!f.link_url} onChange={(e) => set({ link_label: e.target.value })} /></Field>
          </div>
        </div>

        <div>
          <div className="mb-1.5 text-[13px] font-medium">Style</div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4" role="group" aria-label="Style">
            {(Object.keys(TONES) as Row["tone"][]).map((key) => {
              const tone = TONES[key];
              const Icon = tone.icon;
              return (
                <button key={key} type="button" aria-pressed={f.tone === key} onClick={() => set({ tone: key })} className={cn("flex items-center gap-2 rounded-xl border p-2.5 text-left text-sm font-medium hover:bg-surface-2", f.tone === key && "border-primary ring-2 ring-primary/20")}>
                  <span className={cn("grid size-7 place-items-center rounded-full", key === "promo" ? "bg-primary text-primary-fg" : tone.chip)} aria-hidden><Icon className="size-3.5" /></span>{tone.label}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <div className="mb-1.5 text-[13px] font-medium">Where it shows</div>
          <div className="grid gap-2 md:grid-cols-2">
            <Choice active={f.placement === "bar"} onClick={() => set({ placement: "bar" })} icon={PanelTop} title="Bar on every page" text="A slim strip above the menu. Best for short, urgent news." />
            <Choice active={f.placement === "home"} onClick={() => set({ placement: "home" })} icon={Home} title="Card on the home page" text="A larger card under the welcome text. Room for a little more." />
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Who sees it"><Select value={f.audience} onChange={(audience) => set({ audience: audience as Row["audience"] })} options={AUDIENCE} /></Field>
          <div className="md:pt-6"><Switch label="Visitors can close it" description="Closed announcements stay closed on that device until you edit them." checked={!!f.dismissible} onChange={(dismissible) => set({ dismissible })} /></div>
          <Field label="Start showing (optional)" hint="Leave empty to start now"><Input type="datetime-local" value={toLocal(f.starts_at)} onChange={(e) => set({ starts_at: fromLocal(e.target.value) })} /></Field>
          <Field label="Stop showing (optional)" error={errors.ends_at} hint="Leave empty to keep it up"><Input type="datetime-local" value={toLocal(f.ends_at)} onChange={(e) => set({ ends_at: fromLocal(e.target.value) })} invalid={!!errors.ends_at} /></Field>
        </div>

        <div className="rounded-xl border">
          <button type="button" aria-expanded={swahili} onClick={() => setSwahili(!swahili)} className="flex w-full items-center gap-2 p-3 text-left text-sm font-medium"><Globe className="size-4 text-fg-3" />{swahili ? "Swahili version" : "Add a Swahili version"}<span className="ml-auto text-xs font-normal text-fg-3">Shown to visitors who read in Swahili</span></button>
          {swahili && (
            <div className="space-y-3 border-t p-3">
              <Field label="Kichwa (headline)"><Input maxLength={120} value={f.title_sw ?? ""} onChange={(e) => set({ title_sw: e.target.value })} /></Field>
              <Field label="Ujumbe (message)"><Textarea rows={2} maxLength={400} value={f.body_sw ?? ""} onChange={(e) => set({ body_sw: e.target.value })} /></Field>
              {f.link_url && <Field label="Maandishi ya kitufe (button text)"><Input maxLength={40} value={f.link_label_sw ?? ""} placeholder="Soma zaidi" onChange={(e) => set({ link_label_sw: e.target.value })} /></Field>}
            </div>
          )}
        </div>

        <div className="rounded-xl border bg-surface-2/60 p-3">
          <Switch label="Visible on the site" description={f.is_active ? (scheduled ? `Will appear ${dateTime(f.starts_at)}.` : "Visitors see it as soon as you save.") : "Saved, but hidden until you switch it on."} checked={!!f.is_active} onChange={(is_active) => set({ is_active })} />
        </div>
      </div>
    </Sheet>
  );
}
