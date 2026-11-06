"use client";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import { useT } from "@/lib/providers";
import { IconButton } from "./button";

export function CopyButton({ text, label, className }: { text: string; label: string; className?: string }) {
  const { t } = useT();
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); toast.success(t.common.copied); } catch { toast(text); }
  };
  return <IconButton label={label} size="icon-sm" className={className} onClick={copy}><Copy /></IconButton>;
}
