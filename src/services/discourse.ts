import axios from "axios";
import config from "../config";

const client = axios.create({
  baseURL: config.discourseBaseUrl,
  headers: {
    "Api-Key": config.discourseApiKey,
    "Api-Username": config.discourseApiUsername,
    "Content-Type": "application/json",
  },
});

function stripHtml(text: string): string {
  return text.replace(/<[^>]+>/g, " ").trim();
}

// Identity/coverage state lives in a local SQLite DB (src/services/db.ts), not in post
// content — but every post still carries this as a redundant, human-readable
// trace. If the DB file were ever lost or misconfigured, this is the only thing
// that would let someone reconstruct the channel/thread_ts/last_message_ts
// mapping by hand from Discourse content alone.
const RECOVERY_MARKER_REGEX = /<sub>kb-connector:channel=\S+ thread_ts=\S+ last_ts=[^<\s]+<\/sub>/g;

function withRecoveryMarker(
  bodyMarkdown: string,
  channel: string,
  threadTs: string,
  lastMessageTs: string
): string {
  return `${bodyMarkdown}\n\n<sub>kb-connector:channel=${channel} thread_ts=${threadTs} last_ts=${lastMessageTs}</sub>`;
}

export async function createTopic(
  title: string,
  bodyMarkdown: string,
  channel: string,
  threadTs: string,
  lastMessageTs: string,
  sourcePermalink?: string
): Promise<{ topicId: number; topicUrl: string }> {
  const withSource = sourcePermalink
    ? `${bodyMarkdown}\n\n---\n*Summarized from a [Slack thread](${sourcePermalink})*`
    : bodyMarkdown;
  const raw = withRecoveryMarker(withSource, channel, threadTs, lastMessageTs);

  const resp = await client.post("/posts.json", {
    title,
    raw,
    category: config.discourseCategoryId,
  });

  const { topic_id, topic_slug } = resp.data;
  return {
    topicId: topic_id,
    topicUrl: `${config.discourseBaseUrl}/t/${topic_slug}/${topic_id}`,
  };
}

export async function createReply(
  topicId: number,
  bodyMarkdown: string,
  channel: string,
  threadTs: string,
  lastMessageTs: string
): Promise<string> {
  const raw = withRecoveryMarker(bodyMarkdown, channel, threadTs, lastMessageTs);
  await client.post("/posts.json", { topic_id: topicId, raw });
  return `${config.discourseBaseUrl}/t/${topicId}`;
}

// Fetches the current topic body text, used as context for the LLM when
// evaluating/writing an update — not used for identity/lookup, that lives in
// the local SQLite `kb_threads` table (see src/services/db.ts). Throws with
// `status: 404` (via axios) if the topic no longer exists — callers use that
// to detect a stale mapping.
export async function getTopicBody(topicId: number): Promise<string> {
  const resp = await client.get(`/t/${topicId}.json`);
  const posts: any[] = resp.data?.post_stream?.posts || [];
  return posts
    .map((post) => {
      const raw: string = post.raw || post.cooked || "";
      const withoutMarker = raw.replace(RECOVERY_MARKER_REGEX, "");
      return post.raw ? withoutMarker.trim() : stripHtml(withoutMarker);
    })
    .join("\n\n")
    .trim();
}

// Same axios client as every other call in this module — axios (>=1.4) has
// native spec-compliant FormData/Blob support on Node, so no separate HTTP
// client is needed just for this one multipart call.
export async function uploadFile(
  buffer: Buffer,
  filename: string,
  mimetype: string
): Promise<{ url: string }> {
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: mimetype }), filename);
  form.append("type", "composer");

  // Override the client's default "Content-Type: application/json" — axios
  // sets the correct multipart boundary header itself once it detects a
  // FormData body, but only if we don't pin it to JSON first.
  const resp = await client.post("/uploads.json", form, {
    headers: { "Content-Type": undefined },
  });
  return { url: resp.data.url };
}

export function isNotFoundError(err: any): boolean {
  return err?.response?.status === 404;
}

// Deletes a topic. A 404 (already gone) is treated as success — the caller's
// goal ("this topic shouldn't exist") is already satisfied either way.
export async function deleteTopic(topicId: number): Promise<void> {
  try {
    await client.delete(`/t/${topicId}.json`);
  } catch (err) {
    if (!isNotFoundError(err)) throw err;
  }
}
