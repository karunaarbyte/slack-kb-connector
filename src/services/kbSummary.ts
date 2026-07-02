import config from "../config";
import * as slack from "./slack";
import { summarizeThread, evaluateThread } from "./openai";
import { createTopic } from "./discourse";
import { saveSummary } from "./fileKb";

// Action ID for the "Summarize Anyway" button, matched in slackInteractivity.ts.
export const FORCE_SUMMARIZE_ACTION = "kb_force_summarize";

// Pulls the thread, summarizes it, and posts it to the KB (or saves locally).
// force=true skips the completeness check (used when the user clicks "Summarize Anyway").
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

    const transcript = await slack.threadToTranscript(messages);

    if (!transcript.trim()) {
      console.log("kb-connector: skipped — empty transcript");
      await slack.postMessage(channel, threadTs, "Nothing to summarize in this thread.");
      return;
    }

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
        const notice = `${evaluation.reason ? `${evaluation.reason}` : ""}\n Keep discussing, or summarize it as-is anyway?`;
        await slack.postMessage(
          channel,
          threadTs,
          notice,
          [
            {
              type: "section",
              text: { type: "mrkdwn", text: notice },
            },
            {
              type: "actions",
              elements: [
                {
                  type: "button",
                  text: { type: "plain_text", text: "Summarize Anyway →", emoji: true },
                  style: "primary",
                  action_id: FORCE_SUMMARIZE_ACTION,
                  value: JSON.stringify({ channel, threadTs }),
                },
              ],
            },
          ]
        );
        return;
      }
      title = evaluation.title!;
      body_markdown = evaluation.body_markdown!;
    }

    const permalink = await slack.getPermalink(channel, threadTs);

    if (config.discourseEnabled) {
      const topicUrl = await createTopic(title, body_markdown, permalink);
      console.log(`kb-connector: posted to Discourse — ${topicUrl}`);
      await slack.postMessage(channel, threadTs, `Posted to KB: ${topicUrl}`);
    } else {
      const filePath = saveSummary(title, body_markdown, permalink);
      console.log(`kb-connector: saved locally — ${filePath}`);
      await slack.postMessage(
        channel,
        threadTs,
        `✅ Discourse posting is off. Summary saved to ${filePath}`
      );
    }
  } catch (err: any) {
    console.error("kb-connector: run failed —", err?.response?.data || err);
    await slack
      .postMessage(channel, threadTs, `Failed to post to KB: ${err.message}`)
      .catch(() => {});
  }
}
