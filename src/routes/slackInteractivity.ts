import express from "express";
import { verifySlackRequest } from "../utils/verifySlackSignature";
import { runKbSummary, FORCE_SUMMARIZE_ACTION } from "../services/kbSummary";
import * as slack from "../services/slack";

const router = express.Router();

// Callback ID configured on the "Summarize to KB" message shortcut in the
// Slack app config (Interactivity & Shortcuts).
const CALLBACK_ID = "kb_summarize";

router.post(
  "/slack/interactivity",
  express.raw({ type: "application/x-www-form-urlencoded" }),
  async (req, res) => {
    const rawBody = verifySlackRequest(req);
    if (!rawBody) {
      console.warn("kb-connector: rejected /slack/interactivity request — invalid signature");
      return res.status(401).send("invalid signature");
    }

    const params = new URLSearchParams(rawBody);
    const payload = JSON.parse(params.get("payload") || "{}");

    // "Summarize Anyway" button click — reruns the summary bypassing the
    // completeness check, for the exact channel/thread encoded in the button.
    if (payload.type === "block_actions") {
      const action = payload.actions?.[0];
      if (action?.action_id !== FORCE_SUMMARIZE_ACTION) {
        return res.status(200).send("");
      }

      res.status(200).send("");

      const { channel, threadTs } = JSON.parse(action.value || "{}");
      console.log(`kb-connector: "Summarize Anyway" clicked (channel=${channel} thread=${threadTs})`);

      // Slack buttons can't be disabled in place — replace the message so
      // it can't be clicked again while the summary runs, then delete the
      // placeholder once the real result has posted below it.
      const messageTs = payload.container?.message_ts || payload.message?.ts;
      if (channel && messageTs) {
        await slack
          .updateMessage(channel, messageTs, "Summarizing now…", [
            { type: "section", text: { type: "mrkdwn", text: "⏳ Summarizing now…" } },
          ])
          .catch(() => {});
      }

      if (channel && threadTs) {
        await runKbSummary(channel, threadTs, { force: true });
      }

      if (channel && messageTs) {
        await slack.deleteMessage(channel, messageTs).catch(() => {});
      }
      return;
    }

    // Message shortcuts target one specific message (the one right-clicked).
    // That message carries thread_ts if it's a reply; for a lone/parent message
    // there's no thread_ts, so its own ts is used — conversations.replies then
    // returns just that single message, which runKbSummary rejects as "not a
    // thread" rather than generating a KB topic from one line of context.
    if (payload.type !== "message_action" || payload.callback_id !== CALLBACK_ID) {
      return res.status(200).send("");
    }

    const channel = payload.channel?.id;
    const message = payload.message;
    const threadTs = message?.thread_ts || message?.ts;

    // Ack immediately — Slack requires a response within 3s.
    res.status(200).send("");

    console.log(`kb-connector: message shortcut fired (channel=${channel} thread=${threadTs})`);
    if (channel && threadTs) {
      await runKbSummary(channel, threadTs);
    }
  }
);

export default router;
