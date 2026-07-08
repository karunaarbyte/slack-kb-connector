# Slack service (`src/services/slack/`)

All Slack Web API access goes through this folder. Nothing outside it should import
`@slack/web-api` directly — everything else (`kbSummary.ts`, `routes/slackEvents.ts`,
`routes/slackInteractivity.ts`) imports from the barrel:

```ts
import * as slack from "../services/slack";
```

## Files

| File | What it owns | Import for |
|---|---|---|
| `client.ts` | The single `WebClient` instance, built from `config.slackBotToken`. Not re-exported by the barrel — internal to this folder only. | Nothing — other modules in this folder import `client` directly; code outside the folder should never need it. |
| `threads.ts` | Reading a thread and turning it into an LLM-ready transcript. | `fetchThread(channel, threadTs)` — paginated `conversations.replies`, returns raw Slack message objects. `resolveUserName(userId)` — user ID → display name, cached in-process. `threadToTranscript(messages)` — full pipeline: skips bot/subtype messages, resolves names, extracts text (handling block-kit rich text, Slack's `<url\|label>` syntax, file/attachment placeholders), returns `"Name: text"` lines joined by newline. |
| `attachments.ts` | Everything about Slack file objects: classifying and downloading them. | `SlackFile` — the trimmed shape of a Slack file object this codebase cares about (`id`, `name`, `mimetype`, `url_private`, `permalink`). `collectThreadFiles(messages)` — splits every file across a set of messages into `{ images, files }` by mimetype. `downloadSlackFile(file)` — fetches `url_private` with bot-token auth, returns `{ buffer, filename, mimetype }`; throws if Slack returns an HTML page instead of file bytes (see Gotchas below). |
| `messages.ts` | Posting/editing/deleting messages in a thread, and permalinks. | `postMessage(channel, threadTs, text, blocks?)`, `updateMessage(channel, messageTs, text, blocks?)`, `deleteMessage(channel, messageTs)`, `getPermalink(channel, messageTs)`. |
| `modals.ts` | Opening modals. | `openModal(triggerId, view)` — thin wrapper over `views.open`. The only way anything outside this folder should trigger a modal; nothing outside the folder holds a `trigger_id`-consuming client. |
| `index.ts` | Barrel. Re-exports everything from the four modules above (not `client.ts`). | The only path anything outside `src/services/slack` should import from. |

## Design rules for this folder

- **`client.ts` stays private.** Every other file in this folder imports `client` from
  `./client`; nothing outside the folder imports it at all. If you need a new raw Slack
  Web API call, add a wrapper function in the appropriate module here rather than reaching
  for `client`/`WebClient` from a route or service file.
- **One instance, in-process cache.** `resolveUserName`'s cache (`threads.ts`) and the
  `WebClient` itself are both plain module-level state — fine for a single Node process,
  but note this if the service is ever run as multiple instances (see
  `docs/SCALING.md` for the equivalent concern on the thread-mapping DB).
- **`SlackFile` is intentionally a narrow type**, not the full Slack file object — add
  fields to it only as new call sites actually need them.

## Gotchas worth knowing

- **`url_private` needs the `files:read` bot scope.** Without it, Slack doesn't error —
  it returns `200` with an HTML login/interstitial page instead of the file bytes.
  `downloadSlackFile` detects this by checking the response `content-type` for
  `text/html` and throws explicitly, so the failure surfaces here instead of three calls
  later as a confusing "Discourse couldn't determine image size" error.
- **`permalink` vs `url_private`**: `threads.ts`'s transcript-building code (used for the
  OpenAI prompt) links files by `permalink` — a page a human can actually open without
  bot auth. `attachments.ts`'s `downloadSlackFile` uses `url_private` — the only URL that
  actually serves the raw bytes, but it requires bot-token auth. Don't conflate the two.
- **Slack buttons/modals have no disabled state.** The standard pattern used throughout
  the routes that call into this service is: replace a message's blocks with a
  "⏳ working…" placeholder (`updateMessage`) so it can't be clicked again, do the work,
  then `deleteMessage` the placeholder once the real result has posted below it. See
  `runSummaryReplacingMessage` in `src/routes/slackInteractivity.ts` for the shared
  implementation.
- **`views.open`'s `trigger_id` is only valid ~3 seconds** and is only handed out by an
  interactive component (a shortcut invocation or a button click) — never by the Events
  API. That's why the `kb!` text trigger (`routes/slackEvents.ts`, which only gets Events
  API payloads) can't open a modal directly: it posts a button first, and only that
  button's click carries a usable `trigger_id`. Any future modal you add from an
  Events-API-driven code path will hit the same constraint.
