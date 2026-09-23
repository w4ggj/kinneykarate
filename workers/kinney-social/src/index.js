// kinney-social — student lookup + submission API
//
// Two public endpoints:
//   POST /api/lookup       { firstName, lastName, dob }  -> { ok: true, studentId } | { ok: false }
//   POST /api/submissions  { studentId, caption, canvaDesignId?, canvaEditUrl?, mediaUrl? } -> { ok: true, id }
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
// - /api/submissions re-validates studentId server-side against `students` (active status)
//   before inserting — never trust a studentId handed back by the browser without checking
//   it's still a real, active student. This is cheap insurance against someone crafting a
//   raw POST with a guessed or stale UUID.
// - No student names or DOBs are ever written to social_submissions beyond the student_id
//   FK. Caption/media are exactly what the student submitted; nothing is auto-approved.

const LOCKOUT_WINDOW_MINUTES = 15;
const LOCKOUT_AFTER_FAILURES = 8;
const MAX_CAPTION_LENGTH = 2200; // Instagram's caption limit
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}

function sbHeaders(env) {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
  };
}

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

async function handleCreateSubmission(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid request" }, 400);
  }

  const { studentId, caption, canvaDesignId, canvaEditUrl, mediaUrl } = body;
  // studentId is interpolated into a PostgREST filter below — reject anything that isn't a
  // bare UUID so it can't smuggle in extra query params/filters.
  if (typeof studentId !== "string" || !UUID_RE.test(studentId)) {
    return json({ ok: false, error: "studentId is required" }, 400);
  }
  if (caption != null && (typeof caption !== "string" || caption.length > MAX_CAPTION_LENGTH)) {
    return json({ ok: false, error: `Caption must be ${MAX_CAPTION_LENGTH} characters or less.` }, 400);
  }

  // Re-check the student is real and active before writing anything — never trust a
  // studentId the browser hands back without re-verifying it server-side.
  const checkRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/students?id=eq.${studentId}&status=eq.active&select=id`,
    { headers: sbHeaders(env) }
  );
  if (!checkRes.ok) {
    console.error("Supabase student check error:", checkRes.status, await checkRes.text());
    return json({ ok: false, error: "Something went wrong. Please try again." }, 502);
  }
  const checkRows = await checkRes.json();
  if (!checkRows.length) {
    return json({ ok: false, error: "We couldn't verify that student. Please start over." }, 404);
  }

  const insertRes = await fetch(`${env.SUPABASE_URL}/rest/v1/social_submissions`, {
    method: "POST",
    headers: { ...sbHeaders(env), Prefer: "return=representation" },
    body: JSON.stringify({
      student_id: studentId,
      caption: caption || null,
      canva_design_id: canvaDesignId || null,
      canva_edit_url: canvaEditUrl || null,
      media_url: mediaUrl || null,
      status: "pending",
    }),
  });

  if (!insertRes.ok) {
    console.error("Supabase insert error:", insertRes.status, await insertRes.text());
    return json({ ok: false, error: "Couldn't save your submission. Please try again." }, 502);
  }
  const [inserted] = await insertRes.json();
  return json({ ok: true, id: inserted.id });
}

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    try {
      if (pathname === "/api/health") {
        return json({ ok: true });
      }
      if (pathname === "/api/lookup" && request.method === "POST") {
        return await handleLookup(request, env);
      }
      if (pathname === "/api/submissions" && request.method === "POST") {
        return await handleCreateSubmission(request, env);
      }
      if (env.ASSETS) {
        return env.ASSETS.fetch(request);
      }
      return json({ error: "Not found" }, 404);
    } catch (err) {
      console.error("Worker error:", err.stack || err.message || err);
      return json({ error: "Internal server error" }, 500);
    }
  },
};
