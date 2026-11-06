You are working in an existing, mostly complete repository: a Next.js 15 + Django REST Framework learning platform ("Darasa") where one teacher sells free and paid lessons, with Snippe mobile-money payments and S3/CloudFront media. Read README.md first, especially "Decisions" and "Known limitations".

This is a FIX AND POLISH pass, not a rewrite. The architecture, design tokens (frontend/src/app/globals.css), UI primitives (frontend/src/components/ui/), payment services (backend/apps/payments/services.py), access rules (backend/apps/payments/access.py) and the 103 passing backend tests are good. Keep them. Reuse existing primitives and tokens for every change; do not add one-off styles, new colours or new component libraries. Keep README "Decisions" and "Known limitations" up to date as you go.

An audit ran the app end to end (backend tests, seeded data, mock Snippe, guest checkout on an emulated Pixel 7, admin at 1440px). Everything below was observed in that audit. Work through it in priority order. For each item: fix it, add or update a test, and confirm the acceptance criteria.

==================================================
P0 — BUGS THAT WILL HURT REAL STUDENTS
==================================================

1. Auto-created password does not accept the number as students type it.
   Observed: a guest paid with "0713 456 789". The account was created with password "255713456789". Logging in with password "0713456789" returns 401 "Wrong phone number or password", and 8 failures lock the phone for 15 minutes. The success screen says only "Your password is your phone number".
   Fix:
   - Backend (backend/apps/accounts/views.py LoginView): if authenticate fails, the user exists, user.must_change_password is True, and normalize_phone(entered_password) equals the user's phone, authenticate with the normalised form. Accept 07XXXXXXXX, 7XXXXXXXX, 255XXXXXXXXX and +255XXXXXXXXX, with or without spaces. Count a fallback success as success, so it does not count towards the lockout. Never apply the fallback once the password has been changed.
   - Frontend success screen (frontend/src/components/content/checkout.tsx Success) and the session banner: show the exact credentials in the format the student knows, "Phone: 0713 456 789 · Password: 0713456789 (your phone number)", with a copy button.
   Acceptance: a test logs in with each of the four formats on a must_change_password account, and gets 401 for all of them after the password is changed.

2. Returning students have no way to log in from the paywall.
   Observed: frontend/src/components/content/paywall.tsx shows only "Buy" and "Subscribe". A subscriber on a new phone or browser is invited to pay again.
   Fix: for logged-out visitors, add "Already paid? Log in" under the buttons, linking to /login?next=<current path>. Make /login honour `next` (relative paths only, no open redirect) and return to the lesson already unlocked. Add the same link on /pricing.
   Acceptance: e2e test. A seeded subscriber logs out, opens a paid lesson, taps "Already paid? Log in", logs in, and lands back on the unlocked lesson.

3. An expired subscriber cannot buy a single lesson.
   Observed: in paywall.tsx, `!expired` hides the per-content Buy button.
   Fix: show "Renew subscription" as the primary action and "Buy this lesson only — TZS X" as secondary. When more than one active plan exists, add a "Compare plans" link to /pricing.

4. A "subscribers only" lesson (no price) gives a dead end on attached files.
   Observed: useFileDownload in frontend/src/components/content/body.tsx opens checkout only when item.price != null. Otherwise it shows only a toast.
   Fix: when price is null and the content is included_in_subscription, open checkout for the monthly or highlighted plan. Otherwise scroll to the paywall card.

5. "Attach file" is hidden in the mobile editor.
   Observed at 412px: the selection bubble menu (frontend/src/components/editor/editor.tsx) is filled by 5 colour dots and formatting buttons, and "Link" and "Attach file" overflow off-screen. Attaching a file to selected text is the headline editor feature.
   Fix:
   - Put "Attach file" FIRST in the bubble menu, as the labelled soft button.
   - Collapse the 5 colour dots into one "Text colour" button that opens a small popover or bottom sheet.
   - Below md, when text is selected, show the formatting actions in a fixed bottom action bar above the safe area. Do not use a floating bubble, which clashes with the OS text-selection menu.
   - The bubble must never overlap the sticky toolbar (it currently does at 1440px). Use tippy placement/flip with the toolbar as a boundary.
   Acceptance: Playwright on Pixel 7 selects text, taps "Attach file", picks a PDF from the media library, and the text becomes a fileLink. Both admin and student views are screenshotted.

6. Maintenance mode locks the teacher out and does not protect the API.
   Observed: frontend/src/app/(site)/layout.tsx replaces every (site) page, including /login, /change-password and /forgot, with "We will be right back". A logged-out teacher cannot sign in. The backend still serves all student APIs.
   Fix:
   - Move the auth pages to a route group that is never hidden, so they always render.
   - Logged-in staff browse the site normally, with a small banner: "Maintenance mode is on. Students see the maintenance page."
   - Backend middleware: while maintenance_mode is on, return 503 {code:"maintenance"} for non-staff requests, except auth endpoints, the Snippe webhook, order status/claim (payments in flight must finish), /api/health/ and admin endpoints.
   - Design the maintenance page properly: logo, message, contact details from SiteSettings, and an optional admin-editable message field.

7. Reconciliation wrongly expires hosted-checkout orders.
   Observed: backend/apps/payments/tasks.py reconcile_pending_orders closes every pending order with snippe_reference="" past expiry as "Never reached Snippe", including hosted-checkout orders that do have snippe_session_reference.
   Fix: also require snippe_session_reference="" in that filter. Add a test.

==================================================
P1 — MISSING PIECES OF THE ORIGINAL SPEC
==================================================

8. SMS and email are not database-driven.
   Observed: Settings → Notifications has free-text "SMS provider" and "Email provider" inputs with the hint "Register a sender in apps/core/notifications.py". Nothing is ever sent, so receipts, expiry reminders and the SMS password reset do not work.
   Fix, following the same pattern as PaymentGatewayConfig and StorageConfig:
   - A NotificationConfig model with encrypted secrets.
   - SMS adapters for Tanzanian providers. Read each provider's current official API docs before writing the adapter; implement Beem Africa and Africa's Talking, plus a generic HTTP adapter with configurable URL, method, headers and body template.
   - Fields: provider, API key/secret (encrypted), sender ID, is_enabled.
   - Email via SMTP: host, port, TLS/SSL, username, password (encrypted), from name/address.
   - "Test" buttons that send a real test SMS or email to a number/address the admin enters, shown as a step checklist like the payment test.
   - Editable message templates, with placeholders such as {site_name}, {amount}, {item}, {days}, {code}, for: payment receipt, account created (phone + password hint + login link), subscription ending in N days, subscription ended, and OTP code.
   - A notification log (time, channel, masked recipient, template, status, provider response) visible in the admin.
   - When SMS is enabled, the existing OTP "Forgot password" flow must work end to end. When it is not, /forgot explains how to contact the teacher (SiteSettings contact phone/WhatsApp link).
   - Send all of this from Celery, with retries. Never block a request.
   Acceptance: tests mock each provider. The admin test button works against a mock HTTP server.

9. Printable receipts.
   Add /library/receipts/[orderId]: a clean, printable receipt (site logo, receipt number, date, item, amount, payment channel/provider, external reference, customer name and masked phone), "Print / Save as PDF" (print stylesheet), and a link from each row in Library → Payments and from the receipt SMS/email. Only the owner and staff can view it.

10. Meet the teacher.
    The platform is about ONE teacher, but the home page never introduces them. Add DB-driven teacher profile fields to SiteSettings: photo, name, title, short bio, credentials/years teaching, subjects, social/WhatsApp links. Render a "Meet your teacher" section on the home page and a compact author card at the end of every lesson. Editable in Settings → General with a live preview.

==================================================
P2 — UI/UX POLISH (consistency and native-app feel)
==================================================

11. Mobile lists are too slow to scan.
    Observed: on phones, Explore, Home ("Latest free lessons", "Popular right now") and Library show one full-width 16:9 card per screen. 24 lessons need about 12,000px of scrolling.
    Fix: add a compact list-row variant of ContentCard: 96px 16:9 thumbnail on the left; category, 2-line title, meta and access badge on the right. Use it for vertical lists below md. Keep the large card for horizontal carousels and for desktop grids. The skeletons must match each variant.

12. Carousel alignment and desktop controls.
    Observed: on mobile, the featured carousel's first card sits flush against the screen edge while all other content has a 16px gutter. Snap alignment ignores the padding. On desktop, the carousel can only be scrolled sideways with a trackpad, and there is no visible control.
    Fix: add `scroll-padding-inline` matching the gutter to `.scroll-x`. On md+, add previous/next IconButtons (disabled at the ends) and soft edge fades. Use the same component for every horizontal row.

13. Lesson page layout on desktop.
    Observed at 1440px on a locked lesson: the 640px column sits left of centre with an empty right-hand area (the table of contents is hidden while locked), and the body text is narrower than, and indented from, the title, author row and cover.
    Fix: when there is no table of contents, centre the column. Make the title, meta row, cover, body, paywall, tags and comments share one left edge and one measure (about 68ch for text, with media allowed to be wider but aligned). Check light and dark at 1024, 1280 and 1440.

14. Consistent phone formatting.
    Observed: inputs use "0712 345 678", but Account shows "255713456789" and the success screen shows "255713456789".
    Fix: one formatPhone() helper that displays "0713 456 789" everywhere: account, library, admin users list and detail, orders, receipts, success screen and banners. Store and send 255XXXXXXXXX as now.

15. Password fields: add a show/hide toggle (eye icon, aria-pressed, same IconButton) to every password input: login, signup, change password and admin reset.

16. Editor status label.
    Observed: opening a lesson immediately shows "Saved 1s ago" although nothing was saved.
    Fix: initialise from the content's updated_at ("Last saved 6 Nov, 11:38"), and switch to the relative time only after a real save.

17. Payment settings wording.
    Observed: the badge next to "Snippe gateway" says "Live" while the Mode dropdown says "Test".
    Fix: use "Accepting payments" / "Payments off" for the enabled state, and show the mode as its own neutral badge.

18. Explore and editor small fixes:
    - On mobile, the subject chips row should show the selected subject's subcategories as a second row, with a clear "back to all subjects" chip.
    - The editor toolbar has no strikethrough, task list, callout or code block buttons, which only exist in the slash menu. Add an overflow "More" menu so every block type is reachable without knowing about "/".
    - The attach dialog title should quote the selected text ("Attach a file to “click here to get your book”").

==================================================
P3 — HARDENING AND HOUSEKEEPING
==================================================

19. Hosting: add `ENV HOSTNAME=0.0.0.0` to frontend/Dockerfile, and change frontend/serve-prod.sh to bind 0.0.0.0 by default. The current HOSTNAME=:: fails on IPv4-only hosts with EAFNOSUPPORT. Remove committed build output (frontend/tsconfig.tsbuildinfo) and ignore it.

20. Languages (do last, keep it small): the audience is Tanzanian and the content mixes English and Kiswahili. Add an English/Kiswahili switch for the interface text only (not lesson content), using a simple typed dictionary. Default to the browser language, save the choice per user, and show the switch in Account and the desktop header. Every student-facing string, including checkout, paywall, errors and emails/SMS templates, must have both languages. The admin panel can stay English.

==================================================
VERIFICATION (required before you finish)
==================================================
- Backend: `make test-backend` passes, with new tests for items 1, 2 (API side), 4, 6, 7, 8 and 9.
- E2E: extend frontend/e2e/ for items 1, 2, 3, 5, 6 and 9, and run the whole Playwright suite against the mock Snippe (backend/tools/mock_snippe.py).
- Screenshots: at 360, 390, 768, 1024 and 1440px, light and dark, capture home, explore, a locked lesson, an unlocked lesson, checkout (form, waiting, success), library, account, login, the maintenance page, the receipt, and admin dashboard, editor (with text selected), users, payments, notifications and storage settings. Fix every overlap, misalignment, overflow, horizontal scroll or inconsistent spacing you see before finishing.
- `pnpm lint` (tsc) passes and the browser console has no errors on any of those pages.
- Finish with a short report: what changed per item, which tests were added, and anything that still needs real credentials (Snippe live key, SMS provider, SMTP, AWS) or a real device to verify.
