import config from "../../config";
import * as slack from "../slack";
import { summarizeThread, evaluateThread, evaluateUpdate, writeUpdate } from "../openai";
import { kbStore, KbEntry } from "../kbStore";
import type { SlackMessage } from "../slack";
import { withLock } from "../../utils/mutex";
import { forceButtonBlocks } from "./blocks";
import { AttachmentChoice, attachmentsMarkdown } from "./attachments";

export type { AttachmentChoice } from "./attachments";
export { getLastSummarizedTs, getNewThreadAttachments } from "./attachments";

export interface RunOptions {
  // Skips the completeness/worth-adding check (used when the user clicks
  // "Summarize Anyway").
  force?: boolean;
  // The user's images/files choice from the "post to KB?" modal (only asked
  // when the thread has any attachments since the last summary).
  attachments?: AttachmentChoice;
  // Already-fetched thread messages, if the caller just called
  // getNewThreadAttachments (which fetches the whole thread to check for
  // attachments) — avoids fetching the same thread from Slack twice on the
  // common no-attachments path. Omitted on the force-summarize/modal-submit
  // paths, where the original fetch happened on an earlier HTTP request and
  // is no longer available. Trade-off: a message posted in the brief window
  // between that fetch and this call won't be included — negligible in
  // practice since both happen within the same request's handling, but a
  // real (if tiny) staleness window, not a full substitute for re-fetching.
  messages?: SlackMessage[];
}

export async function runKbSummary(
  channel: string,
  threadTs: string,
  opts: RunOptions = {}
) {
  if (
    config.slackAllowedChannels.length > 0 &&
    !config.slackAllowedChannels.includes(channel)
  ) {
    console.log(`kb-connector: ignoring disallowed channel ${channel}`);
    return;
  }

  // Serialize runs per-thread so two near-simultaneous triggers can't both
  // read "no existing KB entry" and race to create two separate topics.
  await withLock(`${channel}:${threadTs}`, () => run(channel, threadTs, opts));
}

async function run(channel: string, threadTs: string, opts: RunOptions) {
  console.log(
    `kb-connector: run started (channel=${channel} thread=${threadTs} force=${!!opts.force})`
  );

  try {
    const messages = opts.messages ?? (await slack.fetchThread(channel, threadTs));
    console.log(`kb-connector: fetched ${messages.length} message(s)`);

    // A lone message (no replies) isn't a thread — skip it rather than
    // generating a KB topic from a single line of context. Matters for the
    // message shortcut, which can target any message, threaded or not.
    if (messages.length < 2) {
      console.log("kb-connector: skipped — not a thread");
      await slack.postMessage(channel, threadTs, "That message isn't part of a thread.");
      return;
    }

    const permalink = await slack.getPermalink(channel, threadTs);

    const existing = await kbStore.getExisting(channel, threadTs);

    if (existing) {
      await runUpdate(channel, threadTs, messages, existing, opts);
    } else {
      await runNewThread(channel, threadTs, messages, opts, permalink);
    }
  } catch (err: any) {
    // Full error detail (which can include internal API paths/payloads)
    // goes to the server log only — anyone in the Slack channel can read
    // the reply, so it gets a generic notice instead.
    console.error("kb-connector: run failed —", err?.response?.data || err);
    await slack
      .postMessage(channel, threadTs, "Failed to post to KB. Check the connector logs for details.")
      .catch(() => {});
  }
}

async function runNewThread(
  channel: string,
  threadTs: string,
  messages: SlackMessage[],
  opts: RunOptions,
  permalink: string
) {
  const transcript = await slack.threadToTranscript(messages);

  if (!transcript.trim()) {
    console.log("kb-connector: skipped — empty transcript");
    await slack.postMessage(channel, threadTs, "Nothing to summarize in this thread.");
    return;
  }

  const lastMessageTs = messages[messages.length - 1].ts;

  let title: string;
  let body_markdown: string;

  if (opts.force) {
    ({ title, body_markdown } = await summarizeThread(transcript));
    console.log("kb-connector: force-summarized, skipping completeness check");
  } else {
    const evaluation = await evaluateThread(transcript);
    console.log(
      `kb-connector: completeness check — sufficient=${evaluation.sufficient}${evaluation.reason ? ` reason="${evaluation.reason}"` : ""}`
    );
    if (!evaluation.sufficient) {
      const notice = `${evaluation.reason ? `${evaluation.reason}` : ""}\nKeep discussing, or summarize it as-is anyway?`;
      await slack.postMessage(
        channel,
        threadTs,
        notice,
        forceButtonBlocks(notice, channel, threadTs, opts.attachments)
      );
      return;
    }
    title = evaluation.title!;
    body_markdown = evaluation.body_markdown!;
  }

  body_markdown += await attachmentsMarkdown(messages, opts.attachments);

  const { message } = await kbStore.createEntry(channel, threadTs, title, body_markdown, lastMessageTs, permalink);
  await slack.postMessage(channel, threadTs, message);
}

async function runUpdate(
  channel: string,
  threadTs: string,
  allMessages: SlackMessage[],
  existing: KbEntry,
  opts: RunOptions
) {
  const delta = allMessages.filter(
    (m) => !m.bot_id && !m.subtype && parseFloat(m.ts) > parseFloat(existing.lastMessageTs)
  );

  if (delta.length === 0) {
    console.log("kb-connector: no new messages since last summary");
    await slack.postMessage(channel, threadTs, "Nothing new to add since the last summary.");
    return;
  }

  const deltaTranscript = await slack.threadToTranscript(delta);
  if (!deltaTranscript.trim()) {
    console.log("kb-connector: no new content since last summary");
    await slack.postMessage(channel, threadTs, "Nothing new to add since the last summary.");
    return;
  }

  const newLastMessageTs = delta[delta.length - 1].ts;

  let additionMarkdown: string;

  if (opts.force) {
    additionMarkdown = await writeUpdate(existing.previousBody, deltaTranscript);
    console.log("kb-connector: force-appended update, skipping worth-adding check");
  } else {
    const evaluation = await evaluateUpdate(existing.previousBody, deltaTranscript);
    console.log(
      `kb-connector: update check — worth_adding=${evaluation.worthAdding}${evaluation.reason ? ` reason="${evaluation.reason}"` : ""}`
    );
    if (!evaluation.worthAdding) {
      const notice = `${evaluation.reason || ""}\nKeep discussing, or add it to the existing KB entry as-is?`;
      await slack.postMessage(
        channel,
        threadTs,
        notice,
        forceButtonBlocks(notice, channel, threadTs, opts.attachments)
      );
      return;
    }
    additionMarkdown = evaluation.additionMarkdown!;
  }

  additionMarkdown += await attachmentsMarkdown(delta, opts.attachments);

  const { message } = await kbStore.appendEntry(existing, channel, threadTs, additionMarkdown, newLastMessageTs);
  await slack.postMessage(channel, threadTs, message);
}
