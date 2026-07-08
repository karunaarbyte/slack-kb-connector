import { client } from "./client";

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
