"use client";
import NextLink, { useLinkStatus } from "next/link";
import { Loader2 } from "lucide-react";
import { type ComponentProps, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/** Rendered inside the link, so it reads that link's pending state. */
function Pending({ inline, onChange }: { inline?: boolean; onChange: (pending: boolean) => void }) {
  const { pending } = useLinkStatus();
  useEffect(() => onChange(pending), [pending, onChange]);
  if (!pending) return null;
  if (inline) return <Loader2 className="ml-1 inline size-3.5 shrink-0 animate-spin" aria-hidden />;
  return (
    <span className="pointer-events-none absolute inset-0 z-10 grid place-items-center rounded-[inherit] bg-surface/55 backdrop-blur-[1px]">
      <Loader2 className="size-5 animate-spin text-primary-ink" aria-hidden />
    </span>
  );
}

type Props = ComponentProps<typeof NextLink> & { spinner?: "inline" | "overlay" | "none" };

/** Every in-app link: shows a spinner and refuses further clicks until the navigation finishes. */
export function Link({ spinner = "inline", className, children, ...props }: Props) {
  const ref = useRef<HTMLAnchorElement>(null);
  const setPending = useRef((pending: boolean) => {
    const el = ref.current;
    if (!el) return;
    if (pending) el.setAttribute("aria-busy", "true");
    else el.removeAttribute("aria-busy");
  }).current;
  return (
    <NextLink ref={ref} className={cn(spinner === "overlay" && "relative", className)} {...props}>
      {children}
      {spinner !== "none" && <Pending inline={spinner === "inline"} onChange={setPending} />}
    </NextLink>
  );
}
