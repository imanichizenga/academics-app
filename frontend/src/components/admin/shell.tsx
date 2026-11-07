"use client";
import { useQuery } from "@tanstack/react-query";
import { Command } from "cmdk";
import { BarChart3, BookOpen, ChevronRight, ChevronsLeft, ChevronsRight, CreditCard, FileClock, FolderTree, Home, Image as ImageIcon, LogOut, Menu, MessageSquare, Moon, Package, Plus, Search, Settings, Users, Wallet, type LucideIcon } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { Fragment, useEffect, useState, type ReactNode } from "react";
import * as DialogP from "@radix-ui/react-dialog";
import { useQueryClient } from "@tanstack/react-query";
import { LogoMark } from "@/components/ui/app-loader";
import { Button, IconButton } from "@/components/ui/button";
import { useDebounced } from "@/components/ui/data-table";
import { Avatar, Skeleton } from "@/components/ui/display";
import { Link } from "@/components/ui/link";
import { ThemeToggle } from "@/components/site/shell";
import { api } from "@/lib/api";
import { logout, useSession, useSite } from "@/lib/providers";
import { cn, formatPhone } from "@/lib/utils";
import { UploadTray } from "./upload-tray";

type Item = { href: string; label: string; icon: LucideIcon; adminOnly?: boolean };
const NAV: { title?: string; items: Item[] }[] = [
  { items: [{ href: "/admin", label: "Dashboard", icon: BarChart3 }] },
  { title: "Teach", items: [{ href: "/admin/contents", label: "Content", icon: BookOpen }, { href: "/admin/categories", label: "Categories", icon: FolderTree }, { href: "/admin/media", label: "Media library", icon: ImageIcon }, { href: "/admin/comments", label: "Comments", icon: MessageSquare }] },
  { title: "Business", items: [{ href: "/admin/orders", label: "Orders", icon: CreditCard, adminOnly: true }, { href: "/admin/withdrawals", label: "Withdrawals", icon: Wallet, adminOnly: true }, { href: "/admin/plans", label: "Plans & pricing", icon: Package, adminOnly: true }, { href: "/admin/users", label: "Users", icon: Users, adminOnly: true }] },
  { title: "System", items: [{ href: "/admin/settings/general", label: "Settings", icon: Settings, adminOnly: true }, { href: "/admin/audit", label: "Audit log", icon: FileClock, adminOnly: true }] },
];
const LABELS: Record<string, string> = { contents: "Content", categories: "Categories", media: "Media library", comments: "Comments", orders: "Orders", withdrawals: "Withdrawals", announcements: "Announcements", plans: "Plans & pricing", users: "Users", settings: "Settings", audit: "Audit log", general: "General", payments: "Payments", storage: "Storage", engagement: "Comments & engagement", notifications: "Notifications", admins: "Admins & roles", new: "New" };
const active = (path: string, href: string) => (href === "/admin" ? path === href : path.startsWith(href.replace("/general", "")));

function SideNav({ collapsed, onNavigate, role }: { collapsed?: boolean; onNavigate?: () => void; role?: string }) {
  const path = usePathname();
  const site = useSite();
  return (
    <nav aria-label="Admin" className="flex-1 space-y-5 overflow-y-auto p-2">
      {NAV.map((group, i) => {
        const items = group.items.filter((n) => !n.adminOnly || role === "admin");
        if (!items.length) return null;
        return (
          <div key={i} className="space-y-0.5">
            {group.title && !collapsed && <div className="px-2.5 pb-1 text-xs font-medium text-fg-3">{group.title}</div>}
            {items.map(({ href, label, icon: Icon }) => (
              <Link key={href} href={href} onClick={onNavigate} title={collapsed ? label : undefined} spinner={collapsed ? "none" : "inline"} aria-current={active(path, href) ? "page" : undefined}
                className={cn("flex h-10 items-center gap-2.5 rounded-md px-2.5 text-sm font-medium text-fg-2 hover:bg-surface-2 hover:text-fg md:h-9", active(path, href) && "bg-primary-soft text-primary-ink hover:bg-primary-soft hover:text-primary-ink", collapsed && "justify-center px-0")}>
                <Icon className="size-[18px] shrink-0" aria-hidden />{!collapsed && <span className="truncate">{label}</span>}
              </Link>
            ))}
          </div>
        );
      })}
      {!collapsed && <Link href="/" onClick={onNavigate} className="flex h-9 items-center gap-2.5 rounded-md px-2.5 text-sm text-fg-3 hover:text-fg"><Home className="size-[18px]" aria-hidden />View {site.site_name}</Link>}
    </nav>
  );
}

function Breadcrumbs() {
  const path = usePathname();
  const parts = path.split("/").filter(Boolean).slice(1);
  const crumbs = parts.map((p, i) => ({ label: LABELS[p] ?? "Details", href: `/admin/${parts.slice(0, i + 1).join("/")}` })).filter((c) => c.href !== "/admin/settings");
  return (
    <nav aria-label="Breadcrumb" className="hidden min-w-0 items-center gap-1 text-[13px] text-fg-2 md:flex">
      <Link href="/admin" className="hover:text-fg">Dashboard</Link>
      {crumbs.map((c, i) => (
        <Fragment key={c.href}>
          <ChevronRight className="size-3.5 text-fg-3" aria-hidden />
          {i === crumbs.length - 1 ? <span aria-current="page" className="truncate font-medium text-fg">{c.label}</span> : <Link href={c.href} className="hover:text-fg">{c.label}</Link>}
        </Fragment>
      ))}
    </nav>
  );
}

function Palette({ open, setOpen, role }: { open: boolean; setOpen: (v: boolean) => void; role?: string }) {
  const router = useRouter();
  const [term, setTerm] = useState("");
  const q = useDebounced(term, 200);
  const { data } = useQuery({ queryKey: ["palette", q], enabled: q.length > 1, queryFn: () => api<{ contents: { id: string; title: string; status: string }[]; users: { id: string; first_name: string; last_name: string; phone: string }[] }>(`/admin/search/?q=${encodeURIComponent(q)}`) });
  const go = (href: string) => { setOpen(false); setTerm(""); router.push(href); };
  const item = "flex min-h-10 cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-sm aria-selected:bg-surface-2 [&_svg]:size-4 [&_svg]:text-fg-3";
  const nav = NAV.flatMap((g) => g.items).filter((n) => !n.adminOnly || role === "admin");
  return (
    <DialogP.Root open={open} onOpenChange={setOpen}>
      <DialogP.Portal>
        <DialogP.Overlay className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[2px]" />
        <DialogP.Content aria-describedby={undefined} className="fixed left-1/2 top-[12vh] z-50 w-[calc(100vw-32px)] max-w-lg -translate-x-1/2 overflow-hidden rounded-xl border bg-surface shadow-lg">
          <DialogP.Title className="sr-only">Command palette</DialogP.Title>
          <Command shouldFilter={!q || q.length < 2} label="Command palette">
            <div className="flex items-center gap-2 border-b px-3"><Search className="size-4 text-fg-3" aria-hidden /><Command.Input value={term} onValueChange={setTerm} placeholder="Search or jump to…" className="h-12 flex-1 bg-transparent text-[15px] outline-none placeholder:text-fg-3" /></div>
            <Command.List className="max-h-80 overflow-y-auto p-1.5">
              <Command.Empty className="p-6 text-center text-sm text-fg-3">No results</Command.Empty>
              {data?.contents.map((c) => <Command.Item key={c.id} value={`c-${c.id}`} className={item} onSelect={() => go(`/admin/contents/${c.id}`)}><BookOpen /><span className="truncate">{c.title}</span></Command.Item>)}
              {data?.users.map((u) => <Command.Item key={u.id} value={`u-${u.id}`} className={item} onSelect={() => go(`/admin/users/${u.id}`)}><Users /><span className="truncate">{u.first_name} {u.last_name} · {formatPhone(u.phone)}</span></Command.Item>)}
              {q.length < 2 && (<>
                <Command.Item className={item} value="new content" onSelect={() => go("/admin/contents/new")}><Plus />New content</Command.Item>
                {nav.map((n) => <Command.Item key={n.href} className={item} value={n.label} onSelect={() => go(n.href)}><n.icon />{n.label}</Command.Item>)}
              </>)}
            </Command.List>
          </Command>
        </DialogP.Content>
      </DialogP.Portal>
    </DialogP.Root>
  );
}

export function AdminShell({ children }: { children: ReactNode }) {
  const { user, loading } = useSession();
  const router = useRouter();
  const site = useSite();
  const client = useQueryClient();
  const [collapsed, setCollapsed] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [palette, setPalette] = useState(false);
  useEffect(() => { try { setCollapsed(localStorage.getItem("sidebar") === "1"); } catch {} }, []);
  useEffect(() => {
    if (!loading && !user) router.replace("/login?next=/admin");
    else if (!loading && user?.role === "student") router.replace("/");
    else if (user?.must_change_password) router.replace("/change-password?forced=1");
  }, [loading, user, router]);
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPalette((p) => !p); } };
    addEventListener("keydown", on);
    return () => removeEventListener("keydown", on);
  }, []);
  const flip = () => { setCollapsed((c) => { try { localStorage.setItem("sidebar", c ? "0" : "1"); } catch {} return !c; }); };
  if (loading || !user || user.role === "student") return <div className="grid min-h-dvh place-items-center"><Skeleton className="h-8 w-40" /></div>;
  const name = `${user.first_name} ${user.last_name}`.trim() || formatPhone(user.phone);
  return (
    <div className="flex min-h-dvh">
      <aside className={cn("sticky top-0 hidden h-dvh shrink-0 flex-col border-r bg-surface transition-[width] duration-200 md:flex", collapsed ? "w-[60px]" : "w-60")}>
        <div className={cn("flex h-14 items-center gap-2 border-b px-3 font-semibold tracking-tight", collapsed && "justify-center px-0")}><LogoMark logo={site.logo_url} name={site.site_name} className="size-7 shrink-0" />{!collapsed && <span className="truncate">{site.site_name}</span>}</div>
        <SideNav collapsed={collapsed} role={user.role} />
        <div className="border-t p-2">
          <IconButton label={collapsed ? "Expand sidebar" : "Collapse sidebar"} size="icon-sm" className="w-full" onClick={flip}>{collapsed ? <ChevronsRight /> : <ChevronsLeft />}</IconButton>
        </div>
      </aside>
      <DialogP.Root open={drawer} onOpenChange={setDrawer}>
        <DialogP.Portal>
          <DialogP.Overlay className="fixed inset-0 z-50 bg-black/45 md:hidden" />
          <DialogP.Content aria-describedby={undefined} className="safe-top fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col bg-surface shadow-lg outline-none md:hidden">
            <DialogP.Title className="flex h-14 items-center gap-2 border-b px-3 font-semibold tracking-tight"><LogoMark logo={site.logo_url} name={site.site_name} className="size-7" />{site.site_name}</DialogP.Title>
            <SideNav role={user.role} onNavigate={() => setDrawer(false)} />
          </DialogP.Content>
        </DialogP.Portal>
      </DialogP.Root>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="safe-top sticky top-0 z-30 border-b bg-bg/90 backdrop-blur-xl">
          <div className="flex h-14 items-center gap-2 px-2 md:px-5">
            <IconButton label="Open menu" className="md:hidden" onClick={() => setDrawer(true)}><Menu /></IconButton>
            <Breadcrumbs />
            <div className="ml-auto flex items-center gap-1">
              <Button variant="secondary" size="sm" className="hidden gap-2 text-fg-3 md:inline-flex" onClick={() => setPalette(true)}><Search />Search<kbd className="rounded border px-1 text-[11px]">Ctrl K</kbd></Button>
              <IconButton label="Search" className="md:hidden" onClick={() => setPalette(true)}><Search /></IconButton>
              <ThemeToggle />
              <IconButton label="Log out" onClick={() => logout(client)}><LogOut /></IconButton>
              <Avatar name={name} className="ml-1 hidden size-8 md:grid" />
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1200px] flex-1 px-4 py-5 md:px-6 md:py-7">{children}</main>
      </div>
      <Palette open={palette} setOpen={setPalette} role={user.role} />
      <UploadTray />
    </div>
  );
}
export { Moon };
