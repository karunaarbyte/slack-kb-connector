import config from "../config";
import * as slack from "./slack";
import { summarizeThread, evaluateThread, evaluateUpdate, writeUpdate } from "./openai";
import * as discourse from "./discourse";
import * as fileKb from "./fileKb";
import { withLock } from "../utils/mutex";

// Action ID for the "Summarize Anyway" button, matched in slackInteractivity.ts.
// Reused for both "archive this new thread anyway" and "append this update
// anyway" — runKbSummary figures out which case applies at runtime.
export const FORCE_SUMMARIZE_ACTION = "kb_force_summarize";

function forceButtonBlocks(notice: string, channel: string, threadTs: string) {
  return [
    { type: "section", text: { type: "mrkdwn", text: notice } },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "✅ Summarize Anyway", emoji: true },
          style: "primary",
          action_id: FORCE_SUMMARIZE_ACTION,
          value: JSON.stringify({ channel, threadTs }),
        },
      ],
    },
  ];
}

// force=true skips the completeness/worth-adding check (used when the user
// clicks "Summarize Anyway").
export async function runKbSummary(
  channel: string,
  threadTs: string,
  opts: { force?: boolean } = {}
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

async function run(channel: string, threadTs: string, opts: { force?: boolean }) {
  console.log(
    `kb-connector: run started (channel=${channel} thread=${threadTs} force=${!!opts.force})`
  );

  try {
    const messages = await slack.fetchThread(channel, threadTs);
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

    // No local database — Discourse (or the local file, in fallback mode)
    // is the source of truth for "has this thread already been archived."
    const existing = config.discourseEnabled
      ? await discourse.findTopicByPermalink(permalink)
      : fileKb.findEntry(channel, threadTs);

    if (existing) {
      await runUpdate(channel, threadTs, messages, existing, opts);
    } else {
      await runNewThread(channel, threadTs, messages, opts, permalink);
    }
  } catch (err: any) {
    console.error("kb-connector: run failed —", err?.response?.data || err);
    await slack
      .postMessage(channel, threadTs, `Failed to post to KB: ${err.message}`)
      .catch(() => {});
  }
}

async function runNewThread(
  channel: string,
  threadTs: string,
  messages: any[],
  opts: { force?: boolean },
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
      await slack.postMessage(channel, threadTs, notice, forceButtonBlocks(notice, channel, threadTs));
      return;
    }
    title = evaluation.title!;
    body_markdown = evaluation.body_markdown!;
  }

  if (config.discourseEnabled) {
    const { topicUrl } = await discourse.createTopic(title, body_markdown, lastMessageTs, permalink);
    console.log(`kb-connector: posted to Discourse — ${topicUrl}`);
    await slack.postMessage(channel, threadTs, `Posted to KB: ${topicUrl}`);
  } else {
    const filePath = fileKb.saveSummary(channel, threadTs, title, body_markdown, lastMessageTs, permalink);
    console.log(`kb-connector: saved locally — ${filePath}`);
    await slack.postMessage(channel, threadTs, `Discourse posting is off. Summary saved to ${filePath}`);
  }
}

async function runUpdate(
  channel: string,
  threadTs: string,
  allMessages: any[],
  existing: discourse.TopicContext | fileKb.FileEntryContext,
  opts: { force?: boolean }
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
      await slack.postMessage(channel, threadTs, notice, forceButtonBlocks(notice, channel, threadTs));
      return;
    }
    additionMarkdown = evaluation.additionMarkdown!;
  }

  if (config.discourseEnabled) {
    const context = existing as discourse.TopicContext;
    const topicUrl = await discourse.createReply(context.topicId, additionMarkdown, newLastMessageTs);
    console.log(`kb-connector: appended reply to Discourse — ${topicUrl}`);
    await slack.postMessage(channel, threadTs, `Added to existing KB topic: ${topicUrl}`);
  } else {
    const filePath = fileKb.appendUpdate(channel, threadTs, additionMarkdown, newLastMessageTs);
    console.log(`kb-connector: appended update locally — ${filePath}`);
    await slack.postMessage(channel, threadTs, `Discourse posting is off. Update appended to ${filePath}`);
  }
}
