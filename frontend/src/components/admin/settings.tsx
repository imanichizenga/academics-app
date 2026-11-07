"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Circle, Copy, CreditCard, HardDrive, Loader2, Megaphone, MessageSquare, MinusCircle, Palette, Bell, Plus, Send, ShieldCheck, Trash2, TriangleAlert, Users, XCircle } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { TeacherProfile } from "@/components/site/teacher";
import { Announcements } from "./announcements";
import { Badge, Card, PageHeader, Skeleton } from "@/components/ui/display";
import { FileDropzone } from "@/components/ui/dropzone";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Field, Input, PasswordInput, PhoneInput, Select, Switch, Textarea } from "@/components/ui/form";
import { Link } from "@/components/ui/link";
import { Sheet } from "@/components/ui/overlay";
import { ApiError, api, patch, post } from "@/lib/api";
import { useAction } from "@/lib/providers";
import { useTable } from "@/lib/use-table";
import { cn, dateTime, formatPhone } from "@/lib/utils";

export const SECTIONS = [
  { key: "general", label: "General & branding", icon: Palette }, { key: "announcements", label: "Announcements", icon: Megaphone }, { key: "payments", label: "Payments", icon: CreditCard }, { key: "storage", label: "Storage", icon: HardDrive },
  { key: "engagement", label: "Comments & engagement", icon: MessageSquare }, { key: "notifications", label: "Notifications", icon: Bell }, { key: "admins", label: "Admins & roles", icon: ShieldCheck },
];
type Step = { key: string; title: string; status?: "running" | "ok" | "warn" | "fail" | "skip"; detail?: string; fix?: string; cors_json?: object };
const copy = async (text: string) => { await navigator.clipboard?.writeText(text); toast.success("Copied"); };
const Last = ({ name, at }: { name?: string; at?: string }) => (at ? <p className="text-[13px] text-fg-3">Last changed {dateTime(at)}{name ? ` by ${name}` : ""}</p> : null);

export function StepIcon({ status }: { status?: Step["status"] }) {
  if (status === "running") return <Loader2 className="size-5 animate-spin text-primary-ink" />;
  if (status === "ok") return <CheckCircle2 className="size-5 text-success" />;
  if (status === "warn") return <TriangleAlert className="size-5 text-warning" />;
  if (status === "fail") return <XCircle className="size-5 text-danger" />;
  if (status === "skip") return <MinusCircle className="size-5 text-fg-3" />;
  return <Circle className="size-5 text-border-strong" />;
}
/** Runs one server step at a time, so the checklist fills in live. */
function Diagnostics({ steps, endpoint, report, onDone, label, extra, disabled }: { steps: Step[]; endpoint: string; report: Record<string, any>; onDone: () => void; label: string; extra?: Record<string, string>; disabled?: boolean }) {
  const [state, setState] = useState<Step[]>(() => steps.map((s) => ({ ...s, ...(report?.[s.key] ?? {}) })));
  const [running, setRunning] = useState(false);
  const run = async () => {
    setRunning(true);
    setState(steps.map((s) => ({ ...s, status: undefined })));
    for (const step of steps) {
      setState((all) => all.map((s) => (s.key === step.key ? { ...s, status: "running" } : s)));
      try {
        const { step: result } = await post(endpoint, { ...extra, step: step.key });
        setState((all) => all.map((s) => (s.key === step.key ? { ...s, ...result } : s)));
      } catch (e) {
        setState((all) => all.map((s) => (s.key === step.key ? { ...s, status: "fail", detail: (e as ApiError).message } : s)));
      }
    }
    setRunning(false);
    onDone();
  };
  return (
    <div data-testid="diagnostics">
      <ol className="divide-y rounded-xl border">
        {state.map((s, i) => (
          <li key={s.key} className="flex gap-3 p-3" data-step={s.key} data-status={s.status ?? ""}>
            <span className="mt-0.5 shrink-0"><StepIcon status={s.status} /></span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{i + 1}. {s.title}</div>
              {s.detail && <p className="text-[13px] text-fg-2">{s.detail}</p>}
              {s.fix && s.status !== "ok" && <p className="mt-0.5 text-[13px] font-medium text-warning">{s.fix}</p>}
              {s.status === "fail" && s.cors_json && <pre className="mt-2 overflow-x-auto rounded-lg bg-surface-2 p-2 text-xs">{JSON.stringify(s.cors_json, null, 2)}</pre>}
            </div>
          </li>
        ))}
      </ol>
      <Button className="mt-3" loading={running} disabled={disabled} onClick={run}>{label}</Button>
    </div>
  );
}
function Section({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return <Card className="space-y-4 p-4 md:p-5"><div><h2 className="font-semibold tracking-tight">{title}</h2>{description && <p className="mt-0.5 text-sm text-fg-2">{description}</p>}</div>{children}</Card>;
}
function Secret({ label, masked, value, onChange, placeholder, multiline }: { label: string; masked: string; value: string; onChange: (v: string) => void; placeholder?: string; multiline?: boolean }) {
  const [replacing, setReplacing] = useState(!masked);
  if (masked && !replacing) return <Field label={label}><div className="flex items-center gap-2"><code className="min-w-0 flex-1 truncate rounded-lg border bg-surface-2 px-3 py-2.5 text-sm">{masked}</code><Button variant="secondary" onClick={() => setReplacing(true)}>Replace</Button></div></Field>;
  return <Field label={label}>{multiline ? <Textarea rows={4} spellCheck={false} autoComplete="off" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} /> : <PasswordInput autoComplete="new-password" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />}</Field>;
}
function useSettings<T extends Record<string, any>>(path: string) {
  const client = useQueryClient();
  const query = useQuery({ queryKey: [path], queryFn: () => api<T>(path) });
  const [form, setForm] = useState<Partial<T>>({});
  useEffect(() => { if (query.data) setForm(query.data); }, [query.data]);
  const set = (p: Partial<T>) => setForm((f) => ({ ...f, ...p }));
  const save = useAction(() => patch<T>(path, form), { success: "Settings saved", onSuccess: (r) => { client.setQueryData([path], r); } });
  return { query, form: (Object.keys(form).length ? form : query.data ?? {}) as T, set, save };
}

function General() {
  const { form: f, set, save, query } = useSettings<any>("/admin/settings/site/");
  const [busy, setBusy] = useState(false);
  const [subjects, setSubjects] = useState<string | null>(null);
  const up = async (files: File[], field: "logo" | "favicon" | "teacher_photo") => {
    if (!files[0]) return;
    setBusy(true);
    try { const form = new FormData(); form.append("file", files[0]); const r = await api("/admin/images/", { form }); set({ [field]: r.key, [`${field}_url`]: r.url }); } catch (e) { toast.error((e as ApiError).message); } finally { setBusy(false); }
  };
  if (!query.data) return <Skeleton className="h-96" />;
  return (
    <div className="space-y-4">
      <Section title="Brand" description="The logo also becomes the app icon on phones. Without one, the first letter of the site name is used.">
        <div className="grid gap-4 lg:grid-cols-2">
          <Field label="Site name"><Input value={f.site_name ?? ""} onChange={(e) => set({ site_name: e.target.value })} /></Field>
          <Field label="Tagline"><Input value={f.tagline ?? ""} onChange={(e) => set({ tagline: e.target.value })} /></Field>
          <Field label="Primary colour"><div className="flex gap-2"><input aria-label="Primary colour" type="color" value={f.primary_color ?? "#4F46E5"} onChange={(e) => set({ primary_color: e.target.value })} className="h-10 w-14 rounded-md border bg-surface p-1" /><Input value={f.primary_color ?? ""} onChange={(e) => set({ primary_color: e.target.value })} /></div></Field>
          <Field label="Currency"><Input value={f.currency ?? "TZS"} disabled /></Field>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <div><div className="mb-1.5 text-[13px] font-medium">Logo</div>{f.logo_url && <div className="mb-2 flex items-center gap-2"><img src={f.logo_url} alt="Logo" className="size-14 rounded-lg border object-cover" /><button type="button" className="text-[13px] text-fg-2 underline" onClick={() => set({ logo: "", logo_url: "" })}>Remove logo</button></div>}<FileDropzone accept="image/*" label={busy ? "Uploading…" : "Upload a logo"} onFiles={(x) => up(x, "logo")} /></div>
          <div><div className="mb-1.5 text-[13px] font-medium">Favicon</div>{f.favicon_url && <div className="mb-2 flex items-center gap-2"><img src={f.favicon_url} alt="Favicon" className="size-8 rounded border" /><button type="button" className="text-[13px] text-fg-2 underline" onClick={() => set({ favicon: "", favicon_url: "" })}>Remove favicon</button></div>}<FileDropzone accept="image/*" label="Upload a favicon" onFiles={(x) => up(x, "favicon")} /></div>
        </div>
      </Section>
      <Section title="Home page">
        <Field label="Hero title"><Input value={f.hero_title ?? ""} onChange={(e) => set({ hero_title: e.target.value })} /></Field>
        <Field label="Hero subtitle"><Textarea rows={2} value={f.hero_subtitle ?? ""} onChange={(e) => set({ hero_subtitle: e.target.value })} /></Field>
      </Section>
      <Section title="Your teacher profile" description="Shown on the home page, and as a small card at the end of every lesson. Leave the name empty to hide it.">
        <div className="grid gap-4 lg:grid-cols-2">
          <Field label="Name"><Input value={f.teacher_name ?? ""} onChange={(e) => set({ teacher_name: e.target.value })} /></Field>
          <Field label="Title"><Input value={f.teacher_title ?? ""} placeholder="Physics and maths teacher" onChange={(e) => set({ teacher_title: e.target.value })} /></Field>
          <Field label="Credentials"><Input value={f.teacher_credentials ?? ""} onChange={(e) => set({ teacher_credentials: e.target.value })} /></Field>
          <Field label="Years teaching"><Input type="number" min={0} value={f.teacher_years ?? ""} onChange={(e) => set({ teacher_years: e.target.value === "" ? null : Number(e.target.value) })} /></Field>
          <Field label="Subjects" hint="Separated by commas" className="lg:col-span-2"><Input value={subjects ?? (f.teacher_subjects ?? []).join(", ")} onChange={(e) => { setSubjects(e.target.value); set({ teacher_subjects: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) }); }} /></Field>
          <Field label="Short bio" className="lg:col-span-2"><Textarea rows={3} value={f.teacher_bio ?? ""} onChange={(e) => set({ teacher_bio: e.target.value })} /></Field>
        </div>
        <div><div className="mb-1.5 text-[13px] font-medium">Photo</div><FileDropzone accept="image/*" label={busy ? "Uploading…" : "Upload a photo"} onFiles={(x) => up(x, "teacher_photo")} /></div>
        {f.teacher_name && <div><div className="mb-1.5 text-[13px] font-medium">Preview</div><TeacherProfile teacher={{ photo_url: f.teacher_photo_url ?? "", name: f.teacher_name, title: f.teacher_title ?? "", bio: f.teacher_bio ?? "", credentials: f.teacher_credentials ?? "", years: f.teacher_years ?? null, subjects: f.teacher_subjects ?? [] }} whatsapp={f.contact_whatsapp ?? ""} social={f.social_links ?? {}} /></div>}
      </Section>
      <Section title="Contact & social">
        <div className="grid gap-4 lg:grid-cols-2">
          <Field label="Email"><Input type="email" value={f.contact_email ?? ""} onChange={(e) => set({ contact_email: e.target.value })} /></Field>
          <Field label="Phone"><Input value={f.contact_phone ?? ""} onChange={(e) => set({ contact_phone: e.target.value })} /></Field>
          <Field label="WhatsApp number"><Input inputMode="tel" value={f.contact_whatsapp ?? ""} placeholder="0754 000 001" onChange={(e) => set({ contact_whatsapp: e.target.value })} /></Field>
          {["instagram", "youtube", "facebook", "tiktok"].map((k) => <Field key={k} label={k[0].toUpperCase() + k.slice(1)}><Input type="url" value={f.social_links?.[k] ?? ""} onChange={(e) => set({ social_links: { ...f.social_links, [k]: e.target.value } })} /></Field>)}
        </div>
      </Section>
      <Section title="Pricing page questions">
        {(f.faq ?? []).map((row: { q: string; a: string }, i: number) => (
          <div key={i} className="space-y-2 rounded-lg border p-3">
            <Input aria-label="Question" value={row.q} placeholder="Question" onChange={(e) => set({ faq: f.faq.map((x: any, j: number) => (i === j ? { ...x, q: e.target.value } : x)) })} />
            <Textarea aria-label="Answer" rows={2} value={row.a} placeholder="Answer" onChange={(e) => set({ faq: f.faq.map((x: any, j: number) => (i === j ? { ...x, a: e.target.value } : x)) })} />
            <Button size="sm" variant="ghost" onClick={() => set({ faq: f.faq.filter((_: any, j: number) => i !== j) })}><Trash2 />Remove</Button>
          </div>
        ))}
        <Button variant="secondary" size="sm" onClick={() => set({ faq: [...(f.faq ?? []), { q: "", a: "" }] })}><Plus />Add question</Button>
      </Section>
      <Section title="SEO & availability">
        <Field label="Default SEO title"><Input value={f.seo_title ?? ""} onChange={(e) => set({ seo_title: e.target.value })} /></Field>
        <Field label="Default SEO description"><Textarea rows={2} value={f.seo_description ?? ""} onChange={(e) => set({ seo_description: e.target.value })} /></Field>
        <Switch label="Maintenance mode" description="Students see the maintenance page and the API refuses their requests. Staff keep working, and payments in progress still finish." checked={!!f.maintenance_mode} onChange={(maintenance_mode) => set({ maintenance_mode })} />
        <Field label="Maintenance message" hint="Optional. Replaces the default text on the maintenance page."><Textarea rows={2} value={f.maintenance_message ?? ""} onChange={(e) => set({ maintenance_message: e.target.value })} /></Field>
      </Section>
      <div className="flex items-center gap-3"><Button loading={save.isPending} onClick={() => save.mutate()}>Save changes</Button><Last at={f.updated_at} name={f.updated_by_name} /></div>
    </div>
  );
}

function Payments() {
  const path = "/admin/settings/payments/";
  const { form: f, set, save, query } = useSettings<any>(path);
  const client = useQueryClient();
  const refresh = () => client.invalidateQueries({ queryKey: [path] });
  const [phone, setPhone] = useState("");
  const [live, setLive] = useState<{ id: string; status: string } | null>(null);
  const start = useAction(() => post(`${path}live-test/`, { phone }), { success: "Prompt sent. Check your phone.", onSuccess: (r) => setLive(r) });
  const polling = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (!live || live.status !== "pending") return;
    polling.current = setInterval(async () => { const r = await api(`/orders/${live.id}/status/`); if (r.status !== "pending") setLive({ id: live.id, status: r.status }); }, 3000);
    return () => { if (polling.current) clearInterval(polling.current); };
  }, [live]);
  const toggle = useToggle(path, refresh);
  if (!query.data) return <Skeleton className="h-96" />;
  return (
    <div className="space-y-4">
      <Section title="Snippe gateway" description={<>Paid checkout stays off until this passes the test below.<span className="mt-1.5 flex flex-wrap gap-1.5"><Badge tone={f.checkout_available ? "success" : "warning"}>{f.checkout_available ? "Accepting payments" : "Payments off"}</Badge><Badge>{f.mode_label === "live" ? "Live mode" : "Test mode"}</Badge></span></>}>
        <div className="grid gap-4 lg:grid-cols-2">
          <Field label="Display name"><Input value={f.display_name ?? ""} onChange={(e) => set({ display_name: e.target.value })} /></Field>
          <Field label="Mode"><Select value={f.mode_label} onChange={(mode_label) => set({ mode_label })} options={[{ value: "test", label: "Test" }, { value: "live", label: "Live" }]} /></Field>
          <Field label="API base URL" className="lg:col-span-2"><Input type="url" value={f.api_base_url ?? ""} onChange={(e) => set({ api_base_url: e.target.value })} /></Field>
        </div>
        <Secret label="API key" masked={f.api_key_masked} value={f.api_key ?? ""} placeholder="snp_…" onChange={(api_key) => set({ api_key })} />
        <Secret label="Webhook signing secret" masked={f.webhook_secret_masked} value={f.webhook_secret ?? ""} onChange={(webhook_secret) => set({ webhook_secret })} />
        <Field label="Webhook URL" hint="Paste this into the Snippe dashboard, under Settings → Webhooks.">
          <div className="flex items-center gap-2"><code className="min-w-0 flex-1 truncate rounded-lg border bg-surface-2 px-3 py-2.5 text-sm">{f.webhook_url}</code><Button variant="secondary" onClick={() => copy(f.webhook_url)}><Copy />Copy</Button></div>
        </Field>
        <div className="grid gap-4 lg:grid-cols-2">
          <Field label="Payment expiry (hours)"><Input type="number" min={1} max={24} value={f.expiry_hours ?? 4} onChange={(e) => set({ expiry_hours: Number(e.target.value) })} /></Field>
          <Field label="Status check every (seconds)"><Input type="number" min={2} value={f.poll_seconds ?? 3} onChange={(e) => set({ poll_seconds: Number(e.target.value) })} /></Field>
        </div>
      </Section>
      <Section title="Hosted checkout (optional)" description="Snippe documents a JWT for sessions, not the API key. The test below shows whether your credential works. Until it passes, customers use USSD push.">
        <Field label="Default payment method"><Select value={f.default_method} onChange={(default_method) => set({ default_method })} options={[{ value: "ussd_push", label: "USSD push" }, { value: "hosted_checkout", label: "Hosted checkout" }, { value: "let_customer_choose", label: "Let customer choose" }]} /></Field>
        <Secret label="Session token (JWT)" masked={f.session_token_masked} value={f.session_token ?? ""} onChange={(session_token) => set({ session_token })} />
        <div className="grid gap-4 lg:grid-cols-2">
          <Field label="Profile id"><Input value={f.hosted_profile_id ?? ""} onChange={(e) => set({ hosted_profile_id: e.target.value })} /></Field>
          <Field label="Redirect URL"><Input type="url" value={f.redirect_url ?? ""} onChange={(e) => set({ redirect_url: e.target.value })} /></Field>
        </div>
      </Section>
      <div className="flex items-center gap-3"><Button loading={save.isPending} onClick={() => save.mutate()}>Save changes</Button><Last at={f.updated_at} name={f.updated_by_name} /></div>
      <Section title="Test configuration" description={f.last_tested_at ? `Last run ${dateTime(f.last_tested_at)}: ${f.last_test_status}` : "Save first, then run the test."}>
        <Diagnostics key={f.last_tested_at ?? "new"} steps={f.steps} endpoint={`${path}test/`} report={f.last_test_report} onDone={refresh} label="Test configuration" />
        <Switch label="Enable payments" description="Requires a passing test." checked={!!f.is_enabled} disabled={f.last_test_status !== "passed"} onChange={(v) => toggle.mutate(v)} />
      </Section>
      <Section title="Live test payment" description="Sends a real TZS 500 prompt to your own phone. This moves real money.">
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Your phone" className="min-w-52 flex-1"><PhoneInput value={phone} onChange={setPhone} /></Field>
          <Button loading={start.isPending} disabled={!phone} onClick={() => start.mutate()}><Send />Send TZS 500 prompt</Button>
        </div>
        {live && <p className={cn("flex items-center gap-2 text-sm", live.status === "completed" && "text-success", ["failed", "expired"].includes(live.status) && "text-danger")}>{live.status === "pending" && <Loader2 className="size-4 animate-spin" aria-hidden />}{live.status === "pending" ? "Waiting for you to approve…" : `Result: ${live.status}`}</p>}
      </Section>
    </div>
  );
}
function useToggle(path: string, refresh: () => void) {
  return useAction((is_enabled: boolean) => patch(path, { is_enabled }), { success: (r) => (r.is_enabled ? "Payments enabled" : "Payments disabled"), onSuccess: refresh });
}
function Storage() {
  const path = "/admin/settings/storage/";
  const { form: f, set, save, query } = useSettings<any>(path);
  const client = useQueryClient();
  if (!query.data) return <Skeleton className="h-96" />;
  const s3 = f.backend === "s3";
  const limits = f.max_upload_mb ?? {};
  return (
    <div className="space-y-4">
      <Section title="Where files live">
        <Field label="Storage backend"><Select value={f.backend} onChange={(backend) => set({ backend })} options={[{ value: "local", label: "Local disk (development)" }, { value: "s3", label: "Amazon S3" }]} /></Field>
        {s3 && (<>
          <div className="grid gap-4 lg:grid-cols-2">
            <Field label="Access key id"><Input value={f.aws_access_key_id ?? ""} autoComplete="off" onChange={(e) => set({ aws_access_key_id: e.target.value })} /></Field>
            <Secret label="Secret access key" masked={f.aws_secret_access_key_masked} value={f.aws_secret_access_key ?? ""} onChange={(aws_secret_access_key) => set({ aws_secret_access_key })} />
            <Field label="Region"><Input value={f.region ?? ""} onChange={(e) => set({ region: e.target.value })} /></Field>
            <Field label="Private bucket"><Input value={f.bucket ?? ""} onChange={(e) => set({ bucket: e.target.value })} /></Field>
            <Field label="Public bucket (optional)" hint="For covers and thumbnails"><Input value={f.public_bucket ?? ""} onChange={(e) => set({ public_bucket: e.target.value })} /></Field>
            <Field label="Key prefix"><Input value={f.key_prefix ?? ""} onChange={(e) => set({ key_prefix: e.target.value })} /></Field>
            <Field label="Custom endpoint" hint="For S3-compatible storage" className="lg:col-span-2"><Input type="url" value={f.endpoint_url ?? ""} onChange={(e) => set({ endpoint_url: e.target.value })} /></Field>
          </div>
        </>)}
      </Section>
      {s3 && (
        <Section title="CloudFront (recommended)" description="Faster delivery, with short-lived signed URLs for paid files.">
          <div className="grid gap-4 lg:grid-cols-2">
            <Field label="Distribution domain"><Input value={f.cloudfront_domain ?? ""} placeholder="d123.cloudfront.net" onChange={(e) => set({ cloudfront_domain: e.target.value })} /></Field>
            <Field label="Public key id"><Input value={f.cloudfront_key_pair_id ?? ""} onChange={(e) => set({ cloudfront_key_pair_id: e.target.value })} /></Field>
          </div>
          <Secret multiline label="Private key (PEM)" masked={f.cloudfront_private_key_masked} value={f.cloudfront_private_key ?? ""} onChange={(cloudfront_private_key) => set({ cloudfront_private_key })} />
        </Section>
      )}
      <Section title="Delivery & limits">
        <Field label="Signed URL lifetime (seconds)"><Input type="number" min={30} value={f.signed_url_ttl ?? 300} onChange={(e) => set({ signed_url_ttl: Number(e.target.value) })} /></Field>
        <div><div className="mb-2 text-[13px] font-medium">Maximum upload size (MB)</div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{Object.keys(limits).map((k) => <Field key={k} label={k.toUpperCase()}><Input type="number" min={1} value={limits[k]} onChange={(e) => set({ max_upload_mb: { ...limits, [k]: Number(e.target.value) } })} /></Field>)}</div></div>
      </Section>
      <Section title="Video transcoding">
        <Field label="Engine"><Select value={f.transcoding_engine} onChange={(transcoding_engine) => set({ transcoding_engine })} options={[{ value: "ffmpeg_worker", label: "FFmpeg worker" }, { value: "aws_mediaconvert", label: "AWS MediaConvert" }]} /></Field>
        {f.transcoding_engine === "aws_mediaconvert" && <div className="grid gap-4 lg:grid-cols-2">
          <Field label="Role ARN" className="lg:col-span-2"><Input value={f.mediaconvert_role_arn ?? ""} onChange={(e) => set({ mediaconvert_role_arn: e.target.value })} /></Field>
          <Field label="Region"><Input value={f.mediaconvert_region ?? ""} onChange={(e) => set({ mediaconvert_region: e.target.value })} /></Field>
          <Field label="Output preset"><Input value={f.mediaconvert_preset ?? ""} onChange={(e) => set({ mediaconvert_preset: e.target.value })} /></Field>
        </div>}
      </Section>
      <div className="flex items-center gap-3"><Button loading={save.isPending} onClick={() => save.mutate()}>Save changes</Button><Last at={f.updated_at} name={f.updated_by_name} /></div>
      <Section title="Test storage" description={f.last_tested_at ? `Last run ${dateTime(f.last_tested_at)}: ${f.last_test_status}` : "Save first, then run the test."}>
        <Diagnostics key={f.last_tested_at ?? "new"} steps={f.steps} endpoint={`${path}test/`} report={f.last_test_report} onDone={() => client.invalidateQueries({ queryKey: [path] })} label="Test storage" />
        {s3 && <div><div className="mb-1 flex items-center justify-between"><span className="text-[13px] font-medium">Bucket CORS configuration</span><Button size="sm" variant="ghost" onClick={() => copy(JSON.stringify(f.cors_json.CORSRules, null, 2))}><Copy />Copy</Button></div><pre className="overflow-x-auto rounded-lg bg-surface-2 p-3 text-xs">{JSON.stringify(f.cors_json.CORSRules, null, 2)}</pre></div>}
      </Section>
    </div>
  );
}
function Engagement() {
  const { form: f, set, save, query } = useSettings<any>("/admin/settings/site/");
  if (!query.data) return <Skeleton className="h-64" />;
  return (
    <div className="space-y-4">
      <Section title="Who can comment">
        <Field label="Guest comments"><Select value={f.guest_comment_policy} onChange={(guest_comment_policy) => set({ guest_comment_policy })} options={[{ value: "login_required", label: "Require login" }, { value: "guest_moderated", label: "Allow guests, hold for moderation" }, { value: "guest_open", label: "Allow guests, publish immediately" }]} /></Field>
        <Switch label="Moderate every comment" description="Nothing appears until you approve it." checked={!!f.moderate_all_comments} onChange={(moderate_all_comments) => set({ moderate_all_comments })} />
        <Switch label="Allow free sign up" description="Lets people create an account to comment." checked={!!f.allow_signup} onChange={(allow_signup) => set({ allow_signup })} />
      </Section>
      <Section title="Defaults for new content">
        {[["default_allow_comments", "Comments"], ["default_allow_reactions", "Reactions"], ["default_allow_bookmarks", "Bookmarks"], ["default_allow_download", "Downloads"], ["default_show_view_count", "Show view count"]].map(([k, label]) => <Switch key={k} label={label} checked={!!f[k]} onChange={(v) => set({ [k]: v })} />)}
      </Section>
      <div className="flex items-center gap-3"><Button loading={save.isPending} onClick={() => save.mutate()}>Save changes</Button><Last at={f.updated_at} name={f.updated_by_name} /></div>
    </div>
  );
}
type Template = { key: string; label: string; placeholders: string[]; subject_en: string; subject_sw: string; body_en: string; body_sw: string; is_enabled: boolean };
function Templates() {
  const key = "/admin/settings/notifications/templates/";
  const { data } = useQuery({ queryKey: [key], queryFn: () => api<Template[]>(key) });
  const [edit, setEdit] = useState<Template | null>(null);
  const save = useAction(() => patch(key, edit), { success: "Message saved", invalidate: [[key]], onSuccess: () => setEdit(null) });
  if (!data) return <Skeleton className="h-40" />;
  const up = (p: Partial<Template>) => setEdit((e) => (e ? { ...e, ...p } : e));
  return (
    <>
      <ul className="divide-y rounded-xl border">
        {data.map((row) => (
          <li key={row.key}><button type="button" data-template={row.key} onClick={() => setEdit(row)} className="flex min-h-14 w-full items-center gap-3 p-3 text-left hover:bg-surface-2">
            <span className="min-w-0 flex-1"><span className="block text-sm font-medium">{row.label}</span><span className="block truncate text-[13px] text-fg-3">{row.body_en}</span></span>
            {!row.is_enabled && <Badge>Off</Badge>}
          </button></li>
        ))}
      </ul>
      <Sheet open={!!edit} onOpenChange={(v) => { if (!v) setEdit(null); }} title={edit?.label ?? ""} size="lg" footer={<Button loading={save.isPending} onClick={() => save.mutate()}>Save message</Button>}>
        {edit && <div className="space-y-4">
          <Switch label="Send this message" checked={edit.is_enabled} onChange={(is_enabled) => up({ is_enabled })} />
          <div className="flex flex-wrap items-center gap-1.5 text-[13px] text-fg-2">Available:{edit.placeholders.map((p) => <code key={p} className="rounded bg-surface-2 px-1.5 py-0.5 text-xs">{`{${p}}`}</code>)}</div>
          <Field label="Email subject (English)"><Input value={edit.subject_en} onChange={(e) => up({ subject_en: e.target.value })} /></Field>
          <Field label="Message (English)" hint={`${edit.body_en.length} characters. One SMS holds 160.`}><Textarea rows={3} value={edit.body_en} onChange={(e) => up({ body_en: e.target.value })} /></Field>
          <Field label="Email subject (Kiswahili)"><Input value={edit.subject_sw} onChange={(e) => up({ subject_sw: e.target.value })} /></Field>
          <Field label="Message (Kiswahili)" hint={`${edit.body_sw.length} characters. One SMS holds 160.`}><Textarea rows={3} value={edit.body_sw} onChange={(e) => up({ body_sw: e.target.value })} /></Field>
        </div>}
      </Sheet>
    </>
  );
}
type LogRow = { id: string; created_at: string; channel: string; template: string; recipient_masked: string; status: string; provider: string; provider_response: string; attempts: number };
const LOG_TONE: Record<string, "success" | "danger" | "warning" | "neutral"> = { sent: "success", failed: "danger", queued: "warning" };
function NotificationLog() {
  const table = useTable<LogRow>("/admin/notification-logs/", { channel: "", status: "" }, { refetchInterval: 10000 });
  const columns: Column<LogRow>[] = [
    { key: "created_at", header: "Time", cell: (r) => <span className="whitespace-nowrap text-fg-2">{dateTime(r.created_at)}</span> },
    { key: "channel", header: "Channel", cell: (r) => <span className="uppercase">{r.channel}</span> },
    { key: "recipient", header: "To", cell: (r) => <span className="tabular-nums">{r.recipient_masked}</span> },
    { key: "template", header: "Message", cell: (r) => <span className="text-fg-2">{r.template.replace(/_/g, " ")}</span> },
    { key: "status", header: "Status", cell: (r) => <Badge tone={LOG_TONE[r.status] ?? "neutral"}>{r.status}</Badge> },
    { key: "response", header: "Provider response", mobile: false, cell: (r) => <span className="block max-w-72 truncate text-fg-2" title={r.provider_response}>{r.provider_response || "—"}</span> },
  ];
  return <DataTable columns={columns} rows={table.rows} rowId={(r) => r.id} loading={table.query.isLoading} total={table.total} page={table.page} totalPages={table.totalPages} onPage={table.setPage}
    filters={<>
      <Select label="Channel" className="w-32" placeholder="Channel" value={table.filters.channel} onChange={(v) => table.setFilter("channel", v)} options={[{ value: "", label: "All channels" }, { value: "sms", label: "SMS" }, { value: "email", label: "Email" }]} />
      <Select label="Status" className="w-32" placeholder="Status" value={table.filters.status} onChange={(v) => table.setFilter("status", v)} options={[{ value: "", label: "All statuses" }, { value: "sent", label: "Sent" }, { value: "failed", label: "Failed" }, { value: "queued", label: "Queued" }, { value: "skipped", label: "Skipped" }]} />
    </>}
    empty={{ icon: Bell, title: "Nothing sent yet", text: "Receipts, reminders and reset codes appear here." }} />;
}
function Notifications() {
  const path = "/admin/settings/notifications/";
  const test = `${path}test/`;
  const { form: f, set, save, query } = useSettings<any>(path);
  const client = useQueryClient();
  const refresh = () => client.invalidateQueries({ queryKey: [path] });
  const [smsTo, setSmsTo] = useState("");
  const [emailTo, setEmailTo] = useState("");
  const [headers, setHeaders] = useState<string | null>(null);
  const [badHeaders, setBadHeaders] = useState(false);
  if (!query.data) return <Skeleton className="h-96" />;
  const provider = f.sms_provider;
  const editHeaders = (text: string) => {
    setHeaders(text);
    try { const parsed = JSON.parse(text || "{}"); set({ generic_headers: parsed }); setBadHeaders(false); } catch { setBadHeaders(true); }
  };
  const saveRow = <div className="flex items-center gap-3"><Button loading={save.isPending} disabled={badHeaders} onClick={() => save.mutate()}>Save changes</Button><Last at={f.updated_at} name={f.updated_by_name} /></div>;
  return (
    <div className="space-y-4">
      <Section title="SMS" description={<>Receipts, reminders and password reset codes.<span className="mt-1.5 flex gap-1.5"><Badge tone={f.sms_ready ? "success" : "warning"}>{f.sms_ready ? "Sending" : "SMS off"}</Badge></span></>}>
        <Switch label="Send SMS" description="Password reset by SMS turns on with this." checked={!!f.sms_enabled} onChange={(sms_enabled) => set({ sms_enabled })} />
        <Field label="Provider"><Select label="Provider" value={provider} onChange={(sms_provider) => set({ sms_provider })} options={[{ value: "beem", label: "Beem Africa" }, { value: "africastalking", label: "Africa's Talking" }, { value: "generic", label: "Generic HTTP" }]} /></Field>
        <div className="grid gap-4 lg:grid-cols-2">
          {provider === "africastalking" && <Field label="Username" hint="Use sandbox for the Africa's Talking sandbox"><Input value={f.sms_username ?? ""} autoComplete="off" onChange={(e) => set({ sms_username: e.target.value })} /></Field>}
          <Secret label="API key" masked={f.sms_api_key_masked} value={f.sms_api_key ?? ""} onChange={(sms_api_key) => set({ sms_api_key })} />
          {provider !== "africastalking" && <Secret label="API secret" masked={f.sms_api_secret_masked} value={f.sms_api_secret ?? ""} onChange={(sms_api_secret) => set({ sms_api_secret })} />}
          <Field label="Sender ID" hint="Must be approved by your provider. At most 11 characters."><Input value={f.sms_sender_id ?? ""} onChange={(e) => set({ sms_sender_id: e.target.value })} /></Field>
          {provider !== "generic" && <Field label="API base URL (optional)" hint="Leave empty for the provider's live service"><Input type="url" value={f.sms_base_url ?? ""} onChange={(e) => set({ sms_base_url: e.target.value })} /></Field>}
        </div>
        {provider === "generic" && <div className="space-y-4 rounded-xl border p-3.5">
          <p className="text-[13px] text-fg-2">Fill-ins: <code>{"{to}"}</code> <code>{"{message}"}</code> <code>{"{sender}"}</code> <code>{"{api_key}"}</code> <code>{"{api_secret}"}</code>. Any 2xx reply counts as sent.</p>
          <div className="grid gap-4 lg:grid-cols-[1fr_8rem]">
            <Field label="Request URL"><Input value={f.generic_url ?? ""} placeholder="https://sms.example.com/send" onChange={(e) => set({ generic_url: e.target.value })} /></Field>
            <Field label="Method"><Select label="Method" value={f.generic_method ?? "POST"} onChange={(generic_method) => set({ generic_method })} options={["POST", "GET", "PUT"].map((value) => ({ value, label: value }))} /></Field>
          </div>
          <Field label="Headers (JSON)" error={badHeaders ? "This is not valid JSON." : undefined}><Textarea rows={3} spellCheck={false} className="font-mono text-[13px]" value={headers ?? JSON.stringify(f.generic_headers ?? {}, null, 2)} onChange={(e) => editHeaders(e.target.value)} /></Field>
          <Field label="Body template"><Textarea rows={3} spellCheck={false} className="font-mono text-[13px]" value={f.generic_body ?? ""} placeholder={'{"to": "{to}", "text": "{message}"}'} onChange={(e) => set({ generic_body: e.target.value })} /></Field>
        </div>}
        <Field label="Remind subscribers before the end (days)" className="max-w-xs"><Input type="number" min={1} max={30} value={f.reminder_days ?? 3} onChange={(e) => set({ reminder_days: Number(e.target.value) })} /></Field>
      </Section>
      <Section title="Email" description={<>Sent only to people who gave an address.<span className="mt-1.5 flex gap-1.5"><Badge tone={f.email_ready ? "success" : "warning"}>{f.email_ready ? "Sending" : "Email off"}</Badge></span></>}>
        <Switch label="Send email" checked={!!f.email_enabled} onChange={(email_enabled) => set({ email_enabled })} />
        <div className="grid gap-4 lg:grid-cols-2">
          <Field label="SMTP host"><Input value={f.smtp_host ?? ""} placeholder="smtp.example.com" onChange={(e) => set({ smtp_host: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Port"><Input type="number" value={f.smtp_port ?? 587} onChange={(e) => set({ smtp_port: Number(e.target.value) })} /></Field>
            <Field label="Security"><Select label="Security" value={f.smtp_security ?? "starttls"} onChange={(smtp_security) => set({ smtp_security })} options={[{ value: "starttls", label: "STARTTLS" }, { value: "ssl", label: "SSL/TLS" }, { value: "none", label: "None" }]} /></Field>
          </div>
          <Field label="Username"><Input value={f.smtp_username ?? ""} autoComplete="off" onChange={(e) => set({ smtp_username: e.target.value })} /></Field>
          <Secret label="Password" masked={f.smtp_password_masked} value={f.smtp_password ?? ""} onChange={(smtp_password) => set({ smtp_password })} />
          <Field label="From name"><Input value={f.email_from_name ?? ""} onChange={(e) => set({ email_from_name: e.target.value })} /></Field>
          <Field label="From address"><Input type="email" value={f.email_from_address ?? ""} onChange={(e) => set({ email_from_address: e.target.value })} /></Field>
        </div>
      </Section>
      {saveRow}
      <Section title="Test SMS" description={f.sms_tested_at ? `Last run ${dateTime(f.sms_tested_at)}: ${f.sms_test_status}` : "Save first, then send a real message to your own phone."}>
        <Field label="Send the test to" className="max-w-xs"><PhoneInput value={smsTo} onChange={setSmsTo} name="sms-test-to" /></Field>
        <Diagnostics key={f.sms_tested_at ?? "new"} steps={f.steps.sms} endpoint={test} report={f.sms_test_report} extra={{ channel: "sms", to: smsTo }} disabled={!smsTo} onDone={refresh} label="Send test SMS" />
      </Section>
      <Section title="Test email" description={f.email_tested_at ? `Last run ${dateTime(f.email_tested_at)}: ${f.email_test_status}` : "Save first, then send a real message to your own address."}>
        <Field label="Send the test to" className="max-w-xs"><Input type="email" value={emailTo} onChange={(e) => setEmailTo(e.target.value)} /></Field>
        <Diagnostics key={f.email_tested_at ?? "new"} steps={f.steps.email} endpoint={test} report={f.email_test_report} extra={{ channel: "email", to: emailTo }} disabled={!emailTo} onDone={refresh} label="Send test email" />
      </Section>
      <Section title="Messages" description="Each message has an English and a Kiswahili version. People get the one matching their language."><Templates /></Section>
      <Section title="Notification log" description="The last messages. Recipients are masked, and message text is not kept."><NotificationLog /></Section>
    </div>
  );
}
function Admins() {
  const { data } = useQuery({ queryKey: ["staff"], queryFn: async () => { const [a, e] = await Promise.all([api("/admin/users/?role=admin"), api("/admin/users/?role=editor")]); return [...a.results, ...e.results]; } });
  return (
    <Section title="Admins & editors" description="Admins can do everything. Editors manage content, media and comments, and never see money or settings. This is enforced by the API, not only the interface.">
      {!data ? <Skeleton className="h-32" /> : (
        <ul className="divide-y">
          {data.map((u: any) => <li key={u.id}><Link href={`/admin/users/${u.id}`} spinner="none" className="flex min-h-12 items-center gap-3 text-sm hover:text-primary-ink"><Users className="size-4 text-fg-3" aria-hidden /><span className="min-w-0 flex-1 truncate">{u.first_name} {u.last_name} · {formatPhone(u.phone)}</span><Badge tone="primary">{u.role}</Badge></Link></li>)}
        </ul>
      )}
      <Button asChild variant="secondary"><Link href="/admin/users">Manage users</Link></Button>
    </Section>
  );
}
export function Settings({ section }: { section: string }) {
  const View = { general: General, announcements: Announcements, payments: Payments, storage: Storage, engagement: Engagement, notifications: Notifications, admins: Admins }[section]!;
  return (
    <>
      <PageHeader title="Settings" />
      <div className="md:grid md:grid-cols-[210px_minmax(0,1fr)] md:gap-6">
        <nav aria-label="Settings" className="scroll-x -mx-4 mb-4 flex gap-1 px-4 md:mx-0 md:block md:space-y-0.5 md:px-0">
          {SECTIONS.map(({ key, label, icon: Icon }) => (
            <Link key={key} href={`/admin/settings/${key}`} spinner="none" aria-current={key === section ? "page" : undefined} className={cn("flex h-9 shrink-0 items-center gap-2 rounded-md px-2.5 text-sm font-medium text-fg-2 hover:text-fg", key === section && "bg-primary-soft text-primary-ink hover:text-primary-ink")}>
              <Icon className="size-4" aria-hidden />{label}
            </Link>
          ))}
        </nav>
        <div className="min-w-0"><View /></div>
      </div>
    </>
  );
}
