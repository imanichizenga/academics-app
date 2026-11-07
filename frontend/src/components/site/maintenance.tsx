"use client";
import { Mail, MessageCircle, Phone } from "lucide-react";
import { useEffect } from "react";
import { LogoMark } from "@/components/ui/app-loader";
import { Button } from "@/components/ui/button";
import { Link } from "@/components/ui/link";
import { useSession, useSite, useT } from "@/lib/providers";
import { whatsappLink } from "@/lib/utils";

export function MaintenancePage() {
  const site = useSite();
  const { t } = useT();
  const { user } = useSession();
  // A teacher whose short-lived cookie had lapsed arrives here until the session refreshes: let them through.
  useEffect(() => {
    if (!user || user.role === "student") return;
    try { if (sessionStorage.getItem("maintenance-staff")) return; sessionStorage.setItem("maintenance-staff", "1"); } catch { return; }
    location.reload();
  }, [user]);
  const contacts = [
    site.contact_phone && { icon: Phone, label: site.contact_phone, href: `tel:${site.contact_phone.replace(/\s/g, "")}` },
    site.contact_whatsapp && { icon: MessageCircle, label: "WhatsApp", href: whatsappLink(site.contact_whatsapp) },
    site.contact_email && { icon: Mail, label: site.contact_email, href: `mailto:${site.contact_email}` },
  ].filter(Boolean) as { icon: typeof Phone; label: string; href: string }[];
  return (
    <main data-testid="maintenance" className="safe-top safe-bottom grid min-h-dvh place-items-center bg-bg px-4 py-10 text-center">
      <div className="w-full max-w-md">
        <LogoMark logo={site.logo_url} name={site.site_name} className="mx-auto mb-5 size-14" />
        <div className="mb-1 text-sm font-semibold tracking-tight text-fg-2">{site.site_name}</div>
        <h1 className="font-serif text-[32px] font-semibold leading-tight tracking-tight md:text-[40px]">{t.maintenance.title}</h1>
        <p className="mx-auto mt-3 max-w-sm whitespace-pre-line text-[17px] leading-relaxed text-fg-2">{site.maintenance_message || t.maintenance.text(site.site_name)}</p>
        {contacts.length > 0 && (
          <div className="mt-8 rounded-xl border bg-surface p-4 text-left shadow-sm">
            <div className="mb-1 text-[13px] font-semibold">{t.maintenance.contact}</div>
            <ul className="divide-y">{contacts.map(({ icon: Icon, label, href }) => (
              <li key={href}><a href={href} className="flex min-h-11 items-center gap-2.5 text-sm text-fg-2 hover:text-fg"><Icon className="size-4 shrink-0 text-fg-3" aria-hidden /><span className="truncate">{label}</span></a></li>
            ))}</ul>
          </div>
        )}
        <Button asChild variant="ghost" size="sm" className="mt-4"><Link href="/login?next=/">{t.maintenance.staff}</Link></Button>
      </div>
    </main>
  );
}
