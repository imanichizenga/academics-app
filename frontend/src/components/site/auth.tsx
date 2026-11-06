"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, LogOut, Moon, ShieldCheck } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, Skeleton } from "@/components/ui/display";
import { Field, Input, PhoneInput } from "@/components/ui/form";
import { Link } from "@/components/ui/link";
import { ConfirmSheet } from "@/components/ui/overlay";
import { ApiError, api, patch, post } from "@/lib/api";
import { logout, useAction, useSession, useSite } from "@/lib/providers";
import { normalizePhone } from "@/lib/utils";
import { ThemeToggle } from "./shell";

const phoneRule = z.string().refine((v) => normalizePhone(v), "Enter a Tanzanian mobile number");

function Shell({ title, text, children }: { title: string; text?: ReactNode; children: ReactNode }) {
  return (
    <div className="pb-tabbar mx-auto max-w-sm px-4 pt-10 md:pt-20">
      <h1 className="text-[26px] font-semibold tracking-tight">{title}</h1>
      {text && <p className="mt-1 text-sm text-fg-2">{text}</p>}
      <div className="mt-6">{children}</div>
    </div>
  );
}
const safeNext = (next: string | null) => (next && next.startsWith("/") && !next.startsWith("//") ? next : null);

export function Login() {
  const site = useSite();
  const params = useSearchParams();
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const schema = z.object({ phone: phoneRule, password: z.string().min(1, "Enter your password") });
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { phone: "", password: "" } });
  const submit = form.handleSubmit(async (v) => {
    setBusy(true);
    try {
      const { user } = await post("/auth/login/", { ...v, phone: normalizePhone(v.phone) });
      client.setQueryData(["session"], { user });
      location.href = user.must_change_password ? "/change-password?forced=1" : safeNext(params.get("next")) ?? (user.role === "student" ? "/library" : "/admin");
    } catch (e) { form.setError("password", { message: (e as ApiError).message }); setBusy(false); }
  });
  return (
    <Shell title="Welcome back" text="Log in with the phone number you used to pay.">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Phone number" error={form.formState.errors.phone?.message}><Controller control={form.control} name="phone" render={({ field }) => <PhoneInput {...field} invalid={!!form.formState.errors.phone} />} /></Field>
        <Field label="Password" error={form.formState.errors.password?.message}><Input type="password" autoComplete="current-password" invalid={!!form.formState.errors.password} {...form.register("password")} /></Field>
        <Button type="submit" size="lg" className="w-full" loading={busy}>Log in</Button>
      </form>
      <div className="mt-4 flex justify-between text-sm"><Link href="/forgot" className="text-fg-2 hover:text-fg">Forgot password?</Link>{site.allow_signup && <Link href="/signup" className="font-medium text-primary-ink">Create account</Link>}</div>
    </Shell>
  );
}
export function Signup() {
  const [busy, setBusy] = useState(false);
  const schema = z.object({ phone: phoneRule, first_name: z.string().min(1, "Required"), last_name: z.string().min(1, "Required"), password: z.string().min(8, "Use at least 8 characters") });
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { phone: "", first_name: "", last_name: "", password: "" } });
  const { errors } = form.formState;
  const submit = form.handleSubmit(async (v) => {
    setBusy(true);
    try { await post("/auth/register/", { ...v, phone: normalizePhone(v.phone) }); location.href = "/"; }
    catch (e) { const error = e as ApiError; toast.error(error.message); Object.entries(error.fields).forEach(([k, m]) => form.setError(k as "phone", { message: m })); setBusy(false); }
  });
  return (
    <Shell title="Create an account" text="You only need one to comment and save lessons. Free lessons are open to everyone.">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Phone number" error={errors.phone?.message}><Controller control={form.control} name="phone" render={({ field }) => <PhoneInput {...field} invalid={!!errors.phone} />} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="First name" error={errors.first_name?.message}><Input {...form.register("first_name")} /></Field>
          <Field label="Last name" error={errors.last_name?.message}><Input {...form.register("last_name")} /></Field>
        </div>
        <Field label="Password" error={errors.password?.message}><Input type="password" autoComplete="new-password" {...form.register("password")} /></Field>
        <Button type="submit" size="lg" className="w-full" loading={busy}>Create account</Button>
      </form>
    </Shell>
  );
}
export function Forgot() {
  const site = useSite();
  const { data } = useQuery({ queryKey: ["otp"], queryFn: () => api<{ available: boolean }>("/auth/otp/request/") });
  const [phone, setPhone] = useState("");
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const send = useAction(() => post("/auth/otp/request/", { phone: normalizePhone(phone) }), { onSuccess: () => setSent(true) });
  const confirm = useAction(() => post("/auth/otp/confirm/", { phone: normalizePhone(phone), code, new_password: password }), { success: "Password changed. Please log in.", onSuccess: () => { location.href = "/login"; } });
  if (!data?.available) return (
    <Shell title="Forgot your password?" text="Your teacher can reset it for you. Contact them with the phone number on your account.">
      <Card className="space-y-1 p-4 text-sm">{site.contact_phone && <div>Phone: <strong>{site.contact_phone}</strong></div>}{site.contact_email && <div>Email: <strong>{site.contact_email}</strong></div>}</Card>
      <Button asChild variant="secondary" className="mt-4 w-full"><Link href="/login">Back to log in</Link></Button>
    </Shell>
  );
  return (
    <Shell title="Reset your password">
      <div className="space-y-4">
        <Field label="Phone number"><PhoneInput value={phone} onChange={setPhone} disabled={sent} /></Field>
        {sent ? (<>
          <Field label="Code from SMS"><Input inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} /></Field>
          <Field label="New password"><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
          <Button size="lg" className="w-full" loading={confirm.isPending} onClick={() => confirm.mutate()}>Change password</Button>
        </>) : <Button size="lg" className="w-full" loading={send.isPending} disabled={!normalizePhone(phone)} onClick={() => send.mutate()}>Send code</Button>}
      </div>
    </Shell>
  );
}
export function ChangePassword() {
  const { user, loading } = useSession();
  const params = useSearchParams();
  const router = useRouter();
  const client = useQueryClient();
  const forced = params.get("forced") || user?.must_change_password;
  const [busy, setBusy] = useState(false);
  const schema = z.object({ current_password: z.string(), new_password: z.string().min(8, "Use at least 8 characters"), confirm: z.string() }).refine((v) => v.new_password === v.confirm, { path: ["confirm"], message: "The passwords do not match" });
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { current_password: "", new_password: "", confirm: "" } });
  const { errors } = form.formState;
  useEffect(() => { if (!loading && !user) router.replace("/login"); }, [loading, user, router]);
  const submit = form.handleSubmit(async (v) => {
    setBusy(true);
    try {
      const { user: updated } = await post("/auth/change-password/", v);
      client.setQueryData(["session"], { user: updated });
      toast.success("Password changed");
      router.push(updated.role === "student" ? "/library" : "/admin");
    } catch (e) {
      const error = e as ApiError;
      Object.entries(error.fields).forEach(([k, m]) => form.setError(k as "new_password", { message: m }));
      if (!Object.keys(error.fields).length) toast.error(error.message);
      setBusy(false);
    }
  });
  return (
    <Shell title={forced ? "Set your own password" : "Change password"} text={forced ? "Your password is still your phone number. Choose a private one to keep your lessons safe." : undefined}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        {!user?.must_change_password && <Field label="Current password" error={errors.current_password?.message}><Input type="password" autoComplete="current-password" {...form.register("current_password")} /></Field>}
        <Field label="New password" error={errors.new_password?.message} hint="At least 8 characters, not only numbers"><Input type="password" autoComplete="new-password" invalid={!!errors.new_password} {...form.register("new_password")} /></Field>
        <Field label="Confirm new password" error={errors.confirm?.message}><Input type="password" autoComplete="new-password" invalid={!!errors.confirm} {...form.register("confirm")} /></Field>
        <Button type="submit" size="lg" className="w-full" loading={busy}>Save password</Button>
      </form>
    </Shell>
  );
}
export function Account() {
  const { user, loading } = useSession();
  const router = useRouter();
  const client = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const schema = z.object({ first_name: z.string().min(1, "Required"), last_name: z.string().min(1, "Required"), email: z.string().email("Enter a valid email").or(z.literal("")) });
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), values: { first_name: user?.first_name ?? "", last_name: user?.last_name ?? "", email: user?.email ?? "" } });
  const save = useAction((v: z.infer<typeof schema>) => patch("/auth/me/", v), { success: "Profile saved", invalidate: [["session"]] });
  useEffect(() => { if (!loading && !user) router.replace("/login?next=/account"); }, [loading, user, router]);
  if (!user) return <div className="mx-auto max-w-xl px-4 pt-8"><Skeleton className="h-64" /></div>;
  const { errors } = form.formState;
  return (
    <div className="pb-tabbar mx-auto max-w-xl space-y-4 px-4 pt-5 md:pt-8">
      <h1 className="text-[26px] font-semibold tracking-tight md:text-3xl">Account</h1>
      <Card className="p-4">
        <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className="space-y-4" noValidate>
          <Field label="Phone number" hint="This is your username"><Input value={user.phone} disabled /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="First name" error={errors.first_name?.message}><Input {...form.register("first_name")} /></Field>
            <Field label="Last name" error={errors.last_name?.message}><Input {...form.register("last_name")} /></Field>
          </div>
          <Field label="Email" error={errors.email?.message}><Input type="email" {...form.register("email")} /></Field>
          <Button type="submit" loading={save.isPending}>Save changes</Button>
        </form>
      </Card>
      <Card className="divide-y">
        <Link href="/change-password" spinner="inline" className="flex min-h-12 items-center gap-3 px-4 text-sm font-medium"><KeyRound className="size-4 text-fg-3" aria-hidden />Change password</Link>
        <div className="flex min-h-12 items-center gap-3 px-4 text-sm font-medium"><Moon className="size-4 text-fg-3" aria-hidden />Appearance<div className="ml-auto"><ThemeToggle /></div></div>
        <button onClick={() => setConfirm(true)} className="flex min-h-12 w-full items-center gap-3 px-4 text-sm font-medium"><ShieldCheck className="size-4 text-fg-3" aria-hidden />Log out of all devices</button>
        <button onClick={() => { setLeaving(true); logout(client); }} disabled={leaving} className="flex min-h-12 w-full items-center gap-3 px-4 text-sm font-medium text-danger"><LogOut className="size-4" aria-hidden />Log out</button>
      </Card>
      <ConfirmSheet open={confirm} onOpenChange={setConfirm} title="Log out everywhere?" text="You will need to log in again on every device, including this one." confirmLabel="Log out everywhere" danger loading={leaving} onConfirm={() => { setLeaving(true); logout(client, true); }} />
    </div>
  );
}
