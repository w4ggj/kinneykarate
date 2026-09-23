# Kinney Karate Student Social Poster — Handover

## The goal

Increase student engagement on the Kinney Karate Instagram by letting students create their
own posts and rewarding them for engagement. Students need real creative input (not just a
raw photo upload) since Instagram's own creation tools can't be embedded elsewhere, so Canva
is being used as the design surface. Nothing goes live without staff approval — approval is
the actual safety net for the whole project, not the identity check on the way in.

Flow: student identifies themselves → designs a post in an embedded Canva editor → submits
with a caption → staff approves/rejects in a queue → approved posts get published to Kinney
Karate's Instagram → engagement (likes/comments) gets tracked per post → student gets
rewarded after crossing an engagement threshold.

## Stack / conventions to match

- Astro + Cloudflare Pages/Workers, same as the rest of Joe's sites (camp.kinneykarate.com is
  the closest sibling project — same subdomain pattern, same "small Cloudflare Worker backing
  a static-ish frontend" shape).
- Site lives at **social.kinneykarate.com**.
- Data lives in the **Balance Your World** Supabase project (project ref
  `uhurmdyqsrzevpzghzen`) — this is the live production DB for Kinney Karate's whole
  student/family system, not a fresh DB for this project. Reuse it, don't stand up a new one.
- Talk to Supabase from Workers via direct PostgREST `fetch()` calls with the service_role
  key (`env.SUPABASE_URL` / `env.SUPABASE_SERVICE_ROLE_KEY` headers), matching the pattern
  already used in `byw-checkin-worker` and `byw-stripe-webhook`. Don't reach for the Supabase
  JS client in a Worker.

## What's already built

**Supabase (live now):**
- New table `public.social_submissions` in the BYW project. Columns: `id`, `student_id` (FK
  → `students.id`), `canva_design_id`, `canva_edit_url`, `caption`, `media_url`, `status`
  (`pending`/`approved`/`rejected`/`posted`), `rejection_reason`, `submitted_at`,
  `reviewed_at`, `reviewed_by` (FK → `staff.id`), `instagram_post_id`,
  `instagram_permalink`, `posted_at`, `likes_count`, `comments_count`, `reach_count`,
  `last_stats_check_at`, `reward_threshold`, `reward_status`
  (`not_yet`/`flagged`/`given`), `reward_given_at`, `reward_notes`, `created_at`.
- RLS is on, with exactly one policy: `staff_all_social_submissions`, using the existing
  `is_staff()` function. **There is no anon/public policy on this table, on purpose** — the
  only way in from outside is through the Worker below using the service_role key, which
  bypasses RLS. Don't add an anon policy to "make the frontend easier"; that would expose
  every submission (and indirectly the roster) to anyone.

**Cloudflare (code written, NOT deployed — see below):**
- A new D1 database, name `kinney-social`, id `0554dc39-d3cd-4ec7-8c2b-addee8512b86`, with
  one table `lookup_attempts` (`id`, `ip`, `success`, `created_at`) for rate-limiting the
  identity lookup.
- A Worker (`kinney-social`) with two endpoints, delivered as files in this handover:
  - `POST /api/lookup` — body `{ firstName, lastName, dob }` (dob as `YYYY-MM-DD`). Looks up
    `students` by DOB + `status=active`, then compares names case-insensitively in JS.
    Returns `{ ok: true, studentId }` or `{ ok: false, error }`. Rate-limited: 8 failed
    attempts per IP in 15 minutes locks that IP out (looser than the 5-attempt admin lockout
    in kinney-camp, since kids will typo their own name/birthday more than an adult typos a
    PIN).
  - `POST /api/submissions` — body `{ studentId, caption, canvaDesignId?, canvaEditUrl?,
    mediaUrl? }`. **Re-validates `studentId` against `students` (status=active) server-side
    before inserting** — never trust a studentId the browser hands back without rechecking
    it's a real, currently-active student. Inserts into `social_submissions` with
    `status: 'pending'`.
- `wrangler.toml` for the above, with the D1 binding filled in. `SUPABASE_URL` and
  `SUPABASE_SERVICE_ROLE_KEY` need to be set as `wrangler secret put` values (reuse the same
  BYW project values `byw-checkin-worker` already uses — don't create new ones).

**Canva (live now):**
- A Canva "app" (their unified term — covers what used to be Connect APIs), name "student
  creation", App ID `AAHOGI6-fG0`, Private distribution.
- Client ID + Client Secret generated. Scopes enabled: `asset` (read/write), `design:content`
  (read/write).
- Redirect URL (OAuth callback) registered: `https://social.kinneykarate.com/canva-callback`
- Return URL (Canva's "send them back after editing" feature) registered:
  `https://social.kinneykarate.com/canva-return`
- Neither URL exists yet — both are placeholders waiting on the actual site.
- Joe has the Client ID/Secret; get them from him directly, they were never put in writing
  here for obvious reasons.

## What's NOT built yet

1. **Deploying the `kinney-social` Worker.** Code is done (attached), just needs
   `wrangler deploy` from a real repo, the two secrets set, and a route added at
   social.kinneykarate.com in the Cloudflare dashboard.
2. **The student-facing frontend.** Name/DOB form (calls `/api/lookup`) → on success, embed
   the Canva editor (autofill/create-design flow using the Client ID, `design:content` scope)
   → student edits → Canva's Return Navigation sends them back → caption field → submit
   (calls `/api/submissions` with the studentId from step one plus whatever Canva gives back
   for the design).
3. **The staff approval queue.** A view over `social_submissions` filtered to `pending`,
   approve/reject actions, probably living inside the existing BYW staff admin panel or as
   its own small authenticated page — staff already has real Supabase Auth logins via the
   `staff` table, so this can and should require a real login, unlike the student side.
4. **Instagram publish on approval**, using whatever's already wired up for
   Balance Gaming's Instagram publisher (see `balance-social` in Joe's other notes) — same
   idea, different account.
5. **Engagement polling** — a scheduled job hitting the Instagram Graph API media insights
   endpoint for each `posted` submission, updating `likes_count`/`comments_count`/
   `reach_count`, and flagging `reward_status = 'flagged'` once a submission crosses
   `reward_threshold`.

## Known gotchas / decisions already made (don't redo these)

- **Why name+DOB instead of a login or a magic link:** considered putting this inside the BYW
  parent/student portal — rejected because most students' portal access is literally their
  parent's shared login, so a student submission page there would double as a door into the
  parent's account. Considered per-student magic links (like the camp system's balance
  pages) — would have worked, but Joe wants the simpler name+DOB lookup since every
  submission is staff-approved anyway, so a wrong/fake identity gets caught at approval
  rather than needing to be prevented up front. **Don't "improve" this into a stronger auth
  scheme unless Joe asks** — the looseness is intentional.
- **Why the lookup can't just query `students` from the browser with the anon key:** the
  roster contains real birthdates for minors. A client-side query (even RLS-scoped) would let
  someone brute-force names against DOBs. The Worker is the only thing allowed to see roster
  rows; it returns yes/no plus an opaque UUID, nothing else.
- **5 of the 87 active students have no `date_of_birth` on file** — the lookup will silently
  fail for them until someone fills that in. Worth a data-cleanup pass, or at least flagging
  to Joe, before this goes live.
- **No student names appear in the public Instagram post.** The name is only ever used
  internally, for matching a post back to a student for the reward. Don't let it leak into
  captions, alt text, or anything Canva auto-generates.
- All locations in the BYW `locations` table (Azalea, Balance Martial Arts and Gaming, Gladden,
  JW Cate, Lake Vista, St Pete First UMC, Willis) belong to Kinney Karate — there's no
  need to filter students by location for this project, the whole roster is fair game.
