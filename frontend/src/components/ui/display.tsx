"use client";
import * as AvatarP from "@radix-ui/react-avatar";
import * as DropdownP from "@radix-ui/react-dropdown-menu";
import * as TabsP from "@radix-ui/react-tabs";
import * as TooltipP from "@radix-ui/react-tooltip";
import { ChevronLeft, ChevronRight, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Button } from "./button";

const tones = {
  neutral: "bg-surface-2 text-fg-2", primary: "bg-primary-soft text-primary-ink", success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning", danger: "bg-danger-soft text-danger", info: "bg-info-soft text-info",
  solid: "bg-fg text-bg",
};
export function Badge({ tone = "neutral", className, children }: { tone?: keyof typeof tones; className?: string; children: ReactNode }) {
  return <span className={cn("inline-flex h-[22px] items-center gap-1 rounded-md px-1.5 text-xs font-medium whitespace-nowrap [&_svg]:size-3", tones[tone], className)}>{children}</span>;
}
export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("rounded-xl border bg-surface shadow-sm", className)}>{children}</div>;
}
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("skeleton", className)} />;
}
export function Avatar({ name, className }: { name: string; className?: string }) {
  const initials = name.split(" ").map((s) => s[0]).filter(Boolean).slice(0, 2).join("").toUpperCase() || "?";
  return (
    <AvatarP.Root className={cn("grid size-9 shrink-0 place-items-center rounded-full bg-primary-soft text-[13px] font-semibold text-primary-ink", className)}>
      <AvatarP.Fallback>{initials}</AvatarP.Fallback>
    </AvatarP.Root>
  );
}
export function ProgressBar({ value, className, label }: { value: number; className?: string; label?: string }) {
  return (
    <div role="progressbar" aria-label={label} aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100} className={cn("h-1.5 overflow-hidden rounded-full bg-surface-3", className)}>
      <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  );
}
export function EmptyState({ icon: Icon, title, text, action }: { icon: LucideIcon; title: string; text: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed px-6 py-14 text-center">
      <div className="mb-4 grid size-12 place-items-center rounded-xl bg-primary-soft text-primary-ink"><Icon className="size-6" /></div>
      <h3 className="font-semibold tracking-tight">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-fg-2">{text}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
export function StatCard({ label, value, hint, icon: Icon, tone }: { label: string; value: ReactNode; hint?: ReactNode; icon?: LucideIcon; tone?: "warning" | "danger" }) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-2 text-[13px] font-medium text-fg-2">
        <span className="truncate">{label}</span>
        {Icon && <Icon className={cn("size-4 shrink-0 text-fg-3", tone === "warning" && "text-warning", tone === "danger" && "text-danger")} />}
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">{value}</div>
      {hint && <div className="mt-0.5 text-[13px] text-fg-3">{hint}</div>}
    </Card>
  );
}
export function PageHeader({ title, description, actions, className }: { title: string; description?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={cn("mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between", className)}>
      <div className="min-w-0">
        <h1 className="text-[22px] font-semibold tracking-tight md:text-2xl">{title}</h1>
        {description && <p className="mt-0.5 text-sm text-fg-2">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
export function Pagination({ page, totalPages, onChange }: { page: number; totalPages: number; onChange: (p: number) => void }) {
  if (totalPages <= 1) return null;
  return (
    <nav aria-label="Pagination" className="flex items-center gap-1">
      <Button variant="ghost" size="icon-sm" aria-label="Previous page" disabled={page <= 1} onClick={() => onChange(page - 1)}><ChevronLeft /></Button>
      <span className="px-2 text-[13px] tabular-nums text-fg-2">{page} / {totalPages}</span>
      <Button variant="ghost" size="icon-sm" aria-label="Next page" disabled={page >= totalPages} onClick={() => onChange(page + 1)}><ChevronRight /></Button>
    </nav>
  );
}
export function Tabs({ value, onChange, items, className }: { value: string; onChange: (v: string) => void; items: { value: string; label: ReactNode }[]; className?: string }) {
  return (
    <TabsP.Root value={value} onValueChange={onChange}>
      <TabsP.List className={cn("scroll-x flex gap-1 border-b", className)}>
        {items.map((i) => (
          <TabsP.Trigger key={i.value} value={i.value} className="no-press -mb-px h-11 shrink-0 border-b-2 border-transparent px-3 text-sm font-medium text-fg-2 hover:text-fg data-[state=active]:border-primary data-[state=active]:text-fg">
            {i.label}
          </TabsP.Trigger>
        ))}
      </TabsP.List>
    </TabsP.Root>
  );
}
export function Tooltip({ content, children }: { content: ReactNode; children: ReactNode }) {
  return (
    <TooltipP.Root delayDuration={250}>
      <TooltipP.Trigger asChild>{children}</TooltipP.Trigger>
      <TooltipP.Portal>
        <TooltipP.Content sideOffset={6} className="z-[70] max-w-64 rounded-md bg-fg px-2 py-1 text-xs font-medium text-bg shadow-md">{content}</TooltipP.Content>
      </TooltipP.Portal>
    </TooltipP.Root>
  );
}
export const Dropdown = DropdownP.Root;
export const DropdownTrigger = DropdownP.Trigger;
export function DropdownContent({ children, align = "end", className }: { children: ReactNode; align?: "start" | "end"; className?: string }) {
  return (
    <DropdownP.Portal>
      <DropdownP.Content align={align} sideOffset={6} className={cn("z-[60] min-w-44 rounded-lg border bg-surface p-1 shadow-lg", className)}>{children}</DropdownP.Content>
    </DropdownP.Portal>
  );
}
export function DropdownItem({ onSelect, children, danger, disabled }: { onSelect?: () => void; children: ReactNode; danger?: boolean; disabled?: boolean }) {
  return (
    <DropdownP.Item onSelect={onSelect} disabled={disabled} className={cn("flex min-h-10 cursor-pointer items-center gap-2 rounded-md px-2.5 text-sm outline-none data-[highlighted]:bg-surface-2 data-[disabled]:opacity-50 [&_svg]:size-4 [&_svg]:text-fg-3", danger && "text-danger [&_svg]:text-danger")}>
      {children}
    </DropdownP.Item>
  );
}
export const DropdownSeparator = () => <DropdownP.Separator className="my-1 h-px bg-border" />;
