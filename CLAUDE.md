# Kinney Karate — Project Guide

## What this is

Astro + Cloudflare Pages rebuild of kinneykarate.com.

## Stack

- **Frontend:** Astro (hybrid SSR), deployed to Cloudflare Pages
- **API/Workers:** Cloudflare Workers (store-api, calendar, webhook, admin-api)
- **Data:** Cloudflare D1 (`kinneykarate-db`)
- **Media:** Cloudflare R2 (`kinneykarate-images`)
- **Cache:** Cloudflare KV
- **Payments:** Stripe (KK account, test mode until Joe swaps to live keys)
- **Email:** Resend
- **Forms:** Cloudflare Turnstile

## Dev setup

```bash
npm install
cp .dev.vars.example .dev.vars   # fill in test values
npx wrangler d1 execute kinneykarate-db --local --file db/migrations/0001_initial.sql
node db/seed.js | npx wrangler d1 execute kinneykarate-db --local --file -
npm run dev
```

## Key rules

- **Never commit `.dev.vars`** — real secrets go in via `wrangler secret put`
- **No Stripe live keys** until Joe approves after test transaction
- **No DNS changes** — Joe does the cutover
- **No localStorage/sessionStorage** for cart — in-memory only
- **Server-side prices only** — never trust client-submitted prices
- **Three separate Stripe accounts** — never cross-wire KK / Memorial Fund / BYW
- Tuition is never paid on this site

## Build milestones

1. ✅ Scaffold — Astro + Pages, wrangler.toml, .dev.vars.example
2. ✅ Data layer — D1 schema + migrations + catalog.seed.json
3. ✅ Content site — all pages scaffolded, nav, footer, announcement bar
4. ✅ Events — calendar Worker + KV cache + month/agenda view
5. ✅ Phase 1 staging review — Joe signed off
6. ✅ Storefront — product grid, product pages, in-memory cart
7. ✅ Checkout — Stripe Checkout session, Stripe Tax, surcharge, webhook
8. ✅ Content complete — instructor bios, class times, news posts, redirects, Turnstile, product images, Discord URL
9. ✅ Admin console — products, inventory/scanning, queue, orders, settings
10. ✅ Inventory + barcode scanning — check-in/take-out, movements ledger
11. ✅ Cutover prep — `public/_redirects` 301 map
12. 🔴 **Go-live by Joe** — attach kinneykarate.com as custom domain on Pages project, swap Stripe to live keys after test transaction

## Pending

- **Go-live** — Joe attaches kinneykarate.com as custom domain on the Cloudflare Pages project
- **Stripe live keys** — Joe swaps in after validating a test transaction end-to-end
