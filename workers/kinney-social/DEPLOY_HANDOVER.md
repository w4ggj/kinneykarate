# kinney-social — Deploy Handover

## For Joe: what to do, step by step

**Where things stand:** the student posting site is built and saved in GitHub. It is **not live yet**. Getting it live means uploading it to your Cloudflare account and giving it three passwords/keys. The last Claude session couldn't do the upload because its internet access blocks Cloudflare.

You do **three things**. A Claude session does everything else.

### Thing 1: Let a Claude session reach Cloudflare (2 minutes)

In this same Claude app:
1. At the top of the session, click the **environment name** (next to the session title).
2. Click **Edit**.
3. Find **Network access**. Either choose **Full**, or keep your current level and add `api.cloudflare.com` to the allowed domains.
4. Check that `CLOUDFLARE_API_TOKEN` is still in the environment variables. You already added it, so leave it.
5. **Save**.
6. Start a **new session** with the `kinneykarate` repo and paste the message from "Paste this into the new session" at the bottom of this section.

That session deploys the site and tells you when it's time for Thing 2.

### Thing 2: Enter the passwords in Cloudflare (10 minutes)

The Claude session will say when it's ready for this. For each row below, **copy the value from the left-hand site and paste it into Cloudflare**, never into the chat.

First, open the place you paste into:
1. Go to **dash.cloudflare.com** and log in.
2. Left menu: **Compute (Workers)** → **Workers & Pages**.
3. Click **kinney-social**.
4. Click **Settings** → **Variables and Secrets** → **+ Add**.
5. For each row: set **Type** to **Secret**, put the **Name** exactly as written, paste the **Value**, click **Deploy**.

| Name (type exactly) | Where to copy the value from |
|---|---|
| `SUPABASE_URL` | Type this exactly: `https://uhurmdyqsrzevpzghzen.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | **supabase.com** → your Balance Your World project → **Project Settings** (gear icon) → **API Keys** → the **service_role** key → click to reveal → copy |
| `CANVA_CLIENT_ID` | **canva.com/developers** → **Your integrations** → **student creation** → **Configuration** → Client ID |
| `CANVA_CLIENT_SECRET` | Same page → Client secret. If you can't see it, click **Generate secret** and copy the new one. |

Then tell the Claude session "secrets are in" and it will test everything.

### Thing 3: Instagram (later, whenever you're ready)

The site works without this. Approving a post just won't send it to Instagram yet. When you're ready, tell a Claude session: *"Set up Instagram posting for kinney-social, walk me through it."* It will need the Kinney Karate Instagram set to a **Business** account and linked to the Kinney Karate Facebook Page.

### Before telling students
Send in one real test post yourself (a photo and a video), approve them at **social.kinneykarate.com/admin**, and make sure they look right.

### Paste this into the new session

> Deploy the kinney-social Worker. Repo w4ggj/kinneykarate, branch `claude/funny-meitner-aw0qum`, folder `workers/kinney-social/`. Follow `workers/kinney-social/DEPLOY_HANDOVER.md` ("For the Claude session" section) exactly. I'm not technical: tell me one step at a time what to click, never ask me to paste keys into the chat, and tell me in plain English when it's live.

---

## For the Claude session doing the deploy

**Repo:** `w4ggj/kinneykarate`, branch `claude/funny-meitner-aw0qum`, draft PR #56. **Folder:** `workers/kinney-social/`. It is a standalone Cloudflare Worker with its own `wrangler.toml`. It is **not** part of the Astro/Pages site in the repo root, and deploying it does not touch kinneykarate.com.

Read `wrangler.toml`, `src/index.js` (header comment) and `HANDOVER.md` (original design decisions) before changing anything. The PR description has the full design.

### Already done in Cloudflare (don't redo)
- D1 database `kinney-social` (id `0554dc39-d3cd-4ec7-8c2b-addee8512b86`) already has all tables: `lookup_attempts`, `canva_sessions` and `ig_publish`. The migrations in `migrations/` use `IF NOT EXISTS`, so re-running them is harmless but unnecessary.
- The R2 bucket `kinney-social-media` exists.
- The Supabase table `social_submissions` exists in the BYW project (`uhurmdyqsrzevpzghzen`) with RLS on. **Do not add an anon policy.**

### Steps

1. **Check access.** From `workers/kinney-social/`:
   ```bash
   npx wrangler whoami
   ```
   It must show the Cloudflare account that owns `kinney-camp` and `byw-checkin-worker`. If it fails, Joe needs to run `npx wrangler login`, or set `CLOUDFLARE_API_TOKEN` (Workers Scripts: Edit, D1: Edit, R2: Edit, plus Workers Routes/Custom Domains for the kinneykarate.com zone) and `CLOUDFLARE_ACCOUNT_ID`.

2. **Deploy.**
   ```bash
   cd workers/kinney-social
   npx wrangler deploy
   ```
   This creates the `kinney-social` Worker, uploads `public/` as static assets, and registers two crons: every minute and hourly at :17. It deploys fine without secrets; the endpoints that need them will fail until step 3 is done.

3. **Secrets.** Joe enters these himself. **Never ask Joe to paste a key into the chat.** The easiest way for him is the dashboard: Workers & Pages → `kinney-social` → Settings → Variables and Secrets → Add → type **Secret**. The alternative is to run `npx wrangler secret put NAME` and let Joe type the value at the terminal prompt.

   | Secret | Where Joe finds it |
   |---|---|
   | `SUPABASE_URL` | `https://uhurmdyqsrzevpzghzen.supabase.co` (not sensitive; you can set this one) |
   | `SUPABASE_SERVICE_ROLE_KEY` | Supabase dashboard → BYW project → Project Settings → API keys → `service_role`. It's the same key `byw-checkin-worker` uses. |
   | `CANVA_CLIENT_ID` | Canva Developers portal → Your integrations → "student creation" (App ID `AAHOGI6-fG0`) → Configuration |
   | `CANVA_CLIENT_SECRET` | Same page. Generate a new secret if the old one wasn't saved. |
   | `IG_ACCESS_TOKEN` | Optional for launch; see step 6 |

4. **Domain.** Dashboard → Workers & Pages → `kinney-social` → Settings → Domains & Routes → Add → **Custom domain** → `social.kinneykarate.com`. This only adds the `social` subdomain. It does **not** change kinneykarate.com itself, which still points at the old site until Joe's cutover. Don't touch any other DNS.

5. **Smoke test** (after the domain is active):
   - `https://social.kinneykarate.com/api/health` → `{"ok":true}`
   - `https://social.kinneykarate.com/` shows the "Make a post" page.
   - Joe enters a real active student's name + DOB. It should go to Canva sign-in. If it says "couldn't find a match", check the student has `date_of_birth` set; 5 of 87 active students don't.
   - Complete one real **photo** post and one real **video** post end to end. The Canva API calls were written from memory because canva.dev was blocked in the build session. If any Canva step fails, check `npx wrangler tail` and fix against the current Canva Connect docs: OAuth token exchange, `POST /v1/designs` with a custom width/height, `correlation_state` / `correlation_jwt` return navigation, and `POST /v1/exports` with `jpg`/`mp4`.
   - `https://social.kinneykarate.com/admin`: log in with a BYW staff account; the submissions show under Pending.
   - **Watch for:** the Canva app is **Private**. If students' own Canva accounts can't authorize it (private apps may only work for members of the owning Canva team), tell Joe. The options are adding students to the team or submitting the app for public review.

6. **Instagram** (when Joe is ready):
   - KK's Instagram must be a **Business or Creator** account linked to a Facebook Page, using the same Meta app setup as Balance Gaming's publisher.
   - It needs a long-lived token with `instagram_content_publish` and `instagram_manage_insights`. Joe sets it as the `IG_ACCESS_TOKEN` secret.
   - Put KK's numeric Instagram account id (not the @handle) in `wrangler.toml` as `IG_USER_ID`, then redeploy. If the token came from Instagram Login rather than Facebook Login, also set `GRAPH_HOST = "graph.instagram.com"`.
   - Test: approve one post in /admin. It should show under Posted with a "View on Instagram" link, or under Approved with an error and a retry button.

7. **Report back** to Joe in plain language: what's live, what still needs him, and anything that failed.

### Rules (from the project; don't break these)
- Don't commit secrets or `.dev.vars`.
- Don't change DNS for kinneykarate.com itself; Joe does that cutover. Adding the `social` subdomain as a Worker custom domain is expected.
- Don't swap any Stripe keys; they're unrelated to this project.
- Don't make the student name+DOB lookup "more secure" with logins or magic links. The looseness is intentional because staff approval is the safety net.
- Student names must never appear in anything posted publicly.

### If something breaks
- Live logs: `npx wrangler tail kinney-social`
- D1: `npx wrangler d1 execute kinney-social --remote --command "SELECT * FROM ig_publish"`
- An Instagram post stuck in an error state can be retried from /admin → Approved.
