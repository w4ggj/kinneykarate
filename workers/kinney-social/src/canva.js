// Canva Connect helpers: OAuth (authorization code + PKCE), design creation, JPG/MP4 export.
//
// Each student authorizes with their own Canva account; the design is created in their
// account, they edit it on canva.com, and Canva's Return Navigation sends them back to
// /canva-return with a correlation_jwt carrying our opaque session id.
//
// Tokens live only in D1 (canva_sessions) for the life of one submission and are deleted
// once the design has been exported to R2.

const AUTHORIZE_URL = "https://www.canva.com/api/oauth/authorize";
const API_BASE = "https://api.canva.com/rest/v1";
const SCOPES = "design:content:read design:content:write";

// 4:5 portrait, Instagram's tallest feed format.
const DESIGN_WIDTH = 1080;
const DESIGN_HEIGHT = 1350;

const EXPORT_POLL_INTERVAL_MS = 1500;
const EXPORT_POLL_ATTEMPTS = 20;

function base64url(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function randomToken(byteLength = 32) {
  return base64url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

async function pkceChallenge(verifier) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

export function redirectUri(env) {
  return `${env.PUBLIC_SITE_URL}/canva-callback`;
}

export async function buildAuthorizeUrl(env, state, codeVerifier) {
  const params = new URLSearchParams({
    code_challenge: await pkceChallenge(codeVerifier),
    code_challenge_method: "s256",
    scope: SCOPES,
    response_type: "code",
    client_id: env.CANVA_CLIENT_ID,
    state,
    redirect_uri: redirectUri(env),
  });
  // URLSearchParams encodes spaces as "+"; use %20 in the scope list to match Canva's docs.
  return `${AUTHORIZE_URL}?${params.toString().replace(/\+/g, "%20")}`;
}

async function tokenRequest(env, form) {
  const res = await fetch(`${API_BASE}/oauth/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${env.CANVA_CLIENT_ID}:${env.CANVA_CLIENT_SECRET}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(form),
  });
  if (!res.ok) {
    throw new Error(`Canva token error ${res.status}: ${await res.text()}`);
  }
  return res.json(); // { access_token, refresh_token, expires_in, ... }
}

export function exchangeCode(env, code, codeVerifier) {
  return tokenRequest(env, {
    grant_type: "authorization_code",
    code,
    code_verifier: codeVerifier,
    redirect_uri: redirectUri(env),
  });
}

export function refreshTokens(env, refreshToken) {
  return tokenRequest(env, { grant_type: "refresh_token", refresh_token: refreshToken });
}

async function canvaApi(accessToken, path, init = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    const err = new Error(`Canva API ${path} ${res.status}: ${await res.text()}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

// Blank design only — never autofill anything from the student record into it, so no
// student name can end up on the published image.
export async function createDesign(accessToken) {
  const { design } = await canvaApi(accessToken, "/designs", {
    method: "POST",
    body: JSON.stringify({
      design_type: { type: "custom", width: DESIGN_WIDTH, height: DESIGN_HEIGHT },
      title: "Kinney Karate post",
    }),
  });
  return { designId: design.id, editUrl: design.urls.edit_url };
}

// Canva's Return Navigation: correlation_state rides along on the edit URL and comes back
// inside the correlation_jwt on the return URL.
export function editUrlWithReturn(editUrl, sessionId) {
  const url = new URL(editUrl);
  url.searchParams.set("correlation_state", sessionId);
  return url.toString();
}

// We only read correlation_state out of the JWT and use it as a lookup key for a session
// we created. Nothing else in the payload is trusted (the design id comes from our own
// D1 row), and a forged JWT would still need a valid 256-bit session id to do anything,
// so signature verification isn't needed here.
export function correlationStateFromJwt(jwt) {
  const parts = (jwt || "").split(".");
  if (parts.length !== 3) return null;
  try {
    const json = atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json).correlation_state || null;
  } catch {
    return null;
  }
}

// Export settings per post type. Videos take much longer for Canva to render.
export const EXPORT_FORMATS = {
  // JPEG, not PNG: the Instagram publish API only accepts JPEG images.
  photo: { format: { type: "jpg", quality: 90 }, ext: "jpg", contentType: "image/jpeg", pollAttempts: 20 },
  // 4:5 portrait design, so the vertical preset.
  video: { format: { type: "mp4", quality: "vertical_1080p" }, ext: "mp4", contentType: "video/mp4", pollAttempts: 80 },
};

// Exports the design (page 1 for JPG) and returns the download Response, so large videos
// can be streamed straight into R2 instead of buffered.
export async function exportDesign(accessToken, designId, kind) {
  const { format, pollAttempts } = EXPORT_FORMATS[kind];
  let { job } = await canvaApi(accessToken, "/exports", {
    method: "POST",
    body: JSON.stringify({ design_id: designId, format }),
  });
  for (let i = 0; job.status === "in_progress" && i < pollAttempts; i++) {
    await new Promise((r) => setTimeout(r, EXPORT_POLL_INTERVAL_MS));
    ({ job } = await canvaApi(accessToken, `/exports/${job.id}`));
  }
  if (job.status !== "success" || !job.urls?.length) {
    throw new Error(`Canva export did not finish: ${JSON.stringify(job)}`);
  }
  const file = await fetch(job.urls[0]);
  if (!file.ok) throw new Error(`Canva export download ${file.status}`);
  return file;
}
