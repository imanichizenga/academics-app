"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Globe, KeyRound, LogOut, Mail, MessageCircle, Moon, Phone, ShieldCheck } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, Skeleton } from "@/components/ui/display";
import { Field, Input, PasswordInput, PhoneInput, Select } from "@/components/ui/form";
import { Link } from "@/components/ui/link";
import { ConfirmSheet } from "@/components/ui/overlay";
import { ApiError, api, patch, post } from "@/lib/api";
import { logout, useAction, useSession, useSite, useT } from "@/lib/providers";
import { formatPhone, normalizePhone, whatsappLink } from "@/lib/utils";
import { ThemeToggle } from "./shell";

function Shell({ title, text, children }: { title: string; text?: ReactNode; children: ReactNode }) {
  return (
    <div className="pb-tabbar mx-auto max-w-sm px-4 pt-10 md:pt-20">
      <h1 className="text-[26px] font-semibold tracking-tight">{title}</h1>
      {text && <p className="mt-1 text-sm text-fg-2">{text}</p>}
      <div className="mt-6">{children}</div>
    </div>
  );
}
/** Relative paths only: "//evil.com" and "/\\evil.com" both leave the site in a browser. */
export const safeNext = (next: string | null) => (next && /^\/(?![/\\])/.test(next) && !/[\s\\]/.test(next) ? next : null);

export function Login() {
  const site = useSite();
  const { t } = useT();
  const params = useSearchParams();
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const schema = z.object({ phone: z.string().refine((v) => normalizePhone(v), t.common.enterPhone), password: z.string().min(1, t.common.enterPassword) });
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { phone: "", password: "" } });
  const next = safeNext(params.get("next"));
  const submit = form.handleSubmit(async (v) => {
    setBusy(true);
    try {
      const { user } = await post("/auth/login/", { ...v, phone: normalizePhone(v.phone) });
      client.setQueryData(["session"], { user });
      location.href = user.must_change_password ? `/change-password?forced=1${next ? `&next=${encodeURIComponent(next)}` : ""}` : next ?? (user.role === "student" ? "/library" : "/admin");
    } catch (e) { form.setError("password", { message: (e as ApiError).message }); setBusy(false); }
  });
  return (
    <Shell title={t.auth.welcome} text={t.auth.welcomeText}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label={t.common.phoneNumber} error={form.formState.errors.phone?.message}><Controller control={form.control} name="phone" render={({ field }) => <PhoneInput {...field} invalid={!!form.formState.errors.phone} />} /></Field>
        <Field label={t.common.password} error={form.formState.errors.password?.message}><PasswordInput autoComplete="current-password" invalid={!!form.formState.errors.password} {...form.register("password")} /></Field>
        <Button type="submit" size="lg" className="w-full" loading={busy}>{t.common.logIn}</Button>
      </form>
      <div className="mt-4 flex justify-between text-sm"><Link href="/forgot" className="text-fg-2 hover:text-fg">{t.auth.forgot}</Link>{site.allow_signup && <Link href="/signup" className="font-medium text-primary-ink">{t.auth.create}</Link>}</div>
    </Shell>
  );
}
export function Signup() {
  const { t } = useT();
  const [busy, setBusy] = useState(false);
  const schema = z.object({ phone: z.string().refine((v) => normalizePhone(v), t.common.enterPhone), first_name: z.string().min(1, t.common.required), last_name: z.string().min(1, t.common.required), password: z.string().min(8, t.common.min8) });
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { phone: "", first_name: "", last_name: "", password: "" } });
  const { errors } = form.formState;
  const submit = form.handleSubmit(async (v) => {
    setBusy(true);
    try { await post("/auth/register/", { ...v, phone: normalizePhone(v.phone) }); location.href = "/"; }
    catch (e) { const error = e as ApiError; toast.error(error.message); Object.entries(error.fields).forEach(([k, m]) => form.setError(k as "phone", { message: m })); setBusy(false); }
  });
  return (
    <Shell title={t.auth.createTitle} text={t.auth.createText}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label={t.common.phoneNumber} error={errors.phone?.message}><Controller control={form.control} name="phone" render={({ field }) => <PhoneInput {...field} invalid={!!errors.phone} />} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t.common.firstName} error={errors.first_name?.message}><Input {...form.register("first_name")} /></Field>
          <Field label={t.common.lastName} error={errors.last_name?.message}><Input {...form.register("last_name")} /></Field>
        </div>
        <Field label={t.common.password} error={errors.password?.message}><PasswordInput autoComplete="new-password" {...form.register("password")} /></Field>
        <Button type="submit" size="lg" className="w-full" loading={busy}>{t.auth.create}</Button>
      </form>
    </Shell>
  );
}
function TeacherContacts() {
  const site = useSite();
  const { t } = useT();
  const rows = [
    site.contact_phone && { icon: Phone, label: `${t.auth.phoneLabel}: ${site.contact_phone}`, href: `tel:${site.contact_phone.replace(/\s/g, "")}` },
    site.contact_whatsapp && { icon: MessageCircle, label: t.auth.whatsapp, href: whatsappLink(site.contact_whatsapp) },
    site.contact_email && { icon: Mail, label: site.contact_email, href: `mailto:${site.contact_email}` },
  ].filter(Boolean) as { icon: typeof Phone; label: string; href: string }[];
  if (!rows.length) return null;
  return <Card className="divide-y px-4">{rows.map(({ icon: Icon, label, href }) => <a key={href} href={href} className="flex min-h-12 items-center gap-3 text-sm font-medium"><Icon className="size-4 shrink-0 text-fg-3" aria-hidden /><span className="min-w-0 truncate">{label}</span></a>)}</Card>;
}
export function Forgot() {
  const { t } = useT();
  const { data } = useQuery({ queryKey: ["otp"], queryFn: () => api<{ available: boolean }>("/auth/otp/request/") });
  const [phone, setPhone] = useState("");
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const send = useAction(() => post("/auth/otp/request/", { phone: normalizePhone(phone) }), { onSuccess: () => setSent(true) });
  const confirm = useAction(() => post("/auth/otp/confirm/", { phone: normalizePhone(phone), code, new_password: password }), { success: t.auth.resetDone, onSuccess: () => { location.href = "/login"; } });
  if (!data) return <Shell title={t.auth.forgotTitle}><Skeleton className="h-40" /></Shell>;
  if (!data.available) return (
    <Shell title={t.auth.forgotTitle} text={t.auth.forgotText}>
      <TeacherContacts />
      <Button asChild variant="secondary" className="mt-4 w-full"><Link href="/login">{t.auth.backToLogin}</Link></Button>
    </Shell>
  );
  return (
    <Shell title={t.auth.resetTitle} text={t.auth.resetText}>
      <div className="space-y-4">
        <Field label={t.common.phoneNumber}><PhoneInput value={phone} onChange={setPhone} disabled={sent} /></Field>
        {sent ? (<>
          <Field label={t.auth.codeLabel}><Input inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} /></Field>
          <Field label={t.auth.newPassword}><PasswordInput autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
          <Button size="lg" className="w-full" loading={confirm.isPending} onClick={() => confirm.mutate()}>{t.auth.changePassword}</Button>
        </>) : <Button size="lg" className="w-full" loading={send.isPending} disabled={!normalizePhone(phone)} onClick={() => send.mutate()}>{t.auth.sendCode}</Button>}
      </div>
    </Shell>
  );
}
export function ChangePassword() {
  const { user, loading } = useSession();
  const { t } = useT();
  const params = useSearchParams();
  const router = useRouter();
  const client = useQueryClient();
  const forced = params.get("forced") || user?.must_change_password;
  const [busy, setBusy] = useState(false);
  const schema = z.object({ current_password: z.string(), new_password: z.string().min(8, t.common.min8), confirm: z.string() }).refine((v) => v.new_password === v.confirm, { path: ["confirm"], message: t.common.mismatch });
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { current_password: "", new_password: "", confirm: "" } });
  const { errors } = form.formState;
  useEffect(() => { if (!loading && !user) router.replace("/login"); }, [loading, user, router]);
  const submit = form.handleSubmit(async (v) => {
    setBusy(true);
    try {
      const { user: updated } = await post("/auth/change-password/", v);
      client.setQueryData(["session"], { user: updated });
      toast.success(t.auth.changed);
      router.push(safeNext(params.get("next")) ?? (updated.role === "student" ? "/library" : "/admin"));
    } catch (e) {
      const error = e as ApiError;
      Object.entries(error.fields).forEach(([k, m]) => form.setError(k as "new_password", { message: m }));
      if (!Object.keys(error.fields).length) toast.error(error.message);
      setBusy(false);
    }
  });
  return (
    <Shell title={forced ? t.auth.setOwn : t.auth.changePassword} text={forced ? t.auth.setOwnText : undefined}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        {!user?.must_change_password && <Field label={t.auth.current} error={errors.current_password?.message}><PasswordInput autoComplete="current-password" {...form.register("current_password")} /></Field>}
        <Field label={t.auth.newPassword} error={errors.new_password?.message} hint={t.auth.newHint}><PasswordInput autoComplete="new-password" invalid={!!errors.new_password} {...form.register("new_password")} /></Field>
        <Field label={t.auth.confirm} error={errors.confirm?.message}><PasswordInput autoComplete="new-password" invalid={!!errors.confirm} {...form.register("confirm")} /></Field>
        <Button type="submit" size="lg" className="w-full" loading={busy}>{t.auth.savePassword}</Button>
      </form>
    </Shell>
  );
}
export function Account() {
  const { user, loading } = useSession();
  const { t, lang, setLang } = useT();
  const router = useRouter();
  const client = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const schema = z.object({ first_name: z.string().min(1, t.common.required), last_name: z.string().min(1, t.common.required), email: z.string().email(t.common.validEmail).or(z.literal("")) });
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), values: { first_name: user?.first_name ?? "", last_name: user?.last_name ?? "", email: user?.email ?? "" } });
  const save = useAction((v: z.infer<typeof schema>) => patch("/auth/me/", v), { success: t.auth.profileSaved, invalidate: [["session"]] });
  useEffect(() => { if (!loading && !user) router.replace("/login?next=/account"); }, [loading, user, router]);
  if (!user) return <div className="mx-auto max-w-xl px-4 pt-8"><Skeleton className="h-64" /></div>;
  const { errors } = form.formState;
  return (
    <div className="pb-tabbar mx-auto max-w-xl space-y-4 px-4 pt-5 md:pt-8">
      <h1 className="text-[26px] font-semibold tracking-tight md:text-3xl">{t.nav.account}</h1>
      <Card className="p-4">
        <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className="space-y-4" noValidate>
          <Field label={t.common.phoneNumber} hint={t.auth.usernameHint}><Input value={formatPhone(user.phone)} disabled /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t.common.firstName} error={errors.first_name?.message}><Input {...form.register("first_name")} /></Field>
            <Field label={t.common.lastName} error={errors.last_name?.message}><Input {...form.register("last_name")} /></Field>
          </div>
          <Field label={t.common.email} error={errors.email?.message}><Input type="email" {...form.register("email")} /></Field>
          <Button type="submit" loading={save.isPending}>{t.auth.saveChanges}</Button>
        </form>
      </Card>
      <Card className="divide-y">
        <Link href="/change-password" spinner="inline" className="flex min-h-12 items-center gap-3 px-4 text-sm font-medium"><KeyRound className="size-4 text-fg-3" aria-hidden />{t.auth.changePassword}</Link>
        <div className="flex min-h-12 items-center gap-3 px-4 text-sm font-medium"><Globe className="size-4 text-fg-3" aria-hidden />{t.common.language}<div className="ml-auto w-36"><Select label={t.common.language} value={lang} onChange={(v) => setLang(v as "en" | "sw")} options={[{ value: "en", label: "English" }, { value: "sw", label: "Kiswahili" }]} /></div></div>
        <div className="flex min-h-12 items-center gap-3 px-4 text-sm font-medium"><Moon className="size-4 text-fg-3" aria-hidden />{t.common.appearance}<div className="ml-auto"><ThemeToggle /></div></div>
        <button onClick={() => setConfirm(true)} className="flex min-h-12 w-full items-center gap-3 px-4 text-sm font-medium"><ShieldCheck className="size-4 text-fg-3" aria-hidden />{t.auth.logoutAll}</button>
        <button onClick={() => { setLeaving(true); logout(client); }} disabled={leaving} className="flex min-h-12 w-full items-center gap-3 px-4 text-sm font-medium text-danger"><LogOut className="size-4" aria-hidden />{t.common.logOut}</button>
      </Card>
      <ConfirmSheet open={confirm} onOpenChange={setConfirm} title={t.auth.logoutAllTitle} text={t.auth.logoutAllText} confirmLabel={t.auth.logoutAllConfirm} danger loading={leaving} onConfirm={() => { setLeaving(true); logout(client, true); }} />
    </div>
  );
}
