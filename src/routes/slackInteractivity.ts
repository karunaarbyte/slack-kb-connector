import express from "express";
import { verifySlackRequest } from "../utils/verifySlackSignature";
import { runKbSummary } from "../services/kbSummary";

const router = express.Router();

// Callback ID configured on the "Summarize to KB" message shortcut in the
// Slack app config (Interactivity & Shortcuts).
const CALLBACK_ID = "kb_summarize";

// Message shortcuts target one specific message (the one right-clicked).
// That message carries thread_ts if it's a reply; for a lone/parent message
// there's no thread_ts, so its own ts is used — conversations.replies then
// returns just that single message, which runKbSummary rejects as "not a
// thread" rather than generating a KB topic from one line of context.
router.post(
  "/slack/interactivity",
  express.raw({ type: "application/x-www-form-urlencoded" }),
  async (req, res) => {
    const rawBody = verifySlackRequest(req);
    if (!rawBody) {
      return res.status(401).send("invalid signature");
    }

    const params = new URLSearchParams(rawBody);
    const payload = JSON.parse(params.get("payload") || "{}");

    if (payload.type !== "message_action" || payload.callback_id !== CALLBACK_ID) {
      return res.status(200).send("");
    }

    const channel = payload.channel?.id;
    const message = payload.message;
    const threadTs = message?.thread_ts || message?.ts;

    // Ack immediately — Slack requires a response within 3s.
    res.status(200).send("");

    if (channel && threadTs) {
      await runKbSummary(channel, threadTs);
    }
  }
);

export default router;
