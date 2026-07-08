import express from "express";
import { verifySlackRequest } from "../utils/verifySlackSignature";
import { runKbSummary, getNewThreadAttachments } from "../services/kbSummary";
import * as slack from "../services/slack";
import { CHOOSE_ATTACHMENTS_ACTION, NO_ATTACHMENTS_ACTION } from "../constants/slackActions";
import { isMessageEvent } from "./types";
import type { SlackEventsPayload } from "./types";

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

export async function handleSlackEvent(
  req: express.Request,
  res: express.Response
): Promise<void> {
  const rawBody = verifySlackRequest(req);
  if (!rawBody) {
    console.warn("kb-connector: rejected /slack/events request — invalid signature");
    res.status(401).json({ ok: false, error: "invalid signature" });
    return;
  }

  const payload = JSON.parse(rawBody) as SlackEventsPayload;

  if (payload.type === "url_verification") {
    res.status(200).json({ challenge: payload.challenge });
    return;
  }

  // Ack immediately — Slack requires a response within 3s. Do the real work after.
  res.status(200).json({ ok: true });

  if (alreadyHandled(payload.event_id)) return;

  const event = payload.event;
  if (!event || !isMessageEvent(event)) return;
  if (event.bot_id || event.subtype) return;

  const channel = event.channel;
  const threadTs = event.thread_ts;
  const text = (event.text || "").trim();

  // Only fire inside a thread reply, and only on the exact trigger command.
  if (!threadTs || threadTs === event.ts) return;
  if (text.toLowerCase() !== TRIGGER) return;

  console.log(`kb-connector: "kb!" trigger fired (channel=${channel} thread=${threadTs})`);

  // The Events API never gives us a trigger_id, so we can't call
  // views.open directly here — only an interactive component (button
  // click, shortcut) can. When the thread has attachments, post a button;
  // its click carries a trigger_id that opens the same attachment-choice
  // modal used by the message shortcut.
  const { messages, images, files } = await getNewThreadAttachments(channel, threadTs);
  if (images.length > 0 || files.length > 0) {
    await slack.postMessage(channel, threadTs, "This thread has attachments.", [
      { type: "section", text: { type: "mrkdwn", text: "This thread has attachments. Include them in the KB post?" } },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "Choose attachments…", emoji: true },
            style: "primary",
            action_id: CHOOSE_ATTACHMENTS_ACTION,
            value: JSON.stringify({ channel, threadTs }),
          },
          {
            type: "button",
            text: { type: "plain_text", text: "No attachments", emoji: true },
            action_id: NO_ATTACHMENTS_ACTION,
            value: JSON.stringify({ channel, threadTs }),
          },
        ],
      },
    ]);
    return;
  }

  await runKbSummary(channel, threadTs, { messages });
}
