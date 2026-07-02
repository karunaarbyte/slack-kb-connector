import config from "../config";
import * as slack from "./slack";
import { summarizeThread } from "./openai";
import { createTopic } from "./discourse";
import { saveSummary } from "./fileKb";

// Pulls the thread, summarizes it, and posts it to the KB (or saves locally).
export async function runKbSummary(channel: string, threadTs: string) {
  if (
    config.slackAllowedChannels.length > 0 &&
    !config.slackAllowedChannels.includes(channel)
  ) {
    return;
  }

  try {
    const messages = await slack.fetchThread(channel, threadTs);

    // A lone message (no replies) isn't a thread — skip it rather than
    // generating a KB topic from a single line of context. Matters for the
    // message shortcut, which can target any message, threaded or not.
    if (messages.length < 2) {
      await slack.postMessage(channel, threadTs, "That message isn't part of a thread.");
      return;
    }

    const transcript = await slack.threadToTranscript(messages);

    if (!transcript.trim()) {
      await slack.postMessage(channel, threadTs, "Nothing to summarize in this thread.");
      return;
    }

    const { title, body_markdown } = await summarizeThread(transcript);
    const permalink = await slack.getPermalink(channel, threadTs);

    if (config.discourseEnabled) {
      const topicUrl = await createTopic(title, body_markdown, permalink);
      await slack.postMessage(channel, threadTs, `Posted to KB: ${topicUrl}`);
    } else {
      const filePath = saveSummary(title, body_markdown, permalink);
      await slack.postMessage(
        channel,
        threadTs,
        `Discourse posting is off. Summary saved to ${filePath}`
      );
    }
  } catch (err: any) {
    console.error("kb-connector error:", err?.response?.data || err);
    await slack
      .postMessage(channel, threadTs, `Failed to post to KB: ${err.message}`)
      .catch(() => {});
  }
}
