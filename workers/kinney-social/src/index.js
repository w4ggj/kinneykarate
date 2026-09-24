// kinney-social — student lookup, Canva design flow, and submission API
//
// Serves the static student frontend from ./public, plus:
//   POST /api/lookup         { firstName, lastName, dob } -> { ok: true, studentId } | { ok: false }
//   POST /api/canva/start    { studentId } -> { ok, authorizeUrl }   (Canva OAuth)
//   GET  /canva-callback     OAuth redirect: creates a blank design, sends student to the editor
//   GET  /canva-return       Canva Return Navigation: sends student to /submit?s=<session>
//   GET  /api/canva/session  ?s=<session> -> { ok, editUrl }
//   POST /api/submissions    { session, caption, mediaType } -> { ok: true, id }
//                            mediaType "photo" exports JPG, "video" exports MP4, into R2
//   GET  /media/...          approved/posted submission media only
//   /admin, /api/admin/*     staff approval queue (Supabase Auth login) — see admin.js
//   cron (every minute)      finishes Instagram publishing for videos — see instagram.js
//   cron (hourly)            refreshes likes/comments/reach and flags rewards
//
// Design notes (read before changing):
// - The `students` table lives in Balance Your World's Supabase project and holds real
//   birthdates for minors. This worker is the ONLY thing allowed to query it with the
//   anon-facing lookup — it uses the Supabase service_role key server-side and never
//   forwards the roster itself to the client. /api/lookup returns yes/no + an opaque
//   student UUID, nothing else about the student.
// - /api/lookup is rate-limited per IP via a D1 table (lookup_attempts), same shape as
//   kinney-camp's admin login lockout: 8 failed lookups in 15 minutes locks that IP out
//   for the rest of the window. This is deliberately looser than a login lockout (5) since
//   legitimate kids will typo their own name/DOB more than adults typo a PIN.
// - /api/canva/start and /api/submissions re-validate the student server-side against
//   `students` (active status) — never trust a studentId handed back by the browser without
//   checking it's still a real, active student.
// - The browser never supplies a Canva design id or media URL. After /api/canva/start the
//   student is identified only by an opaque 256-bit session id (D1 canva_sessions), and the
//   design id, edit URL, and exported image all come from our own records.
// - No student names or DOBs are ever written to social_submissions beyond the student_id
//   FK. Caption/media are exactly what the student submitted; nothing is auto-approved.

import {
  buildAuthorizeUrl,
  correlationStateFromJwt,
  createDesign,
  editUrlWithReturn,
  exchangeCode,
  EXPORT_FORMATS,
  exportDesign,
  randomToken,
  refreshTokens,
} from "./canva.js";
import { json, MEDIA_KEY_RE, redirect, sbHeaders, serveMediaObject, UUID_RE } from "./lib.js";
import { handleAdmin } from "./admin.js";
import { pollEngagement, processPublishQueue } from "./instagram.js";

const LOCKOUT_WINDOW_MINUTES = 15;
const LOCKOUT_AFTER_FAILURES = 8;
const SESSION_TTL_HOURS = 24;
// Must match the second cron in wrangler.toml.
const ENGAGEMENT_CRON = "17 * * * *";
const MAX_CAPTION_LENGTH = 2200; // Instagram's caption limit
async function isLockedOut(db, ip) {
  const cutoff = new Date(Date.now() - LOCKOUT_WINDOW_MINUTES * 60000).toISOString();
  const row = await db
    .prepare(`SELECT COUNT(*) AS failures FROM lookup_attempts WHERE ip = ? AND success = 0 AND created_at > ?`)
    .bind(ip, cutoff)
    .first();
  return (row?.failures ?? 0) >= LOCKOUT_AFTER_FAILURES;
}

async function recordAttempt(db, ip, success) {
  await db
    // Explicit ISO timestamp: a SQLite CURRENT_TIMESTAMP default ("YYYY-MM-DD HH:MM:SS")
    // doesn't string-compare against the ISO cutoff in isLockedOut(), which would make the
    // lockout never trigger within the same day.
    .prepare(`INSERT INTO lookup_attempts (ip, success, created_at) VALUES (?, ?, ?)`)
    .bind(ip, success ? 1 : 0, new Date().toISOString())
    .run();
}

// Trim + lowercase for a forgiving-but-exact match. Real fuzzy matching isn't worth it here —
// staff approval is the actual safety net, this is just a lookup.
function normalize(s) {
  return (s || "").trim().toLowerCase();
}

async function handleLookup(request, env) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const db = env.DB;

  if (await isLockedOut(db, ip)) {
    return json({ ok: false, error: "Too many attempts. Try again in 15 minutes." }, 429);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid request" }, 400);
  }

  const firstName = normalize(body.firstName);
  const lastName = normalize(body.lastName);
  const dob = (body.dob || "").trim(); // expected YYYY-MM-DD from a <input type="date">

  if (!firstName || !lastName || !/^\d{4}-\d{2}-\d{2}$/.test(dob)) {
    await recordAttempt(db, ip, false);
    return json({ ok: false, error: "Please fill in your first name, last name, and date of birth." }, 400);
  }

  // PostgREST match is case-sensitive, so we filter by DOB + status server-side (cheap,
  // narrows to a handful of rows) and compare name in JS after lowercasing both sides.
  const url = `${env.SUPABASE_URL}/rest/v1/students?date_of_birth=eq.${dob}&status=eq.active&select=id,first_name,last_name`;
  const res = await fetch(url, { headers: sbHeaders(env) });
  if (!res.ok) {
    console.error("Supabase lookup error:", res.status, await res.text());
    return json({ ok: false, error: "Something went wrong. Please try again." }, 502);
  }
  const rows = await res.json();
  const match = rows.find(
    (r) => normalize(r.first_name) === firstName && normalize(r.last_name) === lastName
  );

  await recordAttempt(db, ip, !!match);

  if (!match) {
    return json({ ok: false, error: "We couldn't find a match. Double check your name and birthday, or ask staff for help." }, 404);
  }

  return json({ ok: true, studentId: match.id });
}

// Fetches an active student by id, or null. Every endpoint that acts for a student goes
// through this — never trust a studentId the browser hands back without re-verifying it.
async function getActiveStudent(env, studentId, select = "id") {
  if (typeof studentId !== "string" || !UUID_RE.test(studentId)) return null;
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/students?id=eq.${studentId}&status=eq.active&select=${select}`,
    { headers: sbHeaders(env) }
  );
  if (!res.ok) {
    throw new Error(`Supabase student check ${res.status}: ${await res.text()}`);
  }
  const rows = await res.json();
  return rows[0] || null;
}

async function getSession(env, sessionId) {
  if (typeof sessionId !== "string" || !sessionId) return null;
  const cutoff = new Date(Date.now() - SESSION_TTL_HOURS * 3600000).toISOString();
  return env.DB.prepare(`SELECT * FROM canva_sessions WHERE id = ? AND created_at > ?`)
    .bind(sessionId, cutoff)
    .first();
}

// POST /api/canva/start { studentId } -> { ok, authorizeUrl }
async function handleCanvaStart(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid request" }, 400);
  }
  if (!(await getActiveStudent(env, body.studentId))) {
    return json({ ok: false, error: "We couldn't verify that student. Please start over." }, 404);
  }

  const cutoff = new Date(Date.now() - SESSION_TTL_HOURS * 3600000).toISOString();
  await env.DB.prepare(`DELETE FROM canva_sessions WHERE created_at <= ?`).bind(cutoff).run();

  const sessionId = randomToken();
  const oauthState = randomToken();
  const codeVerifier = randomToken(48);
  await env.DB.prepare(
    `INSERT INTO canva_sessions (id, student_id, oauth_state, code_verifier, created_at) VALUES (?, ?, ?, ?, ?)`
  )
    .bind(sessionId, body.studentId, oauthState, codeVerifier, new Date().toISOString())
    .run();

  return json({ ok: true, authorizeUrl: await buildAuthorizeUrl(env, oauthState, codeVerifier) });
}

// GET /canva-callback?code&state — OAuth redirect. Exchanges the code, creates a blank
// design in the student's Canva account, and sends them into the Canva editor.
async function handleCanvaCallback(request, env) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return redirect("/?error=canva_denied");

  const session = await env.DB.prepare(`SELECT * FROM canva_sessions WHERE oauth_state = ?`)
    .bind(state)
    .first();
  if (!session) return redirect("/?error=expired");

  const tokens = await exchangeCode(env, code, session.code_verifier);
  const { designId, editUrl } = await createDesign(tokens.access_token);

  await env.DB.prepare(
    `UPDATE canva_sessions SET oauth_state = NULL, code_verifier = NULL, access_token = ?, refresh_token = ?,
       design_id = ?, edit_url = ? WHERE id = ?`
  )
    .bind(tokens.access_token, tokens.refresh_token, designId, editUrl, session.id)
    .run();

  return redirect(editUrlWithReturn(editUrl, session.id));
}

// GET /canva-return?correlation_jwt — Canva's Return Navigation lands here after editing.
async function handleCanvaReturn(request, env) {
  const url = new URL(request.url);
  const sessionId = correlationStateFromJwt(url.searchParams.get("correlation_jwt"));
  const session = await getSession(env, sessionId);
  if (!session?.design_id) return redirect("/?error=expired");
  return redirect(`/submit?s=${encodeURIComponent(session.id)}`);
}

// GET /api/canva/session?s= -> { ok, editUrl } for the submit page's "keep editing" link.
async function handleSessionInfo(request, env) {
  const session = await getSession(env, new URL(request.url).searchParams.get("s"));
  if (!session?.design_id) {
    return json({ ok: false, error: "This link has expired. Please start over." }, 404);
  }
  return json({ ok: true, editUrl: editUrlWithReturn(session.edit_url, session.id) });
}

async function exportWithRefresh(env, session, kind) {
  try {
    return await exportDesign(session.access_token, session.design_id, kind);
  } catch (err) {
    if (err.status !== 401 || !session.refresh_token) throw err;
    const tokens = await refreshTokens(env, session.refresh_token);
    await env.DB.prepare(`UPDATE canva_sessions SET access_token = ?, refresh_token = ? WHERE id = ?`)
      .bind(tokens.access_token, tokens.refresh_token, session.id)
      .run();
    return exportDesign(tokens.access_token, session.design_id, kind);
  }
}

// R2 only accepts a stream whose length is known up front. Stream when the download says
// how big it is (large videos); otherwise buffer it.
async function r2Body(res) {
  const length = Number(res.headers.get("Content-Length"));
  if (!length) return res.arrayBuffer();
  const { readable, writable } = new FixedLengthStream(length);
  res.body.pipeTo(writable);
  return readable;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Catches the obvious ways a student's name ends up in a public caption. First names alone
// aren't checked — too many are ordinary words ("Will", "Grace") — staff approval covers
// the rest.
function captionHasName(caption, student) {
  const last = normalize(student.last_name);
  const full = `${normalize(student.first_name)} ${last}`;
  const text = normalize(caption);
  return [last, full].some((n) => n && new RegExp(`\\b${escapeRegExp(n)}\\b`).test(text));
}

// POST /api/submissions { session, caption, mediaType } -> { ok, id }
async function handleCreateSubmission(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid request" }, 400);
  }

  const { caption } = body;
  const mediaType = body.mediaType || "photo";
  if (!Object.hasOwn(EXPORT_FORMATS, mediaType)) {
    return json({ ok: false, error: "Choose photo or video." }, 400);
  }
  if (caption != null && (typeof caption !== "string" || caption.length > MAX_CAPTION_LENGTH)) {
    return json({ ok: false, error: `Caption must be ${MAX_CAPTION_LENGTH} characters or less.` }, 400);
  }

  const session = await getSession(env, body.session);
  if (!session?.design_id) {
    return json({ ok: false, error: "This link has expired. Please start over." }, 404);
  }

  // Re-check the student is still real and active before writing anything.
  const student = await getActiveStudent(env, session.student_id, "id,first_name,last_name");
  if (!student) {
    return json({ ok: false, error: "We couldn't verify that student. Please start over." }, 404);
  }
  if (caption && captionHasName(caption, student)) {
    return json({ ok: false, error: "Please leave your name out of the caption." }, 400);
  }

  const { ext, contentType } = EXPORT_FORMATS[mediaType];
  let file;
  try {
    file = await exportWithRefresh(env, session, mediaType);
  } catch (err) {
    console.error("Canva export error:", err.message);
    const hint = mediaType === "video" ? " If your design has no video in it, choose Photo instead." : "";
    return json({ ok: false, error: `We couldn't get your design from Canva. Please try again.${hint}` }, 502);
  }

  const mediaKey = `submissions/${crypto.randomUUID()}.${ext}`;
  await env.MEDIA.put(mediaKey, await r2Body(file), { httpMetadata: { contentType } });

  const insertRes = await fetch(`${env.SUPABASE_URL}/rest/v1/social_submissions`, {
    method: "POST",
    headers: { ...sbHeaders(env), Prefer: "return=representation" },
    body: JSON.stringify({
      student_id: student.id,
      caption: caption || null,
      canva_design_id: session.design_id,
      canva_edit_url: session.edit_url,
      media_url: `${env.PUBLIC_SITE_URL}/media/${mediaKey}`,
      status: "pending",
    }),
  });

  if (!insertRes.ok) {
    console.error("Supabase insert error:", insertRes.status, await insertRes.text());
    await env.MEDIA.delete(mediaKey);
    return json({ ok: false, error: "Couldn't save your submission. Please try again." }, 502);
  }
  const [inserted] = await insertRes.json();

  // One submission per Canva session; drop the tokens now that we're done with them.
  await env.DB.prepare(`DELETE FROM canva_sessions WHERE id = ?`).bind(session.id).run();

  return json({ ok: true, id: inserted.id });
}

// POST /api/suggest-caption { session } -> { ok, caption }
// Fetches the exported design image and uses Cloudflare Workers AI (vision model) to write a caption.
async function handleSuggestCaption(request, env) {
  if (!env.AI) return json({ ok: false, error: "Caption suggestions not available." }, 503);

  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "Invalid request." }, 400); }

  const session = await getSession(env, body.session);
  if (!session?.design_id) return json({ ok: false, error: "Session expired. Please start over." }, 404);

  let imageBytes;
  try {
    const file = await exportWithRefresh(env, session, "photo");
    imageBytes = await file.arrayBuffer();
  } catch (err) {
    console.error("Caption export error:", err.message);
    return json({ ok: false, error: "Couldn't get your design. Please try again." }, 502);
  }

  try {
    // Accept the Meta community license before the vision call.
    await env.AI.run("@cf/meta/llama-3.2-11b-vision-instruct", { prompt: "agree" }).catch(() => {});
    const b64 = btoa(String.fromCharCode(...new Uint8Array(imageBytes.slice(0, 500000))));
    const result = await env.AI.run("@cf/meta/llama-3.2-11b-vision-instruct", {
      messages: [
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: `data:image/jpeg;base64,${b64}` } },
            { type: "text", text: "Look at this image carefully. Write an Instagram caption for a karate school post based specifically on what is shown in the image. Write 2-3 energetic sentences with 2-3 emojis and 3-5 hashtags at the end. Do not include anyone's name. Output only the caption text, no quotes, no intro." },
          ],
        },
      ],
      max_tokens: 200,
    });
    const raw = (result?.description || result?.response || "").trim();
    const caption = raw.replace(/^["']|["']$/g, "").trim();
    if (!caption) return json({ ok: false, error: "No caption returned. Try again or write your own." }, 502);
    return json({ ok: true, caption });
  } catch (err) {
    console.error("Workers AI error:", err.message);
    return json({ ok: false, error: `AI error: ${err.message}` }, 502);
  }
}

// GET /media/submissions/<uuid>.{jpg,mp4} — public only once staff has approved the submission,
// since Instagram's publish API needs to fetch the image by URL. Pending/rejected images
// 404 here; the staff queue should read them through its own authenticated path.
async function handleMedia(request, env, pathname) {
  const key = pathname.slice("/media/".length);
  if (!MEDIA_KEY_RE.test(key)) return json({ error: "Not found" }, 404);

  const mediaUrl = encodeURIComponent(`${env.PUBLIC_SITE_URL}/media/${key}`);
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/social_submissions?media_url=eq.${mediaUrl}&status=in.(approved,posted)&select=id`,
    { headers: sbHeaders(env) }
  );
  if (!res.ok || !(await res.json()).length) return json({ error: "Not found" }, 404);

  return serveMediaObject(request, env, key, "public, max-age=3600");
}

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);

    try {
      if (pathname === "/api/health") {
        return json({ ok: true });
      }
      if (pathname === "/api/lookup" && request.method === "POST") {
        return await handleLookup(request, env);
      }
      if (pathname === "/api/canva/start" && request.method === "POST") {
        return await handleCanvaStart(request, env);
      }
      if (pathname === "/api/canva/session" && request.method === "GET") {
        return await handleSessionInfo(request, env);
      }
      if (pathname === "/api/submissions" && request.method === "POST") {
        return await handleCreateSubmission(request, env);
      }
      if (pathname === "/api/suggest-caption" && request.method === "POST") {
        return await handleSuggestCaption(request, env);
      }
      if (pathname === "/canva-callback") {
        return await handleCanvaCallback(request, env);
      }
      if (pathname === "/canva-return") {
        return await handleCanvaReturn(request, env);
      }
      if (pathname.startsWith("/api/admin/")) {
        return await handleAdmin(request, env, pathname);
      }
      if (pathname.startsWith("/media/") && request.method === "GET") {
        return await handleMedia(request, env, pathname);
      }
      if (env.ASSETS) {
        return env.ASSETS.fetch(request);
      }
      return json({ error: "Not found" }, 404);
    } catch (err) {
      console.error("Worker error:", err.stack || err.message || err);
      if (pathname.startsWith("/canva-")) return redirect("/?error=canva");
      return json({ error: "Internal server error" }, 500);
    }
  },

  async scheduled(event, env, ctx) {
    if (event.cron === ENGAGEMENT_CRON) ctx.waitUntil(pollEngagement(env));
    else ctx.waitUntil(processPublishQueue(env));
  },
};
