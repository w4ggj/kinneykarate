// Staff approval queue API. The page itself is public/admin.html.
//
//   POST /api/admin/login                     { email, password } -> sets session cookies
//   POST /api/admin/logout
//   GET  /api/admin/me                        -> { ok, name }
//   GET  /api/admin/submissions?status=       pending (default) | approved | rejected | posted
//   POST /api/admin/submissions/<id>/approve  { caption? }  approves, then posts to Instagram
//   POST /api/admin/submissions/<id>/reject   { reason? }
//   POST /api/admin/submissions/<id>/publish  (re)try the Instagram post for an approved one
//   GET  /api/admin/media/submissions/<file>  any status, staff only
//
// Auth is the BYW project's real Supabase Auth: staff sign in with the same email/password
// they already use, and every request re-checks the user is an active row in `staff`
// (same rule as is_staff()). Tokens live only in HttpOnly SameSite=Strict cookies, and
// state-changing requests must come from our own origin.

import { publishStates, startPublish } from "./instagram.js";
import { json, MEDIA_KEY_RE, sbHeaders, serveMediaObject, UUID_RE } from "./lib.js";

const ACCESS_COOKIE = "kss_at";
const REFRESH_COOKIE = "kss_rt";
const REFRESH_MAX_AGE = 7 * 24 * 3600;
const STATUSES = ["pending", "approved", "rejected", "posted"];
const LIST_LIMIT = 100;

function readCookie(request, name) {
  const header = request.headers.get("Cookie") || "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

function cookie(name, value, maxAge) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

function sessionCookies(tokens) {
  return [
    cookie(ACCESS_COOKIE, tokens.access_token, tokens.expires_in || 3600),
    cookie(REFRESH_COOKIE, tokens.refresh_token, REFRESH_MAX_AGE),
  ];
}

function withCookies(response, cookies) {
  for (const c of cookies) response.headers.append("Set-Cookie", c);
  return response;
}

async function authToken(env, grantType, body) {
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/token?grant_type=${grantType}`, {
    method: "POST",
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.ok ? res.json() : null;
}

async function authUser(env, accessToken) {
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${accessToken}` },
  });
  return res.ok ? res.json() : null;
}

async function activeStaff(env, authUserId) {
  if (!UUID_RE.test(authUserId || "")) return null;
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/staff?auth_user_id=eq.${authUserId}&is_active=eq.true&select=id,name`,
    { headers: sbHeaders(env) }
  );
  if (!res.ok) throw new Error(`Supabase staff check ${res.status}: ${await res.text()}`);
  return (await res.json())[0] || null;
}

// Returns { staff, cookies } for a signed-in active staff member, else null. Refreshes an
// expired access token once, handing back new cookies for the caller to set.
async function requireStaff(request, env) {
  let cookies = [];
  let user = null;
  const accessToken = readCookie(request, ACCESS_COOKIE);
  if (accessToken) user = await authUser(env, accessToken);

  if (!user) {
    const refreshToken = readCookie(request, REFRESH_COOKIE);
    const tokens = refreshToken && (await authToken(env, "refresh_token", { refresh_token: refreshToken }));
    if (!tokens) return null;
    user = tokens.user || (await authUser(env, tokens.access_token));
    cookies = sessionCookies(tokens);
  }

  const staff = user && (await activeStaff(env, user.id));
  return staff ? { staff, cookies } : null;
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

async function handleLogin(request, env) {
  const { email, password } = await readJson(request);
  if (typeof email !== "string" || typeof password !== "string" || !email || !password) {
    return json({ ok: false, error: "Enter your email and password." }, 400);
  }
  const tokens = await authToken(env, "password", { email: email.trim(), password });
  const staff = tokens && (await activeStaff(env, tokens.user?.id));
  if (!staff) {
    // Same message for bad password and non-staff accounts.
    return json({ ok: false, error: "Wrong email or password, or this account isn't staff." }, 401);
  }
  return withCookies(json({ ok: true, name: staff.name }), sessionCookies(tokens));
}

function handleLogout() {
  return withCookies(json({ ok: true }), [cookie(ACCESS_COOKIE, "", 0), cookie(REFRESH_COOKIE, "", 0)]);
}

// media_url is the public URL; staff view it through the authenticated route instead, since
// /media/ only serves approved/posted submissions.
function adminMediaPath(env, mediaUrl) {
  const prefix = `${env.PUBLIC_SITE_URL}/media/`;
  if (!mediaUrl?.startsWith(prefix)) return null;
  const key = mediaUrl.slice(prefix.length);
  return MEDIA_KEY_RE.test(key) ? `/api/admin/media/${key}` : null;
}

async function handleList(request, env) {
  const status = new URL(request.url).searchParams.get("status") || "pending";
  if (!STATUSES.includes(status)) return json({ ok: false, error: "Bad status" }, 400);

  // Oldest first for the pending queue, newest first for the history tabs.
  const order = status === "pending" ? "submitted_at.asc" : "submitted_at.desc";
  const select = [
    "id,caption,media_url,status,rejection_reason,submitted_at,reviewed_at",
    "instagram_permalink,likes_count,comments_count,reward_status",
    "student:students(first_name,last_name)",
    "reviewer:staff(name)",
  ].join(",");
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/social_submissions?status=eq.${status}&order=${order}&limit=${LIST_LIMIT}&select=${select}`,
    { headers: sbHeaders(env) }
  );
  if (!res.ok) {
    console.error("Supabase list error:", res.status, await res.text());
    return json({ ok: false, error: "Couldn't load submissions." }, 502);
  }
  const rows = await res.json();
  const publish = status === "approved" ? await publishStates(env, rows.map((r) => r.id)) : {};
  return json({
    ok: true,
    submissions: rows.map(({ media_url, ...row }) => ({
      ...row,
      media: adminMediaPath(env, media_url),
      mediaType: media_url?.endsWith(".mp4") ? "video" : "photo",
      publish: publish[row.id] || null,
    })),
  });
}

// Only pending submissions can be reviewed, so two staff acting at once can't flip a
// decision (or un-post something) — the second one gets a 409. Returns the updated row, or
// an error Response.
async function review(env, id, staff, fields) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/social_submissions?id=eq.${id}&status=eq.pending`, {
    method: "PATCH",
    headers: { ...sbHeaders(env), Prefer: "return=representation" },
    body: JSON.stringify({ ...fields, reviewed_at: new Date().toISOString(), reviewed_by: staff.id }),
  });
  if (!res.ok) {
    console.error("Supabase review error:", res.status, await res.text());
    return json({ ok: false, error: "Couldn't save. Please try again." }, 502);
  }
  const [row] = await res.json();
  if (!row) {
    return json({ ok: false, error: "Someone already reviewed this one. Refresh the list." }, 409);
  }
  return row;
}

function publishResult(row) {
  return json({ ok: true, publish: row && { state: row.state, error: row.error } });
}

async function handleApprove(request, env, id, staff) {
  const { caption } = await readJson(request);
  const fields = { status: "approved" };
  if (caption !== undefined) {
    if (caption !== null && (typeof caption !== "string" || caption.length > 2200)) {
      return json({ ok: false, error: "Caption must be 2200 characters or less." }, 400);
    }
    fields.caption = caption?.trim() || null;
  }
  const row = await review(env, id, staff, fields);
  if (row instanceof Response) return row;
  // Approval sticks even if Instagram fails; staff can retry from the Approved tab.
  return publishResult(await startPublish(env, row));
}

async function handlePublish(env, id) {
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/social_submissions?id=eq.${id}&status=eq.approved&select=id,caption,media_url`,
    { headers: sbHeaders(env) }
  );
  if (!res.ok) {
    console.error("Supabase publish lookup error:", res.status, await res.text());
    return json({ ok: false, error: "Couldn't load that submission." }, 502);
  }
  const [row] = await res.json();
  if (!row) return json({ ok: false, error: "Only approved posts can be sent to Instagram." }, 409);
  return publishResult(await startPublish(env, row));
}

async function handleReject(request, env, id, staff) {
  const { reason } = await readJson(request);
  if (reason != null && (typeof reason !== "string" || reason.length > 1000)) {
    return json({ ok: false, error: "Reason is too long." }, 400);
  }
  const row = await review(env, id, staff, { status: "rejected", rejection_reason: reason?.trim() || null });
  return row instanceof Response ? row : json({ ok: true });
}

export async function handleAdmin(request, env, pathname) {
  const method = request.method;

  // Cookies are SameSite=Strict already; also refuse cross-origin writes outright.
  if (method !== "GET") {
    const origin = request.headers.get("Origin");
    if (origin && origin !== new URL(request.url).origin) {
      return json({ ok: false, error: "Forbidden" }, 403);
    }
  }

  if (pathname === "/api/admin/login" && method === "POST") return handleLogin(request, env);
  if (pathname === "/api/admin/logout" && method === "POST") return handleLogout();

  const auth = await requireStaff(request, env);
  if (!auth) return json({ ok: false, error: "Please sign in." }, 401);
  const { staff, cookies } = auth;

  let res;
  const action = /^\/api\/admin\/submissions\/([0-9a-f-]{36})\/(approve|reject|publish)$/i.exec(pathname);
  if (pathname === "/api/admin/me" && method === "GET") {
    res = json({ ok: true, name: staff.name });
  } else if (pathname === "/api/admin/submissions" && method === "GET") {
    res = await handleList(request, env);
  } else if (action && method === "POST") {
    const [, id, verb] = action;
    if (verb === "approve") res = await handleApprove(request, env, id, staff);
    else if (verb === "reject") res = await handleReject(request, env, id, staff);
    else res = await handlePublish(env, id);
  } else if (pathname.startsWith("/api/admin/media/") && method === "GET") {
    const key = pathname.slice("/api/admin/media/".length);
    res = MEDIA_KEY_RE.test(key)
      ? await serveMediaObject(request, env, key, "private, no-store")
      : json({ error: "Not found" }, 404);
  } else {
    res = json({ error: "Not found" }, 404);
  }
  return cookies.length ? withCookies(new Response(res.body, res), cookies) : res;
}
