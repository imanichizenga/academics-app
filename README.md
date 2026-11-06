# Darasa

A learning platform where one teacher publishes free and paid lessons to students. Payments use mobile money through [Snippe](https://docs.snippe.sh/docs/2026-01-25). Files live on local disk or Amazon S3.

"Darasa" is the demo name. The admin can change the name, logo and colour in **Settings → General**.

## Quick start

```bash
cp backend/.env.example backend/.env            # then set DJANGO_SECRET_KEY and FIELD_ENCRYPTION_KEY
docker compose up -d --build
docker compose exec backend python manage.py seed
```

Generate the encryption key with:

```bash
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

Open <http://localhost:3000>. The API docs are at <http://localhost:3000/api/docs/>.

| Demo account | Phone | Password |
|---|---|---|
| Admin (teacher) | 0754 000 001 | `darasa-demo-2026` |
| Editor | 0754 000 002 | `darasa-demo-2026` |
| Student with a subscription | 0754 100 000 | `darasa-demo-2026` |
| Subscriber (fixed, used by e2e) | 0754 200 001 | `darasa-demo-2026` |
| Lapsed subscriber (used by e2e) | 0754 200 002 | `darasa-demo-2026` |

These accounts are for development. Never seed a production database. The seed command refuses to run with `DJANGO_DEBUG=false` unless you pass `--force`.

Paid checkout stays off until a gateway passes its test. To try it without a Snippe account, see [Testing](#testing).

### Running without Docker for the app

```bash
make infra                     # Postgres and Redis only
cd backend && python3.12 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt && cd ..
cd frontend && pnpm install && cd ..
make migrate seed
make dev                       # Django, Celery worker, beat and Next.js
```

## Architecture

```
                         ┌───────────────────────────┐
  Browser ──────────────▶│ Next.js (site and /admin) │
  (student or teacher)   │ SSR, proxies /api/* ──────┼──┐
        │                └───────────────────────────┘  │
        │ direct multipart upload,                      ▼
        │ signed downloads,          ┌──────────────────────────────┐
        │ HLS segments               │ Django REST Framework        │◀── Snippe webhooks
        ▼                            │ gunicorn                     │    /api/payments/webhooks/snippe/
  ┌──────────────────┐               └───────┬──────────────┬───────┘
  │ S3 + CloudFront  │◀──────────────────────┤              │ calls /v1/payments
  │ (or local disk)  │                       ▼              ▼
  └────────▲─────────┘                  PostgreSQL      Snippe API
           │                                 ▲              ▲
  ┌────────┴─────────────────────────────────┴──────────────┴───┐
  │ Celery worker and beat, over Redis                          │
  │ transcoding, thumbnails, webhook processing, reconciliation,│
  │ scheduled publishing, expiry and reminders, upload cleanup  │
  └─────────────────────────────────────────────────────────────┘
```

| Path | Purpose |
|---|---|
| `backend/apps/payments/access.py` | `can_access` and `can_access_asset`. Every access decision goes through here. |
| `backend/apps/payments/services.py` | Orders, exactly-once completion and entitlements. All money state changes happen here. |
| `backend/apps/payments/diagnostics.py` | Gateway test steps. |
| `backend/apps/media_library/storage.py` | Local and S3 clients, built from the database at runtime. |
| `backend/apps/media_library/processing.py` | Thumbnails, previews, HLS with FFmpeg or MediaConvert. |
| `backend/apps/catalog/renderer.py` | TipTap JSON to sanitised HTML. |
| `backend/tools/mock_snippe.py` | Local fake of the Snippe API, for development and e2e only. |
| `frontend/src/app/globals.css` | All design tokens. |
| `frontend/src/components/ui/` | Shared primitives. |
| `frontend/src/components/editor/` | TipTap editor, including the `fileLink` mark. |

## Environment variables

**`backend/.env`**

| Variable | Purpose |
|---|---|
| `DJANGO_SECRET_KEY` | Signs sessions, tokens and local file URLs. |
| `FIELD_ENCRYPTION_KEY` | Fernet key for stored secrets. If you lose or change it, re-enter the gateway and storage secrets. |
| `DJANGO_DEBUG` | `false` in production. |
| `DJANGO_ALLOWED_HOSTS` | Comma-separated hostnames. |
| `POSTGRES_*`, `REDIS_URL` | Database and queue. |
| `FRONTEND_URL` | The site's public origin. Used for CORS, CSRF and redirects. |
| `PUBLIC_API_URL` | The backend's public HTTPS origin. Snippe calls this. |
| `COOKIE_SECURE` | `true` behind HTTPS. |
| `NUM_PROXIES` | How many of your own proxies sit in front of Django. Default 1. See [Deployment](#deployment). |

**Frontend**

| Variable | Purpose |
|---|---|
| `INTERNAL_API_URL` | How the Next.js server reaches Django. |
| `NEXT_PUBLIC_SITE_URL` | Public origin, for canonical links and the sitemap. Set it at build time. |

S3 and Snippe credentials are not environment variables. They are stored encrypted in the database and set in the admin panel.

## Configuring Snippe

1. In the [Snippe dashboard](https://snippe.sh/dashboard), open **Settings → API Keys** and create a key with the scopes `collection:read` and `collection:create`. The key is shown only once.
2. Open **Settings → Webhook Secret** and copy the signing secret.
3. In this app, open **Admin → Settings → Payments**, paste both and save.
4. Copy the webhook URL shown there into the Snippe dashboard. Your backend must be publicly reachable over HTTPS for this to work.
5. Press **Test configuration** and fix anything marked red.
6. Turn on **Enable payments**.
7. Send a **Live test payment** to your own phone. This moves TZS 500 of real money.

Changing the API key, webhook secret, session token or base URL turns payments off until the test passes again. This is deliberate.

**What the create-permission check does.** It posts a deliberately invalid body to `POST /v1/payments`. Snippe rejects it during validation, so no money moves. A `400 validation_error` proves the key has `collection:create`, and a `403` proves it does not. Any other answer shows as a warning that explains the result, and the live test payment is then the way to confirm.

**Hosted checkout.** Snippe documents a JWT for session endpoints, not the `snp_` key. The test step calls the sessions API with your session token, or the API key if no token is set, and reports what happens. Hosted checkout stays off until that step passes, and customers use USSD push meanwhile.

## Configuring S3, CloudFront and MediaConvert

Local disk works out of the box. To move to S3, fill in **Admin → Settings → Storage**, save, and press **Test storage**. Existing local files are not migrated.

Create a private bucket with Block Public Access on. An optional second bucket can hold covers and thumbnails, in which case it needs public read access, directly or through CloudFront.

### IAM policy for the app

Replace `YOUR-BUCKET` and `ACCOUNT`.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:ListBucket", "s3:GetBucketCORS", "s3:ListBucketMultipartUploads"],
      "Resource": "arn:aws:s3:::YOUR-BUCKET"
    },
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:AbortMultipartUpload", "s3:ListMultipartUploadParts"],
      "Resource": "arn:aws:s3:::YOUR-BUCKET/*"
    },
    {
      "Effect": "Allow",
      "Action": ["mediaconvert:DescribeEndpoints", "mediaconvert:CreateJob", "mediaconvert:GetJob"],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": "iam:PassRole",
      "Resource": "arn:aws:iam::ACCOUNT:role/YOUR-MEDIACONVERT-ROLE"
    }
  ]
}
```

If you use a public bucket, add it to the two S3 statements. Omit the last two statements if you use the FFmpeg worker.

### MediaConvert role

Create a role that `mediaconvert.amazonaws.com` can assume, with read and write access to the bucket:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["s3:GetObject", "s3:PutObject"],
    "Resource": "arn:aws:s3:::YOUR-BUCKET/*"
  }]
}
```

Job status is polled every 30 seconds, so no EventBridge setup is needed.

### Bucket CORS

Browsers upload directly to S3, so the bucket needs this rule. The admin page shows the same JSON with your origin filled in.

```json
[{
  "AllowedOrigins": ["https://your-site.example"],
  "AllowedMethods": ["GET", "PUT", "HEAD"],
  "AllowedHeaders": ["*"],
  "ExposeHeaders": ["ETag"],
  "MaxAgeSeconds": 3600
}]
```

### CloudFront signed URLs

1. Generate a key pair:
   ```bash
   openssl genrsa -out private.pem 2048
   openssl rsa -pubout -in private.pem -out public.pem
   ```
2. In CloudFront, add the public key under **Public keys**, and create a **Key group** containing it.
3. Create a distribution with the bucket as origin, using Origin Access Control, and add the policy CloudFront suggests to the bucket.
4. Under the behaviour, set **Restrict viewer access** to your key group, and allow `response-content-disposition` through in the origin request policy so that downloads get the right filename.
5. In the app, enter the domain, the public key id, and the contents of `private.pem`.

Without CloudFront, the app uses S3 presigned URLs.

## Testing

```bash
make test-backend     # Needs Postgres and Redis running.
make test-e2e         # See below.
```

The e2e suite needs a freshly seeded stack, the mock gateway, and Google Chrome. Chrome is required because Playwright's bundled Chromium has no H.264 decoder, so it cannot play the video tests.

```bash
docker compose exec -d backend python tools/mock_snippe.py    # or `make mock-snippe` without Docker
cd frontend
pnpm exec playwright install chromium chrome
pnpm exec playwright test
```

The suite points the gateway at the mock, so reseed afterwards. The mock declines phones ending in `0000`, and leaves phones ending in `1111` pending.

`frontend/e2e-smoke.mjs` loads pages at every breakpoint, fails on console errors or horizontal overflow, and writes screenshots to `screenshots/`:

```bash
node e2e-smoke.mjs "/,/explore" 360,390,768,1024,1440
```

`frontend/e2e-shots.mjs` is the full visual sweep: every student and admin page, the three checkout stages and the maintenance page, at five widths in light and dark, in `screenshots/sweep`. It fails on console errors, hydration errors and horizontal overflow, and needs the mock gateway running.

## Configuring SMS and email

Everything is in **Admin → Settings → Notifications**. Secrets are encrypted at rest and never returned by the API. All sending happens in Celery, with up to 5 attempts, so a slow provider cannot hold up a page or a payment.

- **Beem Africa:** API key, API secret and an approved sender ID.
- **Africa's Talking:** username, API key and optionally a sender ID. Use the username `sandbox` for their sandbox.
- **Generic HTTP:** a URL, method, JSON headers and a body template, with `{to}`, `{message}`, `{sender}`, `{api_key}` and `{api_secret}`. Values are escaped for JSON or URL encoding automatically. Any 2xx reply counts as sent.
- **Email:** any SMTP server.

Each channel has a test that sends a real message and shows a step checklist. Five editable messages exist in English and Kiswahili: receipt, account created, subscription ending, subscription ended and reset code. Turning SMS on also turns on password reset by SMS. While it is off, `/forgot` shows the teacher's contact details.

## Deployment

- Set `DJANGO_DEBUG=false`, `COOKIE_SECURE=true`, a real `DJANGO_SECRET_KEY`, and the public URLs.
- **Put a reverse proxy in front of the site**, such as nginx, Caddy or a cloud load balancer. It must set `X-Forwarded-For` and `X-Forwarded-Proto`. Rate limits read the last `X-Forwarded-For` entry, so if clients can reach Next.js or Django directly they can forge their address and dodge IP limits. Set `NUM_PROXIES` to the number of proxies you run in front of Django, counting Next.js when traffic goes through it.
- Snippe must be able to reach `PUBLIC_API_URL/api/payments/webhooks/snippe/`.
- Build the frontend with `NEXT_PUBLIC_SITE_URL` set.
- Back up Postgres, and keep `FIELD_ENCRYPTION_KEY` somewhere safe.
- With local storage, run the backend and worker on the same volume. Use S3 for anything that runs on more than one machine.
- Give the worker enough CPU if it transcodes with FFmpeg. Two concurrent 1080p jobs will use it fully.
- Change the demo credentials, or better, create the first admin with `manage.py createsuperuser` and do not seed.

## Decisions

Where the brief was ambiguous, or the docs differed from it, this is what the code does.

**Snippe**

- **Payment expiry.** Snippe's pages disagree: 4 hours in one place, a 1-hour default for `payment.expired` in another. The app trusts each payment's `expires_at`.
- **`GET /v1/payments/{ref}` returns no metadata**, so orders are matched by stored reference. `metadata.order_id` is the fallback for webhooks.
- **Webhook timestamps** more than 5 minutes off are refused in both directions, not only when old.
- **Late success is honoured.** If a customer cancels or an order fails, and Snippe later reports the money moved, the order completes. Cancel is local, since Snippe documents no cancel for payments.
- **Amount mismatch.** If a webhook amount differs from the order, nothing is granted, and the order records why.

**Accounts and access**

- **A logged-in buyer keeps the purchase on their own account**, even if a relative's phone paid. The brief's "find by phone" applies to guests.
- **A claim token never opens a staff account.** Payment succeeds and the entitlement is granted, but a staff member must log in with a password. This narrows the brief's auto-login rule.
- **The claim token's 30 minutes start at payment**, not at order creation. Otherwise anyone approving after 30 minutes would lose the auto-login.
- **The starter password accepts the number as people type it.** While `must_change_password` is on and the stored password is still the phone number, `07…`, `7…`, `255…` and `+255…` all work, with or without spaces. Once the password changes, none of them do. This does not change the risk noted under Known limitations.
- **Receipts are for the buyer and admins.** The brief says owner and staff, but editors are documented and enforced as never seeing money, so a receipt returns 404 to them.
- **Forced password change.** A password login is held at the change-password screen until it is done. A session from a claim token can use its purchase straight away, and shows the banner, as the brief describes.
- **Failed logins lock a phone for 15 minutes after 8 tries.** This is on top of the per-IP limit.
- **Purchased content cannot be deleted.** Archive it, and buyers keep access.
- **Files not attached to any content** are refused to non-staff.
- **Maintenance mode is enforced by the API as well as the pages.** Non-staff get a 503 with `code: "maintenance"`, except for sign-in, public site settings, the Snippe webhook, health checks and the admin API. An order in flight can still report status, be claimed, be cancelled and resend its prompt. Sign-in pages and the hosted-checkout return page live in the `(open)` route group, which is never hidden.

**Content and media**

- **All API routes are under `/api/v1/`**, including `/orders/{id}/status/` and `/media/{id}/download/`, which the brief wrote without the version. The webhook stays at the exact path the brief gives.
- **Search uses PostgreSQL's `simple` configuration with prefix matching**, because lessons mix English and Kiswahili and a stemmer would suit only one.
- **Body images load through an access-checked URL**, not a public one, so images in paid lessons are protected too.
- **Locked content is cut on the server.** Articles send only the preview blocks, PDFs use a separate file of the first pages, audio a separate clip, and HLS a shortened playlist, with later segments refused.
- **HLS is delivered through a Django endpoint** that returns playlists and redirects each segment to a short signed URL. This uses signed URLs, not cookies, because cookies would need CloudFront on the same parent domain as the site.
- **Attach file opens a small dialog**, a bottom sheet on phones, rather than a popover. A popover anchored to the bubble menu closes when its own inputs take focus. The title quotes the selected text.
- **Text colour swaps the toolbar's contents for the swatches** instead of opening a floating popover, for the same reason: focus must stay in the editor so the selection survives.
- **Below `md`, selected text gets a bottom bar, not a bubble,** because a floating bubble clashes with the phone's own selection menu. It rises above the on-screen keyboard. Strikethrough and inline code are left out to keep Link on screen; both are in the toolbar's More menu.
- **The `fileLink` mark also stores `filename` and `size`**, for the editor tooltip. Students always see the current values from the asset.
- **Autosave applies to published lessons too.** Edits to a live lesson reach students on save.

**Notifications**

- **Message text is kept only until delivery**, encrypted, because it can be a reset code. The log keeps the time, channel, masked recipient, template, status and provider response.
- **Beem follows its published OpenAPI spec.** Africa's Talking follows its official Python SDK, because its documentation site refused automated access. The `/version1/messaging` call matches the SDK. The response handling (status codes 100, 101 and 102 mean accepted) is from memory of their docs, so confirm it with the test button.
- **The language of a message** comes from the account, or from the language used at checkout for a new account.

**Languages**

- **English and Kiswahili cover the student interface, messages and API errors, not lesson content.** The admin panel is English. Strings live in `frontend/src/lib/i18n.ts`, where a string missing from either language fails the build.
- **The order of preference is the account's saved choice, then the `lang` cookie, then the browser's language.** A student who picks a language before logging in keeps it.
- **The Kiswahili was written without a native-speaker review.** Have someone read it before launch.

**Other**

- **Public pages render per request with a 30 to 60 second data cache.** Published changes can take up to a minute to appear to anonymous visitors. Site settings refresh within about 10 seconds, so turning maintenance on shows on pages that quickly. The API enforces it immediately.
- **Dates are shown in Tanzanian time** (`Africa/Dar_es_Salaam`) for every visitor, so the server and browser always agree.
- **The service worker only provides the offline page.** It caches no lessons, so paid content cannot linger on a device.
- **Resending a USSD prompt is limited** to 4 a minute and 5 per order.
- **Reconciliation checks at most 30 orders a minute**, oldest-checked first, to stay under Snippe's limit of 60 requests a minute.

## Known limitations

- **The starter password is guessable.** Anyone who knows a phone number can log in to an auto-created account until its owner changes the password, and change it themselves. With SMS enabled, a reset code is the safer route.
- **Delivery reports are not read.** "Sent" means the provider accepted a message, not that it reached the phone.
- **Upload resume works within a browser session.** Pause, resume and automatic retry work, but closing the tab abandons the upload.
- **Office files have no preview image.** DOCX, PPTX and XLSX show a file card with a download button. Rendering them would need LibreOffice on the worker.
- **Math (KaTeX) is not implemented.** It was optional.
- **MediaConvert outputs no scrubbing sprite**, so thumbnail previews on the seek bar need the FFmpeg worker. The output preset field is stored but not used: jobs use the built-in ladder.
- **Not verified on real devices.** Layouts were tested in emulated browsers. Safari's native HLS path has not been run, and neither has PWA installation on a real phone.
