# Scaling notes: thread re-summarization

Re-summarizing an already-archived thread (`kbSummary.ts`'s `runUpdate` path) needs to know
"has this thread been archived before, and how much of it is already covered." That state is
currently **not stored in a database** — Discourse (or `kb-summaries.md`, in fallback mode) is
the source of truth. This was a deliberate choice for the app's current scale (single instance,
low-to-moderate event volume), not an oversight. This doc records the tradeoffs and what to do
if that scale assumption stops holding.

## Current design

- **Lookup**: every topic/entry embeds the Slack thread's permalink. On re-trigger, search
  Discourse (`/search.json`) for that permalink, then verify the match by fetching the topic
  directly — search alone is fuzzy/tokenized and isn't trusted as confirmation.
- **Coverage tracking**: every post/entry embeds a hidden marker
  (`<!-- kb-connector:last_ts=... -->`) recording the newest Slack message ts it covers. The next
  run parses this back out to compute the delta (messages since last covered).
- **Concurrency**: an in-process mutex (`src/utils/mutex.ts`) serializes runs per
  `channel:threadTs`, so two near-simultaneous triggers on the same thread can't both read
  "no existing entry" and create duplicate topics.

## Known limits at this design's current scale

1. **Every lookup is a network round trip.** No local index — finding an existing topic means a
   Discourse search call plus a verification fetch, every time. Fine at low volume; adds latency
   and Discourse API load as trigger volume grows.
2. **Marker parsing is fragile.** If someone hand-edits a Discourse post and strips the HTML
   comment, the next run won't find the marker and will treat the thread as brand new — creating
   a duplicate topic rather than corrupting anything. Degrades safely, but is a real failure mode
   users could hit.
3. **The mutex only works within a single Node process.** If this service ever runs as more than
   one instance (horizontal scaling, rolling deploys with overlap), two instances could both miss
   an in-flight update and create duplicate topics for the same thread. The permalink-search
   fallback makes this a rare, self-correcting-on-next-run issue rather than silent data loss,
   but it is a real gap.
4. **No caching.** Every `kb!`/shortcut/button trigger re-fetches the full topic content to
   rebuild `previousBody`, even for large topics with many prior updates. Fine at current article
   sizes; would matter for very long-running KB threads with many rounds of updates.

## What to do if this stops being enough

Trigger points: multi-instance deployment, high trigger volume (frequent lookups making Discourse
API rate limits or latency a real problem), or the marker-fragility failure mode showing up in
practice.

- **Move the thread→topic mapping into a real store** (SQLite for single-instance with a
  persistent volume, or Postgres for multi-instance). Schema is small and mechanical:
  `(channel, thread_ts) -> (topic_id, topic_url, last_message_ts)`, unique on `(channel,
  thread_ts)`. This removes the network-round-trip-per-lookup cost and gives a proper unique
  constraint as a concurrency backstop instead of the in-process mutex alone.
- **Add a distributed lock** if running multiple instances (e.g. a Postgres advisory lock keyed
  by `channel:threadTs`, or a Redis lock) — replaces the in-process mutex, which does nothing
  across instances.
- **Cache topic lookups** (e.g. a short-TTL in-memory or Redis cache keyed by permalink) if
  Discourse API load/latency becomes a bottleneck — the permalink→topic mapping doesn't change
  once a topic exists, so this is safe to cache aggressively.
- **Keep the marker as a redundant integrity check even after adding a DB** — if the DB says a
  topic exists but the marker's gone from the actual post, that's a signal something is
  inconsistent (manual edit, partial failure) worth surfacing rather than silently trusting one
  source.
