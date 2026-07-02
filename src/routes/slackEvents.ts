import express from "express";
import { verifySlackRequest } from "../utils/verifySlackSignature";
import { runKbSummary } from "../services/kbSummary";

const router = express.Router();

// Not "/kb" — Slack's client intercepts any message starting with "/" as a
// slash-command attempt and never sends it, so the bot would never see it.
// (Also confirmed separately: slash commands are blocked outright from the
// thread-reply composer, so they can't target a specific thread anyway.)
const TRIGGER = "kb!";

// Slack retries delivery on slow/failed acks (up to 3x). Dedupe by event_id
// so a retry doesn't create a duplicate KB topic.
const seenEventIds = new Set<string>();
function alreadyHandled(eventId: string | undefined): boolean {
  if (!eventId) return false;
  if (seenEventIds.has(eventId)) return true;
  seenEventIds.add(eventId);
  setTimeout(() => seenEventIds.delete(eventId), 10 * 60 * 1000).unref();
  return false;
}

router.post(
  "/slack/events",
  express.raw({ type: "*/*" }),
  async (req, res) => {
    const rawBody = verifySlackRequest(req);
    if (!rawBody) {
      console.warn("kb-connector: rejected /slack/events request — invalid signature");
      return res.status(401).json({ ok: false, error: "invalid signature" });
    }

    const payload = JSON.parse(rawBody);

    if (payload.type === "url_verification") {
      return res.status(200).json({ challenge: payload.challenge });
    }

    // Ack immediately — Slack requires a response within 3s. Do the real work after.
    res.status(200).json({ ok: true });

    if (payload.type !== "event_callback") return;
    if (alreadyHandled(payload.event_id)) return;

    const event = payload.event;
    if (!event || event.type !== "message") return;
    if (event.bot_id || event.subtype) return;

    const channel = event.channel;
    const threadTs = event.thread_ts;
    const text = (event.text || "").trim();

    // Only fire inside a thread reply, and only on the exact trigger command.
    if (!threadTs || threadTs === event.ts) return;
    if (text.toLowerCase() !== TRIGGER) return;

    console.log(`kb-connector: "kb!" trigger fired (channel=${channel} thread=${threadTs})`);
    await runKbSummary(channel, threadTs);
  }
);

export default router;
