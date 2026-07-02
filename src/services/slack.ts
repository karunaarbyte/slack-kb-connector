import { WebClient } from "@slack/web-api";
import config from "../config";

const client = new WebClient(config.slackBotToken);

// Pulls the full thread (parent + replies) in chronological order.
export async function fetchThread(channel: string, threadTs: string) {
  const messages: any[] = [];
  let cursor: string | undefined;

  do {
    const resp = await client.conversations.replies({
      channel,
      ts: threadTs,
      cursor,
      limit: 200,
    });
    messages.push(...(resp.messages || []));
    cursor = resp.response_metadata?.next_cursor || undefined;
  } while (cursor);

  return messages;
}

const userCache = new Map<string, string>();
export async function resolveUserName(userId: string | undefined): Promise<string> {
  if (!userId) return "unknown";
  if (userCache.has(userId)) return userCache.get(userId)!;
  try {
    const resp = await client.users.info({ user: userId });
    const name = resp.user?.real_name || resp.user?.name || userId;
    userCache.set(userId, name);
    return name;
  } catch {
    return userId;
  }
}

// Builds "Name: message text" transcript, resolving user IDs and skipping bot/system noise.
export async function threadToTranscript(messages: any[]): Promise<string> {
  const lines: string[] = [];
  for (const msg of messages) {
    if (msg.bot_id || msg.subtype) continue;
    const name = await resolveUserName(msg.user);
    const text = (msg.text || "").trim();
    if (!text) continue;
    lines.push(`${name}: ${text}`);
  }
  return lines.join("\n");
}

export async function postMessage(channel: string, threadTs: string, text: string) {
  await client.chat.postMessage({
    channel,
    thread_ts: threadTs,
    text,
  });
}

export async function getPermalink(channel: string, messageTs: string): Promise<string> {
  const resp = await client.chat.getPermalink({ channel, message_ts: messageTs });
  return resp.permalink as string;
}
