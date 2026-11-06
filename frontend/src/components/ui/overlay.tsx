"use client";
import * as DialogP from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Drawer } from "vaul";
import { cn } from "@/lib/utils";
import { Button, IconButton } from "./button";

export function useIsMobile() {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const query = matchMedia("(max-width: 767px)");
    const update = () => setMobile(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return mobile;
}

type SheetProps = { open: boolean; onOpenChange: (v: boolean) => void; title: string; description?: string; children: ReactNode; footer?: ReactNode; size?: "sm" | "md" | "lg"; dismissible?: boolean };

/** Bottom sheet on phones, centered dialog on larger screens. The only modal in the product. */
export function Sheet({ open, onOpenChange, title, description, children, footer, size = "md", dismissible = true }: SheetProps) {
  const mobile = useIsMobile();
  if (mobile) {
    return (
      <Drawer.Root open={open} onOpenChange={onOpenChange} dismissible={dismissible} repositionInputs={false}>
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 z-50 bg-black/45" />
          <Drawer.Content aria-describedby={undefined} className="fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] flex-col rounded-t-2xl bg-surface outline-none">
            <div aria-hidden className="mx-auto mt-2.5 h-1 w-9 shrink-0 rounded-full bg-border-strong" />
            <div className="px-4 pb-2 pt-3">
              <Drawer.Title className="text-[17px] font-semibold tracking-tight">{title}</Drawer.Title>
              {description && <Drawer.Description className="mt-0.5 text-sm text-fg-2">{description}</Drawer.Description>}
            </div>
            <div className="flex-1 overflow-y-auto overscroll-contain px-4 pb-4">{children}</div>
            {footer && <div className="safe-bottom border-t px-4 pt-3"><div className="pb-3">{footer}</div></div>}
            {!footer && <div className="safe-bottom" />}
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
    );
  }
  const width = { sm: "max-w-sm", md: "max-w-md", lg: "max-w-2xl" }[size];
  return (
    <DialogP.Root open={open} onOpenChange={onOpenChange}>
      <DialogP.Portal>
        <DialogP.Overlay className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[2px]" />
        <DialogP.Content
          aria-describedby={undefined}
          onInteractOutside={(e) => { if (!dismissible) e.preventDefault(); }}
          onEscapeKeyDown={(e) => { if (!dismissible) e.preventDefault(); }}
          className={cn("fixed left-1/2 top-1/2 z-50 flex max-h-[88dvh] w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl border bg-surface shadow-lg outline-none", width)}
        >
          <div className="flex items-start justify-between gap-4 px-5 pb-2 pt-5">
            <div>
              <DialogP.Title className="text-[17px] font-semibold tracking-tight">{title}</DialogP.Title>
              {description && <DialogP.Description className="mt-0.5 text-sm text-fg-2">{description}</DialogP.Description>}
            </div>
            {dismissible && <DialogP.Close asChild><IconButton label="Close" size="icon-sm" className="-mr-1 -mt-1"><X /></IconButton></DialogP.Close>}
          </div>
          <div className="flex-1 overflow-y-auto px-5 pb-5">{children}</div>
          {footer && <div className="flex justify-end gap-2 border-t px-5 py-3">{footer}</div>}
        </DialogP.Content>
      </DialogP.Portal>
    </DialogP.Root>
  );
}

export function ConfirmSheet({ open, onOpenChange, title, text, confirmLabel, danger, loading, onConfirm, children }: { open: boolean; onOpenChange: (v: boolean) => void; title: string; text?: string; confirmLabel: string; danger?: boolean; loading?: boolean; onConfirm: () => void; children?: ReactNode }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={title} description={text} size="sm"
      footer={<div className="flex w-full justify-end gap-2"><Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button><Button variant={danger ? "danger" : "primary"} loading={loading} onClick={onConfirm}>{confirmLabel}</Button></div>}>
      {children}
    </Sheet>
  );
}
