# Kinney Karate — Cloudflare Setup Guide

This is a one-time setup to go from zero to a deployed staging site on Cloudflare Pages. Work through these steps in order.

---

## Prerequisites

- Node.js 18+ installed
- Cloudflare account (free tier is fine)
- Wrangler CLI: `npm install -g wrangler`
- Log in: `wrangler login`

---

## Step 1 — Create the D1 Database

```bash
wrangler d1 create kinneykarate-db
```

This prints output like:

```
✅ Successfully created DB 'kinneykarate-db'

[[d1_databases]]
binding = "DB"
database_name = "kinneykarate-db"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

**Copy the `database_id` value** and paste it into `wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "kinneykarate-db"
database_id = "PASTE_YOUR_ID_HERE"   # ← replace this line
```

---

## Step 2 — Create the KV Namespace

```bash
wrangler kv:namespace create CACHE
```

Output will include an `id`. Paste it into `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "CACHE"
id = "PASTE_YOUR_ID_HERE"   # ← replace this line
```

---

## Step 3 — Create the R2 Bucket

```bash
wrangler r2 bucket create kinneykarate-images
```

No ID to copy — the bucket name in `wrangler.toml` (`kinneykarate-images`) is all that's needed.

---

## Step 4 — Run the Database Migration

```bash
# Local (for dev):
npx wrangler d1 execute kinneykarate-db --local --file db/migrations/0001_initial.sql

# Remote (for production/staging):
npx wrangler d1 execute kinneykarate-db --remote --file db/migrations/0001_initial.sql
```

---

## Step 5 — Seed the Catalog

```bash
# Local:
node db/seed.js | npx wrangler d1 execute kinneykarate-db --local --file -

# Remote:
node db/seed.js | npx wrangler d1 execute kinneykarate-db --remote --file -
```

This inserts products, variants, bundle components, and initial inventory from `db/catalog.seed.json`.

---

## Step 6 — Set Secrets

These are never committed to git. Set each one via wrangler:

```bash
wrangler secret put STRIPE_SECRET_KEY
# Paste your Stripe test secret key (starts with sk_test_...)

wrangler secret put STRIPE_WEBHOOK_SECRET
# Paste the webhook signing secret from Stripe Dashboard → Webhooks

wrangler secret put RESEND_API_KEY
# Paste your Resend API key

wrangler secret put GOOGLE_CALENDAR_ID
# Paste the Google Calendar ID (e.g. abc123@group.calendar.google.com)

wrangler secret put GOOGLE_CALENDAR_API_KEY
# Paste your Google Cloud API key (Calendar API enabled)

wrangler secret put TURNSTILE_SECRET
# Paste the Cloudflare Turnstile secret key for the contact form
```

For local dev, copy `.dev.vars.example` to `.dev.vars` and fill in test values — this file is gitignored.

---

## Step 7 — Create the Pages Project

In the Cloudflare Dashboard:

1. Go to **Workers & Pages → Create → Pages → Connect to Git**
2. Connect your GitHub account and select the `kinneykarate` repo
3. Set build settings:
   - **Framework preset:** Astro
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
4. Click **Save and Deploy**

After the first deploy, Cloudflare gives you a `*.pages.dev` URL for staging.

### Bind resources to the Pages project

In the Pages project → **Settings → Functions → Bindings**, add:

| Type | Variable name | Value |
|------|--------------|-------|
| D1 Database | `DB` | `kinneykarate-db` |
| KV Namespace | `CACHE` | `CACHE` (the namespace you created) |
| R2 Bucket | `IMAGES` | `kinneykarate-images` |

Under **Settings → Environment variables**, add all the secrets from Step 6 (or they carry over from `wrangler secret put` if deploying via Wrangler Pages).

---

## Step 8 — Configure the Stripe Webhook

1. In Stripe Dashboard → **Developers → Webhooks → Add endpoint**
2. Endpoint URL: `https://YOUR-PROJECT.pages.dev/api/webhook`
3. Events to listen for: `checkout.session.completed`
4. Copy the **Signing secret** and set it: `wrangler secret put STRIPE_WEBHOOK_SECRET`

---

## Step 9 — Configure Cloudflare Turnstile (Contact Form)

1. In Cloudflare Dashboard → **Turnstile → Add site**
2. Domain: your Pages `*.pages.dev` URL (and later `kinneykarate.com`)
3. Copy the **Site key** and paste it into `src/pages/about.astro` where `TODO_TURNSTILE_SITE_KEY` appears
4. Copy the **Secret key** and run: `wrangler secret put TURNSTILE_SECRET`

---

## Step 10 — Validate a Test Transaction (Milestone 8)

Before going live with real Stripe keys:

1. Open the staging `*.pages.dev` URL
2. Add an item to the cart, go to checkout
3. Use Stripe test card `4242 4242 4242 4242`, any future expiry, any CVC
4. Confirm the order confirmation email arrives (via Resend)
5. Confirm the staff notification email arrives at `orders@kinneykarate.com`
6. Check the admin panel (`/admin`) — the order should appear with status `paid`
7. Check inventory was decremented for stocked items

Once this passes, swap to live Stripe keys and notify Joe for DNS cutover.

---

## Step 11 — Go Live (DNS Cutover — Joe does this)

1. In Pages project → **Custom Domains → Set up a custom domain**
2. Enter `kinneykarate.com`
3. Follow the DNS instructions (add a CNAME or change nameservers)
4. SSL is automatic via Cloudflare

**Do not perform DNS changes without Joe's sign-off.**

---

## Local Dev Quick Reference

```bash
npm install
cp .dev.vars.example .dev.vars   # fill in test values
npx wrangler d1 execute kinneykarate-db --local --file db/migrations/0001_initial.sql
node db/seed.js | npx wrangler d1 execute kinneykarate-db --local --file -
npm run dev
```

Visit `http://localhost:4321`. The Cloudflare bindings (D1, KV, R2) are proxied locally via Wrangler's platform proxy.
