// Publishes approved submissions to the Kinney Karate Instagram via the Instagram Graph API
// (content publishing: create a media container, wait for it to finish, then publish it).
//
// Publish state lives in D1 (ig_publish), one row per submission:
//   creating   -> container being created (claimed by one request)
//   processing -> container created; waiting for Instagram to finish (videos take a while)
//   publishing -> media_publish in flight (claimed by one request)
//   published  -> live on Instagram; Supabase not yet updated to 'posted'
//   done       -> Supabase updated (status = posted, permalink saved)
//   error      -> failed; staff can retry from the queue
// Every transition is a conditional UPDATE checked with meta.changes, so concurrent clicks
// and the cron can't publish the same post twice.

import { sbHeaders } from "./lib.js";

// Videos still processing after this long are marked failed.
const CONTAINER_TIMEOUT_MINUTES = 60;
// A 'creating'/'publishing' claim older than this means the request died mid-call.
const STALE_CLAIM_MINUTES = 10;

function now() {
  return new Date().toISOString();
}

function minutesAgo(minutes) {
  return new Date(Date.now() - minutes * 60000).toISOString();
}

function graphBase(env) {
  return `https://${env.GRAPH_HOST || "graph.facebook.com"}/${env.GRAPH_VERSION || "v23.0"}`;
}

// The access token goes in the body/query only; error messages never include the URL.
async function graph(env, path, params = {}, method = "GET") {
  const body = new URLSearchParams({ ...params, access_token: env.IG_ACCESS_TOKEN });
  const url = `${graphBase(env)}${path}`;
  const res = method === "GET" ? await fetch(`${url}?${body}`) : await fetch(url, { method, body });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    throw new Error(data.error?.message || `Instagram API error ${res.status}`);
  }
  return data;
}

async function getRow(env, submissionId) {
  return env.DB.prepare(`SELECT * FROM ig_publish WHERE submission_id = ?`).bind(submissionId).first();
}

// Moves a row from one state to another; returns false if someone else moved it first.
async function transition(env, submissionId, from, to, fields = {}) {
  const sets = Object.keys(fields).map((k) => `${k} = ?`);
  const res = await env.DB.prepare(
    `UPDATE ig_publish SET state = ?, ${[...sets, "updated_at = ?"].join(", ")}
       WHERE submission_id = ? AND state = ?`
  )
    .bind(to, ...Object.values(fields), now(), submissionId, from)
    .run();
  return res.meta.changes > 0;
}

async function fail(env, submissionId, from, err) {
  console.error(`Instagram publish ${submissionId} failed:`, err.message || err);
  await transition(env, submissionId, from, "error", { error: String(err.message || err).slice(0, 500) });
}

export function isConfigured(env) {
  return Boolean(env.IG_USER_ID && env.IG_ACCESS_TOKEN);
}

// Starts publishing an approved submission ({ id, caption, media_url }). Safe to call again:
// it only does anything for a submission with no publish row yet, or one in 'error'.
// Returns the publish row.
export async function startPublish(env, submission) {
  const id = submission.id;
  const claimed = await env.DB.prepare(
    `INSERT INTO ig_publish (submission_id, state, created_at, updated_at) VALUES (?, 'creating', ?, ?)
       ON CONFLICT (submission_id) DO UPDATE SET state = 'creating', container_id = NULL, media_id = NULL,
         error = NULL, created_at = excluded.created_at, updated_at = excluded.updated_at
       WHERE ig_publish.state = 'error'`
  )
    .bind(id, now(), now())
    .run();
  if (!claimed.meta.changes) return getRow(env, id);

  try {
    if (!isConfigured(env)) throw new Error("Instagram isn't connected yet (IG_USER_ID / IG_ACCESS_TOKEN).");
    if (!submission.media_url) throw new Error("This submission has no image or video.");

    const isVideo = submission.media_url.endsWith(".mp4");
    const params = isVideo
      ? { media_type: "REELS", video_url: submission.media_url, share_to_feed: "true" }
      : { image_url: submission.media_url };
    if (submission.caption) params.caption = submission.caption;

    const container = await graph(env, `/${env.IG_USER_ID}/media`, params, "POST");
    await transition(env, id, "creating", "processing", { container_id: container.id });
  } catch (err) {
    await fail(env, id, "creating", err);
    return getRow(env, id);
  }

  // Images are usually ready right away; videos get picked up by the cron.
  await advance(env, await getRow(env, id));
  return getRow(env, id);
}

// Pushes one row forward as far as it can go right now.
async function advance(env, row) {
  const id = row.submission_id;

  if (row.state === "processing") {
    let status;
    try {
      ({ status_code: status } = await graph(env, `/${row.container_id}`, { fields: "status_code" }));
    } catch (err) {
      return fail(env, id, "processing", err);
    }
    if (status === "IN_PROGRESS") {
      if (row.created_at < minutesAgo(CONTAINER_TIMEOUT_MINUTES)) {
        await fail(env, id, "processing", new Error("Instagram took too long to process the video."));
      }
      return;
    }
    if (status !== "FINISHED") {
      return fail(env, id, "processing", new Error(`Instagram couldn't process the media (${status}).`));
    }

    if (!(await transition(env, id, "processing", "publishing"))) return;
    try {
      const published = await graph(env, `/${env.IG_USER_ID}/media_publish`, { creation_id: row.container_id }, "POST");
      await transition(env, id, "publishing", "published", { media_id: published.id });
    } catch (err) {
      return fail(env, id, "publishing", err);
    }
    row = await getRow(env, id);
  }

  if (row.state === "published") {
    await markPosted(env, row);
  }
}

// Records the live post on the submission. Retried by the cron until it sticks.
async function markPosted(env, row) {
  let permalink = null;
  try {
    ({ permalink } = await graph(env, `/${row.media_id}`, { fields: "permalink" }));
  } catch (err) {
    console.error("Instagram permalink lookup failed:", err.message);
  }
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/social_submissions?id=eq.${row.submission_id}&status=eq.approved`,
    {
      method: "PATCH",
      headers: sbHeaders(env),
      body: JSON.stringify({
        status: "posted",
        instagram_post_id: row.media_id,
        instagram_permalink: permalink,
        posted_at: now(),
      }),
    }
  );
  if (!res.ok) {
    console.error("Supabase posted update failed:", res.status, await res.text());
    return;
  }
  await transition(env, row.submission_id, "published", "done");
}

// Cron: finish video processing, retry Supabase updates, and clear dead claims.
export async function processPublishQueue(env) {
  const stale = minutesAgo(STALE_CLAIM_MINUTES);
  await env.DB.prepare(
    `UPDATE ig_publish SET state = 'error', updated_at = ?,
       error = CASE state
         WHEN 'publishing' THEN 'Interrupted while publishing. Check Instagram before retrying so it doesn''t post twice.'
         ELSE 'Interrupted before it reached Instagram. Safe to retry.' END
       WHERE state IN ('creating', 'publishing') AND updated_at < ?`
  )
    .bind(now(), stale)
    .run();

  const { results } = await env.DB.prepare(
    `SELECT * FROM ig_publish WHERE state IN ('processing', 'published') ORDER BY updated_at LIMIT 20`
  ).all();
  for (const row of results) {
    try {
      await advance(env, row);
    } catch (err) {
      console.error(`Instagram queue ${row.submission_id}:`, err.message || err);
    }
  }
}

export async function publishStates(env, submissionIds) {
  if (!submissionIds.length) return {};
  const { results } = await env.DB.prepare(
    `SELECT submission_id, state, error FROM ig_publish WHERE submission_id IN (${submissionIds.map(() => "?").join(",")})`
  )
    .bind(...submissionIds)
    .all();
  return Object.fromEntries(results.map((r) => [r.submission_id, { state: r.state, error: r.error }]));
}
