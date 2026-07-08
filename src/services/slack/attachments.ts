import axios from "axios";
import config from "../../config";

export interface SlackFile {
  id: string;
  name?: string;
  title?: string;
  mimetype?: string;
  url_private?: string;
  permalink?: string;
}

// The subset of a Slack message object this codebase actually reads. Block
// Kit's `blocks`/`attachments` shapes are deep and Slack-version-dependent —
// left as `any[]` rather than modeled in full, since nothing here does more
// than walk them structurally (see threads.ts).
export interface SlackMessage {
  ts: string;
  text?: string;
  blocks?: any[];
  files?: SlackFile[];
  attachments?: any[];
  user?: string;
  bot_id?: string;
  subtype?: string;
  thread_ts?: string;
}

// Splits every file attached anywhere in a thread into images vs. other
// files, for the "post attachments to KB?" prompt — separate from
// threadToTranscript, which only needs a text placeholder for the transcript.
export function collectThreadFiles(messages: SlackMessage[]): { images: SlackFile[]; files: SlackFile[] } {
  const images: SlackFile[] = [];
  const files: SlackFile[] = [];
  for (const msg of messages) {
    for (const file of msg.files || []) {
      (file.mimetype?.startsWith("image/") ? images : files).push(file);
    }
  }
  return { images, files };
}

// Slack file content lives behind url_private, which (unlike permalink) needs
// bot-token auth to fetch — requires the app to have the files:read scope.
export async function downloadSlackFile(
  file: SlackFile
): Promise<{ buffer: Buffer; filename: string; mimetype: string }> {
  if (!file.url_private) {
    throw new Error(`file ${file.id} has no url_private`);
  }

  const resp = await axios.get(file.url_private, {
    headers: { Authorization: `Bearer ${config.slackBotToken}` },
    responseType: "arraybuffer",
  });

  const contentType = String(resp.headers["content-type"] || "");
  const buffer = Buffer.from(resp.data);

  // A missing files:read scope doesn't fail this request — Slack returns
  // 200 with an HTML login/interstitial page instead of the file bytes.
  // Catch that here rather than let it surface three calls later as a
  // confusing Discourse "couldn't determine image size" error.
  if (contentType.includes("text/html")) {
    throw new Error(
      `slack returned HTML instead of file content for ${file.id} (likely missing files:read scope) — content-type: ${contentType}`
    );
  }

  return {
    buffer,
    filename: file.name || file.id,
    mimetype: file.mimetype || "application/octet-stream",
  };
}
