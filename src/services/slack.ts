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

// Recursively pulls plain text out of a Block Kit rich_text element tree.
// msg.text is often empty/stale for block-composed messages (e.g. some
// integrations, edited messages) even though the visible content lives here.
function textFromBlockElements(elements: any[]): string {
  return elements
    .map((el) => {
      if (el.type === "text") return el.text || "";
      if (el.type === "link") return el.text || el.url || "";
      if (el.type === "user") return `@${el.user_id}`;
      if (el.elements) return textFromBlockElements(el.elements);
      return "";
    })
    .join("");
}

function textFromBlocks(blocks: any[] | undefined): string {
  if (!blocks) return "";
  return blocks
    .map((block) => (block.elements ? textFromBlockElements(block.elements) : ""))
    .filter(Boolean)
    .join("\n");
}

// Converts Slack's raw link syntax (<url>, <url|label>) into markdown links,
// so the summarizer sees clean, referenceable URLs instead of angle-bracket
// syntax it might otherwise echo verbatim into the KB article.
function cleanSlackLinks(text: string): string {
  return text.replace(/<(https?:\/\/[^|>]+)(?:\|([^>]+))?>/g, (_match, url, label) =>
    label ? `[${label}](${url})` : url
  );
}

// Builds a best-effort text representation of a message: its own text,
// falling back to Block Kit content, plus file/attachment titles so the
// summarizer at least knows something was shared even if it can't read it.
function extractMessageText(msg: any): string {
  const parts: string[] = [];

  const primary = cleanSlackLinks((msg.text || "").trim() || textFromBlocks(msg.blocks).trim());
  if (primary) parts.push(primary);

  for (const file of msg.files || []) {
    const name = file.name || file.title || "untitled";
    // permalink is the file's own page, url_private needs bot auth to fetch —
    // permalink is what a human reading the KB article could actually open.
    parts.push(file.permalink ? `[shared file: ${name}](${file.permalink})` : `[shared file: ${name}]`);
  }

  // Slack auto-unfurls links into attachments with the real page title +
  // canonical URL (title_link) — richer than the raw <url|label> the user
  // typed, and present even for bare links with no manual label.
  for (const att of msg.attachments || []) {
    const label = att.title || att.fallback || att.text;
    const url = att.title_link || att.from_url;
    if (label && url) parts.push(`[link: ${label}](${url})`);
    else if (label) parts.push(`[attachment: ${label}]`);
  }

  return parts.join("\n").trim();
}

// Builds "Name: message text" transcript, resolving user IDs and skipping bot/system noise.
export async function threadToTranscript(messages: any[]): Promise<string> {
  const lines: string[] = [];
  for (const msg of messages) {
    if (msg.bot_id || msg.subtype) continue;
    const name = await resolveUserName(msg.user);
    const text = extractMessageText(msg);
    if (!text) continue;
    lines.push(`${name}: ${text}`);
  }
  return lines.join("\n");
}

export async function postMessage(
  channel: string,
  threadTs: string,
  text: string,
  blocks?: any[]
) {
  await client.chat.postMessage({
    channel,
    thread_ts: threadTs,
    text,
    blocks,
  });
}

export async function deleteMessage(channel: string, messageTs: string) {
  await client.chat.delete({ channel, ts: messageTs });
}

// Slack buttons have no built-in "disabled" state — replacing the message's
// blocks is the standard way to retire a button once it's been acted on.
export async function updateMessage(
  channel: string,
  messageTs: string,
  text: string,
  blocks?: any[]
) {
  await client.chat.update({
    channel,
    ts: messageTs,
    text,
    blocks,
  });
}

export async function getPermalink(channel: string, messageTs: string): Promise<string> {
  const resp = await client.chat.getPermalink({ channel, message_ts: messageTs });
  return resp.permalink as string;
}
