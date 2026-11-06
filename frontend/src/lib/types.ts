export type Plan = { id: string; name: string; description: string; price: number; promo_price: number | null; effective_price: number; duration_days: number; features: string[]; is_active: boolean; highlighted: boolean; order: number };
export type Teacher = { photo_url: string; name: string; title: string; bio: string; credentials: string; years: number | null; subjects: string[] };
export type Site = {
  site_name: string; tagline: string; hero_title: string; hero_subtitle: string; logo_url: string; favicon_url: string; primary_color: string;
  contact_email: string; contact_phone: string; contact_whatsapp: string; maintenance_message: string; teacher: Teacher; social_links: Record<string, string>; currency: string; guest_comment_policy: string;
  allow_signup: boolean; faq: { q: string; a: string }[]; seo_title: string; seo_description: string; maintenance_mode: boolean;
  checkout_available: boolean; payment_method: string; poll_seconds: number; default_content_price: number; plans: Plan[];
};
export type User = { id: string; username: string; phone: string; first_name: string; last_name: string; email: string; role: "admin" | "editor" | "student"; must_change_password: boolean; source: string; date_joined: string; language: "" | "en" | "sw" };
export type CategoryBrief = { id: string; name: string; slug: string; color: string; icon: string; parent: string | null };
export type CategoryNode = { id: string; name: string; slug: string; description: string; icon: string; color: string; cover_url: string; order: number; is_active: boolean; content_count: number; children: CategoryNode[] };
export type Tag = { id: string; name: string; slug: string };
export type Card = {
  id: string; slug: string; title: string; subtitle: string; excerpt: string; cover_url: string; content_type: string; category: CategoryBrief | null;
  reading_time: number; duration: number | null; page_count: number | null; access_level: "free" | "paid"; price: number | null; promo_price: number | null;
  effective_price: number | null; has_access: boolean; view_count: number; like_count: number; show_view_count: boolean; published_at: string; featured: boolean;
  percent?: number;
};
export type Media = { id: string; kind: string; original_filename: string; size: number; mime: string; page_count: number | null; duration: number | null; thumbnail_url: string; status: string; processing_progress: number };
export type Detail = Card & {
  tags: Tag[]; author: { name: string; role: string } | null; body_html: string; truncated: boolean; main_media: Media | null; attachments: Media[];
  user_state: { liked: boolean; bookmarked: boolean; percent: number; position_seconds: number };
  cover_full_url: string; seo_title: string; seo_description: string; allow_comments: boolean; allow_reactions: boolean; allow_bookmarks: boolean; allow_download: boolean;
  comment_count: number; access_duration_days: number | null; included_in_subscription: boolean; preview_seconds: number; preview_pages: number; updated_at: string; word_count: number;
};
export type Receipt = { id: string; number: string; paid_at: string; item_title: string; order_type: string; amount: number; currency: string; payment_channel: string; payment_provider: string; external_reference: string; customer_name: string; phone_masked: string; site_name: string; logo_url: string };
export type Paged<T> = { count: number; page: number; total_pages: number; next: number | null; previous: number | null; results: T[] };
export type Comment = { id: string; body: string; parent: string | null; status: string; is_pinned: boolean; like_count: number; created_at: string; edited_at: string | null; author_name: string; is_teacher: boolean; is_mine: boolean; can_edit: boolean; liked: boolean; replies: Comment[] };
export type Order = { id: string; status: string; amount: number; currency: string; order_type: string; item_title: string; expires_at: string | null; failure_reason: string; content_slug: string | null; method: string; checkout_url: string; claim_token?: string };
