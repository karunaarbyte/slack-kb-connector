# Scaling notes: thread re-summarization

Re-summarizing an already-archived thread (`kbSummary.ts`'s `runUpdate` path) needs to know
"has this thread been archived before, and how much of it is already covered." In Discourse mode
that state lives in a Turso (SQLite) table, `kb_threads`, keyed on `(channel, thread_ts)` and
storing `(topic_id, topic_url, last_message_ts)` — see `src/services/db.ts`. In fallback (file)
mode, `kb-summaries.md` still plays that role itself, via a per-entry marker (`src/services/fileKb.ts`).

## Why a DB instead of parsing Discourse post content

An earlier version of this connector had no separate store: it found the existing topic by
searching Discourse (`/search.json`) for the Slack permalink embedded in the topic body, then
read a hidden marker back out of the post to track how much of the thread was already covered.
That broke in practice for a fairly fundamental reason: the API key used here isn't an
admin/staff key, so Discourse never returns `raw` (markdown) for posts — only `cooked` (rendered
HTML). Permalinks live inside `<a href="...">` attributes, which a naive tag-strip discards
entirely, and HTML entity-encoding (`&` → `&amp;`) broke any remaining substring match. Any future
Discourse theme/version change to how content renders could silently reintroduce that same class
of bug. The DB avoids the entire problem — identity and coverage tracking no longer depend on
parsing rendered post content at all.

## Current design

- **Lookup**: `db.getThreadMapping(channel, threadTs)` — one direct keyed read, no search/parse.
- **Creating a mapping**: `db.insertNewMapping` is a plain `INSERT` (no `ON CONFLICT`), used only
  on the "brand new thread" path. If a mapping already exists for that `(channel, thread_ts)` —
  i.e. two triggers raced and both believed the thread was unarchived — the `INSERT` throws
  instead of silently overwriting the earlier row, so a lost race surfaces as a logged failure
  rather than an orphaned Discourse topic with a suppressed trace of what happened. See known
  limit #1 below for why this can still happen at all.
- **Coverage tracking**: `last_message_ts` lives in the same row. `db.updateMapping` (an
  `INSERT ... ON CONFLICT DO UPDATE`) advances it on every append to an *already-known* topic —
  unlike `insertNewMapping`, an upsert is correct here because the row is expected to exist.
- **Redundant recovery trace**: every post (`discourse.createTopic` and `discourse.createReply`)
  also embeds a small `<sub>kb-connector:channel=... thread_ts=... last_ts=...</sub>` line in the
  rendered body. The app never reads this back — Turso is the only thing it queries — but it means
  a human could still reconstruct the mapping by hand from Discourse content if Turso were ever
  lost or wiped, rather than that state having zero surviving trace outside the DB.
- **Self-healing on a stale mapping**: if `db.getThreadMapping` returns a row but
  `discourse.getTopicBody` 404s (the topic was deleted outside `yarn delete-topics`, e.g. via the
  Discourse admin UI), `kbSummary.ts`'s `run()` drops the stale row and falls through to create a
  fresh topic, instead of failing every future trigger on that thread until someone manually
  cleans up Turso.
- **Topic body for the LLM**: when appending, `discourse.getTopicBody(topicId)` still fetches and
  flattens the topic's `cooked` HTML to plain text — but only to give OpenAI context on what's
  already written, not for identity/lookup. A rendering quirk there could produce a slightly
  ugly transcript for the model, but can no longer cause a duplicate topic.
- **Concurrency**: an in-process mutex (`src/utils/mutex.ts`) serializes runs per
  `channel:threadTs`, so two near-simultaneous triggers on the same thread can't both read
  "no existing entry" and create duplicate topics.
- **Cleanup**: `yarn delete-topics <id...>` deletes a Discourse topic (via `discourse.deleteTopic`,
  which treats "already gone" as success) and its `kb_threads` row together, so a deleted topic
  doesn't leave a dangling mapping that a later trigger would try to append to.

## Known limits at this design's current scale

1. **The mutex only works within a single Node process.** If this service ever runs as more than
   one instance (horizontal scaling, rolling deploys with overlap), two instances could both miss
   an in-flight update, both call `createTopic`, and race on `insertNewMapping` — one succeeds, the
   other's `INSERT` throws on the `PRIMARY KEY (channel, thread_ts)` conflict. That's now a visible,
   logged failure (see "Creating a mapping" above) rather than a silent overwrite, but it still
   means the losing instance's Discourse topic is created and then orphaned — worth adding a
   distributed lock before running more than one instance, not just relying on the insert to fail
   loudly.
2. **No caching of topic bodies.** Every append re-fetches and re-flattens the full topic content
   to rebuild context for the LLM, even for topics with many prior updates. Fine at current
   article sizes; would matter for very long-running KB threads with many rounds of updates.
3. **Turso is a network dependency in the request path.** Every lookup and upsert is a network
   round trip to Turso, in addition to the Discourse calls. Fine at current volume; latency and
   Turso request quota become a consideration at much higher trigger volume.

## What to do if this stops being enough

- **Multi-instance deployment**: replace the in-process mutex with a distributed lock (Postgres
  advisory lock, Redis lock) keyed by `channel:threadTs`, so the race in known limit #1 is
  prevented up front instead of merely detected after a Discourse topic's already been created.
- **High trigger volume / topic-body fetch cost**: cache `getTopicBody` results (e.g. short-TTL
  in-memory or Redis, keyed by `topic_id`, invalidated on append) so long-running KB threads don't
  re-fetch and re-flatten their whole history on every trigger.
