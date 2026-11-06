import "server-only";
import type { Site } from "./types";

const base = process.env.INTERNAL_API_URL ?? "http://localhost:8000";

export async function serverGet<T>(path: string, revalidate = 30): Promise<T | null> {
  try {
    const response = await fetch(`${base}/api/v1${path}`, { next: { revalidate } });
    return response.ok ? ((await response.json()) as T) : null;
  } catch {
    return null;
  }
}
export const fallbackSite: Site = {
  site_name: "Darasa", tagline: "", hero_title: "", hero_subtitle: "", logo_url: "", favicon_url: "", primary_color: "#4F46E5",
  contact_email: "", contact_phone: "", social_links: {}, currency: "TZS", guest_comment_policy: "login_required", allow_signup: true,
  faq: [], seo_title: "", seo_description: "", maintenance_mode: false, checkout_available: false, payment_method: "ussd_push",
  poll_seconds: 3, default_content_price: 5000, plans: [],
};
export const getSite = async () => (await serverGet<Site>("/site/", 30)) ?? fallbackSite;
