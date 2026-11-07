import "server-only";
import { cookies, headers } from "next/headers";
import { dictionaries, type Lang } from "./i18n";
import type { Site, User } from "./types";

const base = process.env.INTERNAL_API_URL ?? "http://localhost:8000";

export async function serverGet<T>(path: string, revalidate = 30): Promise<T | null> {
  try {
    // While maintenance is on the API answers only staff, so pages must carry the visitor's session.
    const maintenance = path !== "/site/" && (await getSite()).maintenance_mode;
    const response = maintenance
      ? await fetch(`${base}/api/v1${path}`, { cache: "no-store", headers: { cookie: (await cookies()).toString() } })
      : await fetch(`${base}/api/v1${path}`, { next: { revalidate } });
    return response.ok ? ((await response.json()) as T) : null;
  } catch {
    return null;
  }
}
const DEFAULT_COLOR = "#4F46E5";
/** Only for when the API is unreachable. The brand lives in the database, so nothing brand-specific belongs here. */
export const fallbackSite: Site = {
  site_name: "", tagline: "", hero_title: "", hero_subtitle: "", logo_url: "", favicon_url: "", primary_color: DEFAULT_COLOR,
  icons: { icon_192: "/api/v1/site/icons/icon-192.png", icon_512: "/api/v1/site/icons/icon-512.png", maskable_512: "/api/v1/site/icons/maskable-512.png", apple_touch: "/api/v1/site/icons/apple-touch.png" },
  contact_email: "", contact_phone: "", contact_whatsapp: "", maintenance_message: "", teacher: { photo_url: "", name: "", title: "", bio: "", credentials: "", years: null, subjects: [] }, social_links: {}, currency: "TZS", guest_comment_policy: "login_required", allow_signup: true,
  faq: [], seo_title: "", seo_description: "", maintenance_mode: false, checkout_available: false, payment_method: "ussd_push",
  poll_seconds: 3, default_content_price: 5000, plans: [], announcements: [],
};
export const getSite = async () => (await serverGet<Site>("/site/", 10)) ?? fallbackSite;
export const brandColor = (site: Site) => (/^#[0-9a-fA-F]{6}$/.test(site.primary_color) ? site.primary_color : DEFAULT_COLOR);

/** Staff keep using the site during maintenance. Everyone else sees the maintenance page. */
export async function isStaffRequest() {
  const cookie = (await cookies()).toString();
  if (!cookie) return false;
  try {
    const response = await fetch(`${base}/api/v1/auth/me/`, { cache: "no-store", headers: { cookie } });
    const { user } = (await response.json()) as { user: User | null };
    return !!user && user.role !== "student";
  } catch {
    return false;
  }
}

/** A saved choice wins, otherwise the browser's language. */
export async function getLang(): Promise<Lang> {
  const saved = (await cookies()).get("lang")?.value;
  if (saved === "en" || saved === "sw") return saved;
  const first = (await headers()).get("accept-language")?.split(",")[0]?.trim().toLowerCase() ?? "";
  return first.startsWith("sw") ? "sw" : "en";
}
export const getT = async () => dictionaries[await getLang()];
