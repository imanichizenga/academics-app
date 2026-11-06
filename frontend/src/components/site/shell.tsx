"use client";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, BookOpen, Compass, CreditCard, Home, KeyRound, LayoutDashboard, LogIn, LogOut, Moon, Search, Sun, User, X } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { LogoMark } from "@/components/ui/app-loader";
import { Button, IconButton } from "@/components/ui/button";
import { Avatar, Dropdown, DropdownContent, DropdownItem, DropdownSeparator, DropdownTrigger } from "@/components/ui/display";
import { Link } from "@/components/ui/link";
import { logout, useSession, useSite } from "@/lib/providers";
import { post } from "@/lib/api";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Home", icon: Home },
  { href: "/explore", label: "Explore", icon: Compass },
  { href: "/library", label: "Library", icon: BookOpen },
  { href: "/account", label: "Account", icon: User },
];
const DESKTOP_NAV = [{ href: "/", label: "Home" }, { href: "/explore", label: "Explore" }, { href: "/pricing", label: "Pricing" }, { href: "/library", label: "My learning" }];
const isActive = (path: string, href: string) => (href === "/" ? path === "/" : path.startsWith(href));

export function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => setDark(document.documentElement.classList.contains("dark")), []);
  const flip = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try { localStorage.setItem("theme", next ? "dark" : "light"); } catch {}
  };
  return <IconButton label={dark ? "Switch to light mode" : "Switch to dark mode"} onClick={flip}>{dark ? <Sun /> : <Moon />}</IconButton>;
}

function AccountMenu() {
  const { user, loading } = useSession();
  const router = useRouter();
  const client = useQueryClient();
  if (loading) return <div className="size-10" />;
  if (!user) return <Button asChild size="md" variant="secondary"><Link href="/login"><LogIn />Log in</Link></Button>;
  const name = `${user.first_name} ${user.last_name}`.trim() || user.phone;
  return (
    <Dropdown>
      <DropdownTrigger aria-label="Account menu" className="rounded-full"><Avatar name={name} /></DropdownTrigger>
      <DropdownContent className="w-56">
        <div className="px-2.5 py-2"><div className="truncate text-sm font-medium">{name}</div><div className="text-[13px] text-fg-3">{user.phone}</div></div>
        <DropdownSeparator />
        {user.role !== "student" && <DropdownItem onSelect={() => router.push("/admin")}><LayoutDashboard />Admin panel</DropdownItem>}
        <DropdownItem onSelect={() => router.push("/library")}><BookOpen />My learning</DropdownItem>
        <DropdownItem onSelect={() => router.push("/account")}><User />Account</DropdownItem>
        <DropdownSeparator />
        <DropdownItem onSelect={() => logout(client)}><LogOut />Log out</DropdownItem>
      </DropdownContent>
    </Dropdown>
  );
}

function Brand({ compact }: { compact?: boolean }) {
  const site = useSite();
  return (
    <Link href="/" spinner="none" className="flex min-w-0 items-center gap-2 font-semibold tracking-tight">
      <LogoMark logo={site.logo_url} className="size-8 shrink-0" />
      <span className={cn("truncate", compact ? "text-[17px]" : "text-base")}>{site.site_name}</span>
    </Link>
  );
}

export function SiteHeader() {
  const path = usePathname();
  const router = useRouter();
  const nested = /^\/(content|checkout|change-password|pricing|signup|forgot)/.test(path);
  return (
    <header className="safe-top sticky top-0 z-30 border-b bg-bg/85 backdrop-blur-xl">
      <div className="mx-auto hidden h-16 max-w-6xl items-center gap-8 px-6 md:flex">
        <Brand />
        <nav aria-label="Main" className="flex items-center gap-1">
          {DESKTOP_NAV.map((n) => (
            <Link key={n.href} href={n.href} aria-current={isActive(path, n.href) ? "page" : undefined}
              className={cn("rounded-md px-3 py-2 text-sm font-medium text-fg-2 hover:text-fg", isActive(path, n.href) && "text-fg")}>{n.label}</Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-1">
          <IconButton label="Search" onClick={() => router.push("/explore?focus=1")}><Search /></IconButton>
          <ThemeToggle />
          <div className="ml-2"><AccountMenu /></div>
        </div>
      </div>
      <div className="flex h-14 items-center gap-1 px-2 md:hidden">
        {nested ? (
          <IconButton label="Go back" onClick={() => (history.length > 1 ? router.back() : router.push("/"))}><ArrowLeft /></IconButton>
        ) : <div className="pl-2"><Brand compact /></div>}
        <div className="ml-auto flex items-center">
          <IconButton label="Search" onClick={() => router.push("/explore?focus=1")}><Search /></IconButton>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}

export function BottomTabs() {
  const path = usePathname();
  return (
    <nav aria-label="Primary" className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t bg-bg/90 backdrop-blur-xl md:hidden">
      <ul className="grid h-[60px] grid-cols-4">
        {NAV.map(({ href, label, icon: Icon }) => {
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
  const path = usePathname();
  const [dismissed, setDismissed] = useState(true);
  useEffect(() => { try { setDismissed(sessionStorage.getItem("pwd-banner") === "off"); } catch { setDismissed(false); } }, []);
  if (viewingAs) {
    return (
      <div className="flex items-center justify-center gap-3 bg-warning-soft px-4 py-2 text-[13px] font-medium text-warning">
        Viewing as {user?.first_name}. Read-only.
        <button className="underline" onClick={() => post("/auth/impersonate/stop/").finally(() => { location.href = "/admin/users"; })}>Stop</button>
      </div>
    );
  }
  if (!user?.must_change_password || dismissed || path === "/change-password") return null;
  return (
    <div className="flex items-center gap-3 bg-warning-soft px-4 py-2 text-[13px] text-warning">
      <KeyRound className="size-4 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 font-medium">Your password is still your phone number. Please change it.</span>
      <Link href="/change-password" className="shrink-0 font-semibold underline">Change</Link>
      <button aria-label="Dismiss" className="grid size-8 shrink-0 place-items-center" onClick={() => { setDismissed(true); try { sessionStorage.setItem("pwd-banner", "off"); } catch {} }}><X className="size-4" /></button>
    </div>
  );
}

export function SiteFooter() {
  const site = useSite();
  return (
    <footer className="mt-16 hidden border-t md:block">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-8 text-sm text-fg-3">
        <span>© {new Date().getFullYear()} {site.site_name}. {site.tagline}</span>
        <div className="flex items-center gap-5">
          <Link href="/explore" className="hover:text-fg">Explore</Link>
          <Link href="/pricing" className="hover:text-fg">Pricing</Link>
          {site.contact_email && <span>{site.contact_email}</span>}
        </div>
      </div>
    </footer>
  );
}
export { CreditCard };
