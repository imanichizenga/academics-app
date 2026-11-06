"use client";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, BookOpen, Compass, CreditCard, Globe, Home, KeyRound, LayoutDashboard, LogIn, LogOut, Moon, Search, Sun, TriangleAlert, User, X } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { LogoMark } from "@/components/ui/app-loader";
import { Button, IconButton } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Avatar, Dropdown, DropdownContent, DropdownItem, DropdownSeparator, DropdownTrigger } from "@/components/ui/display";
import { Link } from "@/components/ui/link";
import { logout, useSession, useSite, useT } from "@/lib/providers";
import { post } from "@/lib/api";
import { cn, formatPhone, localPhone } from "@/lib/utils";

const LANGUAGES = [{ value: "en", label: "English" }, { value: "sw", label: "Kiswahili" }] as const;
const isActive = (path: string, href: string) => (href === "/" ? path === "/" : path.startsWith(href));

export function LanguageMenu() {
  const { t, lang, setLang } = useT();
  return (
    <Dropdown>
      <DropdownTrigger asChild><IconButton label={t.common.language}><Globe /></IconButton></DropdownTrigger>
      <DropdownContent>
        {LANGUAGES.map((l) => <DropdownItem key={l.value} onSelect={() => setLang(l.value)}><span className={cn(lang === l.value && "font-semibold text-primary-ink")}>{l.label}</span></DropdownItem>)}
      </DropdownContent>
    </Dropdown>
  );
}

export function ThemeToggle() {
  const { t } = useT();
  const [dark, setDark] = useState(false);
  useEffect(() => setDark(document.documentElement.classList.contains("dark")), []);
  const flip = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try { localStorage.setItem("theme", next ? "dark" : "light"); } catch {}
  };
  return <IconButton label={dark ? t.common.lightMode : t.common.darkMode} onClick={flip}>{dark ? <Sun /> : <Moon />}</IconButton>;
}

function AccountMenu() {
  const { user, loading } = useSession();
  const router = useRouter();
  const client = useQueryClient();
  const { t } = useT();
  if (loading) return <div className="size-10" />;
  if (!user) return <Button asChild size="md" variant="secondary"><Link href="/login"><LogIn />{t.common.logIn}</Link></Button>;
  const name = `${user.first_name} ${user.last_name}`.trim() || formatPhone(user.phone);
  return (
    <Dropdown>
      <DropdownTrigger aria-label={t.nav.accountMenu} className="rounded-full"><Avatar name={name} /></DropdownTrigger>
      <DropdownContent className="w-56">
        <div className="px-2.5 py-2"><div className="truncate text-sm font-medium">{name}</div><div className="text-[13px] tabular-nums text-fg-3">{formatPhone(user.phone)}</div></div>
        <DropdownSeparator />
        {user.role !== "student" && <DropdownItem onSelect={() => router.push("/admin")}><LayoutDashboard />{t.nav.adminPanel}</DropdownItem>}
        <DropdownItem onSelect={() => router.push("/library")}><BookOpen />{t.nav.myLearning}</DropdownItem>
        <DropdownItem onSelect={() => router.push("/account")}><User />{t.nav.account}</DropdownItem>
        <DropdownSeparator />
        <DropdownItem onSelect={() => logout(client)}><LogOut />{t.common.logOut}</DropdownItem>
      </DropdownContent>
    </Dropdown>
  );
}

function Brand({ compact }: { compact?: boolean }) {
  const site = useSite();
  return (
    <Link href="/" spinner="none" className="flex min-w-0 shrink-0 items-center gap-2 font-semibold tracking-tight">
      <LogoMark logo={site.logo_url} className="size-8 shrink-0" />
      <span className={cn("truncate", compact ? "text-[17px]" : "text-base")}>{site.site_name}</span>
    </Link>
  );
}

export function SiteHeader() {
  const path = usePathname();
  const router = useRouter();
  const { t } = useT();
  const nested = /^\/(content|checkout|change-password|pricing|signup|forgot|library\/receipts)/.test(path);
  const links = [{ href: "/", label: t.nav.home }, { href: "/explore", label: t.nav.explore }, { href: "/pricing", label: t.nav.pricing }, { href: "/library", label: t.nav.myLearning }];
  return (
    <header className="safe-top sticky top-0 z-30 border-b bg-bg/85 backdrop-blur-xl">
      <div className="mx-auto hidden h-16 max-w-6xl items-center gap-4 px-6 md:flex lg:gap-8">
        <Brand />
        <nav aria-label={t.nav.main} className="flex items-center gap-1">
          {links.map((n) => (
            <Link key={n.href} href={n.href} aria-current={isActive(path, n.href) ? "page" : undefined}
              className={cn("whitespace-nowrap rounded-md px-2 py-2 text-sm font-medium text-fg-2 hover:text-fg lg:px-3", isActive(path, n.href) && "text-fg")}>{n.label}</Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-1">
          <IconButton label={t.common.search} onClick={() => router.push("/explore?focus=1")}><Search /></IconButton>
          <LanguageMenu />
          <ThemeToggle />
          <div className="ml-2"><AccountMenu /></div>
        </div>
      </div>
      <div className="flex h-14 items-center gap-1 px-2 md:hidden">
        {nested ? (
          <IconButton label={t.common.goBack} onClick={() => (history.length > 1 ? router.back() : router.push("/"))}><ArrowLeft /></IconButton>
        ) : <div className="pl-2"><Brand compact /></div>}
        <div className="ml-auto flex items-center">
          <IconButton label={t.common.search} onClick={() => router.push("/explore?focus=1")}><Search /></IconButton>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}

export function BottomTabs() {
  const path = usePathname();
  const { t } = useT();
  const tabs = [{ href: "/", label: t.nav.home, icon: Home }, { href: "/explore", label: t.nav.explore, icon: Compass }, { href: "/library", label: t.nav.library, icon: BookOpen }, { href: "/account", label: t.nav.account, icon: User }];
  return (
    <nav aria-label={t.nav.primary} className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t bg-bg/90 backdrop-blur-xl md:hidden">
      <ul className="grid h-[60px] grid-cols-4">
        {tabs.map(({ href, label, icon: Icon }) => {
          const active = isActive(path, href);
          return (
            <li key={href}>
              <Link href={href} spinner="none" aria-current={active ? "page" : undefined}
                className={cn("flex h-full flex-col items-center justify-center gap-0.5 text-[11px] font-medium text-fg-3", active && "text-primary-ink")}>
                <Icon className="size-[22px]" strokeWidth={active ? 2.3 : 1.8} aria-hidden />{label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function SessionBanners() {
  const { user, viewingAs } = useSession();
  const site = useSite();
  const { t } = useT();
  const path = usePathname();
  const [dismissed, setDismissed] = useState(true);
  useEffect(() => { try { setDismissed(sessionStorage.getItem("pwd-banner") === "off"); } catch { setDismissed(false); } }, []);
  const maintenance = site.maintenance_mode && user && user.role !== "student" && (
    <div data-testid="maintenance-banner" className="no-print flex items-center justify-center gap-2 bg-warning-soft px-4 py-2 text-center text-[13px] font-medium text-warning"><TriangleAlert className="size-4 shrink-0" aria-hidden />{t.banner.maintenance}</div>
  );
  if (viewingAs) {
    return (
      <div className="no-print flex items-center justify-center gap-3 bg-warning-soft px-4 py-2 text-[13px] font-medium text-warning">
        {t.banner.viewingAs(user?.first_name ?? "")}
        <button className="underline" onClick={() => post("/auth/impersonate/stop/").finally(() => { location.href = "/admin/users"; })}>{t.banner.stop}</button>
      </div>
    );
  }
  if (!user?.must_change_password || dismissed || path === "/change-password") return maintenance || null;
  return (
    <>
      {maintenance}
      <div data-testid="password-banner" className="no-print flex items-center gap-2 bg-warning-soft px-4 py-2 text-[13px] text-warning">
        <KeyRound className="size-4 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1"><span className="block font-medium">{t.banner.starter}</span><span className="block tabular-nums">{t.banner.credentials(formatPhone(user.phone), localPhone(user.phone))}</span></span>
        <CopyButton text={localPhone(user.phone)} label={t.banner.copyPassword} className="shrink-0 text-warning" />
        <Link href="/change-password" className="shrink-0 font-semibold underline">{t.common.change}</Link>
        <button aria-label={t.common.dismiss} className="grid size-9 shrink-0 place-items-center" onClick={() => { setDismissed(true); try { sessionStorage.setItem("pwd-banner", "off"); } catch {} }}><X className="size-4" /></button>
      </div>
    </>
  );
}

export function SiteFooter() {
  const site = useSite();
  const { t } = useT();
  return (
    <footer className="mt-16 hidden border-t md:block">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-8 text-sm text-fg-3">
        <span>© {new Date().getFullYear()} {site.site_name}. {site.tagline}</span>
        <div className="flex items-center gap-5">
          <Link href="/explore" className="hover:text-fg">{t.nav.explore}</Link>
          <Link href="/pricing" className="hover:text-fg">{t.nav.pricing}</Link>
          {site.contact_email && <span>{site.contact_email}</span>}
        </div>
      </div>
    </footer>
  );
}
export { CreditCard };
