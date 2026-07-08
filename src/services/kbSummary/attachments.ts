import config from "../../config";
import * as slack from "../slack";
import * as discourse from "../discourse";
import { kbStore } from "../kbStore";
import type { SlackFile, SlackMessage } from "../slack";

export interface AttachmentChoice {
  images: boolean;
  files: boolean;
}

// Looks up how much of this thread is already covered by an existing KB
// entry, if any. Used both by the orchestrator (index.ts) and by the
// interactivity/events controllers to decide whether to prompt for
// attachments only among messages posted since the last summary, not the
// whole thread.
export async function getLastSummarizedTs(
  channel: string,
  threadTs: string
): Promise<string | undefined> {
  return kbStore.getLastMessageTs(channel, threadTs);
}

// Fetches the thread and returns only the images/files attached since the
// last KB summary (or all of them, for a thread never summarized before).
// Shared by every entry point that needs to decide whether to prompt for
// attachments: the "kb!" text trigger and the message shortcut.
export async function getNewThreadAttachments(
  channel: string,
  threadTs: string
): Promise<{ messages: SlackMessage[]; images: SlackFile[]; files: SlackFile[] }> {
  const messages = await slack.fetchThread(channel, threadTs);
  const lastSummarizedTs = await getLastSummarizedTs(channel, threadTs);
  const newMessages = lastSummarizedTs
    ? messages.filter((m) => parseFloat(m.ts) > parseFloat(lastSummarizedTs))
    : messages;
  const { images, files } = slack.collectThreadFiles(newMessages);
  return { messages, images, files };
}

// Downloads the chosen files from Slack and re-uploads them to Discourse,
// returning markdown to append to the post body. Discourse-only — one bad
// file shouldn't block the whole KB post, so failures are logged and
// skipped rather than thrown.
export async function attachmentsMarkdown(
  messages: SlackMessage[],
  choice: AttachmentChoice | undefined
): Promise<string> {
  if (!choice || !config.discourseEnabled) return "";

  const { images, files } = slack.collectThreadFiles(messages);
  const wanted: { file: SlackFile; isImage: boolean }[] = [
    ...(choice.images ? images.map((file) => ({ file, isImage: true })) : []),
    ...(choice.files ? files.map((file) => ({ file, isImage: false })) : []),
  ];
  if (wanted.length === 0) return "";

  const lines: string[] = [];
  for (const { file, isImage } of wanted) {
    try {
      const { buffer, filename, mimetype } = await slack.downloadSlackFile(file);
      const { url } = await discourse.uploadFile(buffer, filename, mimetype);
      lines.push(isImage ? `![${filename}](${url})` : `[${filename}](${url})`);
    } catch (err) {
      console.warn(`kb-connector: failed to upload attachment ${file.id} —`, err);
    }
  }
  return lines.length > 0 ? `\n\n${lines.join("\n")}` : "";
}
