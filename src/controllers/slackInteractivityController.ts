import express from "express";
import { verifySlackRequest } from "../utils/verifySlackSignature";
import { runKbSummary, AttachmentChoice, getNewThreadAttachments } from "../services/kbSummary";
import * as slack from "../services/slack";
import {
  SUMMARIZE_SHORTCUT_CALLBACK_ID as CALLBACK_ID,
  ATTACHMENT_MODAL_CALLBACK_ID,
  CHOOSE_ATTACHMENTS_ACTION,
  NO_ATTACHMENTS_ACTION,
  FORCE_SUMMARIZE_ACTION,
} from "../constants/slackActions";
import type { InteractivityPayload, ViewSubmissionPayload } from "./types";

function attachmentModalView(channel: string, threadTs: string, messageTs?: string) {
  return {
    type: "modal",
    callback_id: ATTACHMENT_MODAL_CALLBACK_ID,
    private_metadata: JSON.stringify({ channel, threadTs, messageTs }),
    title: { type: "plain_text", text: "Post to KB" },
    submit: { type: "plain_text", text: "Summarize" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "section",
        text: { type: "mrkdwn", text: "This thread has attachments. Include them in the KB post?" },
      },
      {
        type: "input",
        block_id: "attachments",
        optional: true,
        label: { type: "plain_text", text: "Attachments" },
        element: {
          type: "checkboxes",
          action_id: "choice",
          initial_options: [
            { text: { type: "plain_text", text: "Images" }, value: "images" },
            { text: { type: "plain_text", text: "Files" }, value: "files" },
          ],
          options: [
            { text: { type: "plain_text", text: "Images" }, value: "images" },
            { text: { type: "plain_text", text: "Files" }, value: "files" },
          ],
        },
      },
    ],
  };
}

function parseAttachmentChoice(view: ViewSubmissionPayload["view"]): AttachmentChoice {
  const selected: { value: string }[] =
    view.state?.values?.attachments?.choice?.selected_options || [];
  const values = new Set(selected.map((o) => o.value));
  return { images: values.has("images"), files: values.has("files") };
}

// Slack buttons/modals can't be disabled in place — the standard way to
// retire one is to replace its message with a placeholder while the
// (potentially slow) summarize call runs, then delete the placeholder once
// the real result has posted below it. Shared by every path that ends in a
// runKbSummary call: force-summarize, the attachment modal's submit, and the
// "No attachments" button.
async function runSummaryReplacingMessage(
  channel: string | undefined,
  threadTs: string | undefined,
  messageTs: string | undefined,
  opts: Parameters<typeof runKbSummary>[2]
) {
  if (channel && messageTs) {
    await slack
      .updateMessage(channel, messageTs, "Summarizing now…", [
        { type: "section", text: { type: "mrkdwn", text: "⏳ Summarizing now…" } },
      ])
      .catch(() => {});
  }
  if (channel && threadTs) {
    await runKbSummary(channel, threadTs, opts);
  }
  if (channel && messageTs) {
    await slack.deleteMessage(channel, messageTs).catch(() => {});
  }
}

export async function handleSlackInteractivity(
  req: express.Request,
  res: express.Response
): Promise<void> {
  const rawBody = verifySlackRequest(req);
  if (!rawBody) {
    console.warn("kb-connector: rejected /slack/interactivity request — invalid signature");
    res.status(401).send("invalid signature");
    return;
  }

  const params = new URLSearchParams(rawBody);
  const payload = JSON.parse(params.get("payload") || "{}") as InteractivityPayload;

  // "Summarize Anyway" button click — reruns the summary bypassing the
  // completeness check, for the exact channel/thread encoded in the button.
  if (payload.type === "block_actions") {
    const action = payload.actions?.[0];

    // "Choose attachments…" button (posted by the "kb!" trigger when the
    // thread has attachments) — its click carries the trigger_id needed to
    // open the modal that the Events API path couldn't open directly.
    if (action?.action_id === CHOOSE_ATTACHMENTS_ACTION) {
      res.status(200).send("");
      const { channel, threadTs } = JSON.parse(action.value || "{}");
      const triggerId = payload.trigger_id;
      const messageTs = payload.container?.message_ts || payload.message?.ts;
      if (channel && threadTs && triggerId) {
        await slack.openModal(triggerId, attachmentModalView(channel, threadTs, messageTs));
      }
      return;
    }

    // "No attachments" button — skips the modal, summarizes right away.
    if (action?.action_id === NO_ATTACHMENTS_ACTION) {
      res.status(200).send("");
      const { channel, threadTs } = JSON.parse(action.value || "{}");
      const messageTs = payload.container?.message_ts || payload.message?.ts;
      await runSummaryReplacingMessage(channel, threadTs, messageTs, {});
      return;
    }

    if (action?.action_id !== FORCE_SUMMARIZE_ACTION) {
      res.status(200).send("");
      return;
    }

    res.status(200).send("");

    const { channel, threadTs, attachments } = JSON.parse(action.value || "{}");
    console.log(`kb-connector: "Summarize Anyway" clicked (channel=${channel} thread=${threadTs})`);

    const messageTs = payload.container?.message_ts || payload.message?.ts;
    await runSummaryReplacingMessage(channel, threadTs, messageTs, { force: true, attachments });
    return;
  }

  // Modal submission from the "which attachments to post?" prompt (only
  // shown when the thread has images/files — see the message_action branch
  // below).
  if (payload.type === "view_submission" && payload.view?.callback_id === ATTACHMENT_MODAL_CALLBACK_ID) {
    res.status(200).send("");

    const { channel, threadTs, messageTs } = JSON.parse(payload.view.private_metadata || "{}");
    const attachments = parseAttachmentChoice(payload.view);
    console.log(
      `kb-connector: attachment choice submitted (channel=${channel} thread=${threadTs} images=${attachments.images} files=${attachments.files})`
    );
    await runSummaryReplacingMessage(channel, threadTs, messageTs, { attachments });
    return;
  }

  // Message shortcuts target one specific message (the one right-clicked).
  // That message carries thread_ts if it's a reply; for a lone/parent message
  // there's no thread_ts, so its own ts is used — conversations.replies then
  // returns just that single message, which runKbSummary rejects as "not a
  // thread" rather than generating a KB topic from one line of context.
  if (payload.type !== "message_action" || payload.callback_id !== CALLBACK_ID) {
    res.status(200).send("");
    return;
  }

  const channel = payload.channel?.id;
  const message = payload.message;
  const threadTs = message?.thread_ts || message?.ts;
  const triggerId = payload.trigger_id;

  console.log(`kb-connector: message shortcut fired (channel=${channel} thread=${threadTs})`);
  if (!channel || !threadTs) {
    res.status(200).send("");
    return;
  }

  // Checking for attachments means fetching the thread before we can ack —
  // trigger_id is only valid ~3s, so this has to stay fast (a single
  // conversations.replies call, no summarization work yet).
  const { images, files } = await getNewThreadAttachments(channel, threadTs);

  if ((images.length > 0 || files.length > 0) && triggerId) {
    res.status(200).send("");
    await slack.openModal(triggerId, attachmentModalView(channel, threadTs));
    return;
  }

  // No attachments (or no trigger_id, e.g. in tests) — proceed exactly as
  // before with no attachment prompt.
  res.status(200).send("");
  await runKbSummary(channel, threadTs);
}
