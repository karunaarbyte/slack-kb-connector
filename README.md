# slack-kb-connector

A Slack bot that turns thread discussions into knowledge-base articles. Point it at a thread, and it pulls the full conversation, summarizes it with OpenAI, and publishes it as a new topic on kb.arbyte-solutions (Discourse) — or appends it to a local file if Discourse isn't configured.

## Features

- **Two ways to trigger a summary**: type `kb!` as a thread reply, or right-click any message in a thread and choose "Summarize to KB" from the shortcut menu.
- **Full-thread context**: pulls the parent message and every reply, resolves user IDs to display names, and hands the whole transcript to OpenAI for summarization.
- **Discourse or local file**: posts directly to a Discourse KB by default; can be toggled to just save summaries to `kb-summaries.md` instead.
- **In-thread confirmation**: replies in the same thread with a link to the new KB topic (or the saved file path).
- **Channel scoping**: can be restricted to specific Slack channels rather than acting workspace-wide.
- **Guards against noise**: won't generate a KB topic from a single message or an empty thread; ignores bot messages and edits.
- **Completeness gate**: before archiving, an OpenAI call judges whether the thread is conclusive enough to be worth a KB entry. If not, it posts a notice with a "Summarize Anyway" button to force it through.
- **Re-triggering an already-archived thread appends, not duplicates**: if a thread gets summarized again after more discussion, the connector finds the existing topic and posts just what's new as a reply — it doesn't create a second topic. A second completeness-style check judges whether the new activity is actually worth adding before posting.

## How it works

1. A thread gets flagged — either the `kb!` trigger or the message shortcut — and Slack sends the request to the connector, signature-verified against the app's signing secret.
2. The connector fetches the full thread via Slack's API and builds a transcript.
3. It checks whether this thread already has a KB entry. In Discourse mode, a local SQLite table maps `(channel, thread_ts) -> (topic_id, last_message_ts)` — a direct lookup, no searching post content. In fallback (file) mode, `kb-summaries.md` embeds its own marker per entry and is searched directly. See `docs/SCALING.md` for more on this design and its limits.
4. **New thread**: the transcript goes to OpenAI, which judges whether it's conclusive enough and, if so, returns a structured title + markdown body. **Already-archived thread**: only the messages since the last summary are sent, along with the existing article, and OpenAI judges whether they add anything worth appending.
5. The result is posted as a new Discourse topic, a reply on the existing one, or saved locally — with a link back to the original Slack thread.
6. The bot replies in-thread with the result (or, if the content isn't judged worth archiving, a button to force it through anyway).

Note: this intentionally isn't a real Slack slash command. Slack blocks slash commands from being run inside a thread-reply composer, so there'd be no way to target a specific thread with one. The message shortcut is Slack's native mechanism for "act on this specific message," and it works fine from inside threads.

## Configuration

Runtime behavior is controlled via environment variables (`.env`, see `.env.example`):

| Variable | Purpose |
|---|---|
| `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET` | Slack app credentials |
| `SLACK_ALLOWED_CHANNELS` | Optional comma-separated channel IDs to restrict activity to |
| `OPENAI_API_KEY`, `OPENAI_MODEL` | Summarization model config |
| `DISCOURSE_ENABLED` | `false` to skip Discourse and save to `kb-summaries.md` instead |
| `DISCOURSE_BASE_URL`, `DISCOURSE_API_KEY`, `DISCOURSE_API_USERNAME`, `DISCOURSE_CATEGORY_ID` | Required when Discourse is enabled |
| `DB_PATH` | Local SQLite file storing the thread→topic mapping (see `docs/SCALING.md`); defaults to `./data/kb.db`. Must sit on a persistent volume in production |

Setting up the Slack app itself (shortcuts, event subscriptions, bot scopes, request URLs) is a one-time process handled outside this repo, in your Slack app's dashboard at api.slack.com/apps.

Bot Token Scopes required:

| Scope | Why |
|---|---|
| `commands` | Not used by any code here — Slack auto-marks it required as soon as a message shortcut exists on the app, and it can't be removed while the shortcut is configured |
| `channels:history`, `groups:history` | Read thread messages in public/private channels |
| `channels:read`, `groups:read` | Generate permalinks for public/private channels |
| `chat:write` | Post the summary confirmation reply |
| `users:read` | Resolve user IDs to display names in the transcript |

Other app dashboard setup, beyond scopes:

| Section | What's configured |
|---|---|
| Interactivity & Shortcuts | Toggled on; Request URL → `/slack/interactivity`. Message shortcut created ("On messages"), callback ID `kb_summarize` (must match `CALLBACK_ID` in `src/routes/slackInteractivity.ts`) |
| Event Subscriptions | Toggled on; Request URL → `/slack/events`. Subscribed to bot event `message.channels` (and `message.groups` for private channels) |
| OAuth & Permissions | Install/reinstall to workspace after any scope change → yields `SLACK_BOT_TOKEN` |
| Basic Information | App Credentials → Signing Secret → `SLACK_SIGNING_SECRET` |
| Channel membership | Bot must be invited (`/invite @botname`) to any channel it should act in — install is workspace-wide, but visibility is per-channel membership |

## Running it

```
cp .env.example .env   # fill in values
yarn install
yarn build   # compiles src/ -> dist/
yarn start   # runs dist/index.js
```

For development, skip the build step and run directly against source with live reload:

```
yarn dev   # tsx watch src/index.ts
```

Needs a public HTTPS endpoint — Slack calls in via webhook for both the thread-message trigger and the message shortcut. Any small VM/container/PaaS works; it's a plain Express app with no special infra requirements. For local dev, tunnel with `ngrok http 3000` and point the Slack app's Request URLs at the ngrok host.

## Notes

- Slack retries event delivery on slow acks; the `kb!` path dedupes by `event_id` so a retry never double-posts.
- Every incoming request is signature-verified against `SLACK_SIGNING_SECRET`.
- Bot-authored messages and message edits/subtypes are ignored by the `kb!` trigger.

## Deleting test/bad topics

`yarn delete-topics <topic-id> [topic-id...]` removes a Discourse topic and its matching `kb_threads` row in the local SQLite DB together — deleting only the Discourse topic would leave a stale mapping that the next `kb!` trigger would try (and fail) to append to.
