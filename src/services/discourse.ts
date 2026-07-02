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

// Every post we write embeds this marker so a later run can tell how much
// of the Slack thread is already reflected in the topic — no separate
// database, Discourse itself is the source of truth for "what's covered."
const MARKER_REGEX = /<!-- kb-connector:last_ts=([0-9.]+) -->/;

function withMarker(bodyMarkdown: string, lastMessageTs: string): string {
  return `${bodyMarkdown}\n\n<!-- kb-connector:last_ts=${lastMessageTs} -->`;
}

function stripHtml(text: string): string {
  return text.replace(/<[^>]+>/g, " ").trim();
}

export async function createTopic(
  title: string,
  bodyMarkdown: string,
  lastMessageTs: string,
  sourcePermalink?: string
): Promise<{ topicId: number; topicUrl: string }> {
  const withSource = sourcePermalink
    ? `${bodyMarkdown}\n\n---\n*Summarized from a [Slack thread](${sourcePermalink})*`
    : bodyMarkdown;
  const raw = withMarker(withSource, lastMessageTs);

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
  lastMessageTs: string
): Promise<string> {
  const raw = withMarker(bodyMarkdown, lastMessageTs);
  await client.post("/posts.json", { topic_id: topicId, raw });
  return `${config.discourseBaseUrl}/t/${topicId}`;
}

export interface TopicContext {
  topicId: number;
  topicUrl: string;
  previousBody: string;
  lastMessageTs: string;
}

async function getTopicContext(topicId: number): Promise<TopicContext | null> {
  const resp = await client.get(`/t/${topicId}.json`);
  const posts: any[] = resp.data?.post_stream?.posts || [];
  if (posts.length === 0) return null;

  let lastMessageTs = "0";
  const bodies: string[] = [];
  for (const post of posts) {
    // `raw` (markdown) is only present if the API key has edit rights on the
    // post (true for an admin/system bot key); fall back to `cooked` (HTML)
    // otherwise — HTML comments survive markdown->HTML rendering, so the
    // marker is still findable there.
    const text: string = post.raw || post.cooked || "";
    const markerMatch = MARKER_REGEX.exec(text);
    if (markerMatch && parseFloat(markerMatch[1]) > parseFloat(lastMessageTs)) {
      lastMessageTs = markerMatch[1];
    }
    const withoutMarker = text.replace(MARKER_REGEX, "").trim();
    bodies.push(post.raw ? withoutMarker : stripHtml(withoutMarker));
  }

  const topicSlug = resp.data.slug;
  return {
    topicId,
    topicUrl: `${config.discourseBaseUrl}/t/${topicSlug}/${topicId}`,
    previousBody: bodies.join("\n\n"),
    lastMessageTs,
  };
}

// Finds an existing topic for this Slack thread by searching for the
// permalink createTopic embeds in every topic body, then verifying the
// match by fetching the topic directly — Discourse's search is fuzzy/
// tokenized, so a search hit alone isn't trustworthy confirmation.
export async function findTopicByPermalink(sourcePermalink: string): Promise<TopicContext | null> {
  try {
    const searchResp = await client.get("/search.json", {
      params: { q: `"${sourcePermalink}"` },
    });
    const candidates: any[] = searchResp.data?.posts || [];

    for (const post of candidates) {
      const topicId = post.topic_id;
      if (!topicId) continue;

      const context = await getTopicContext(topicId);
      if (context && context.previousBody.includes(sourcePermalink)) {
        return context;
      }
    }
    return null;
  } catch (err) {
    console.warn("kb-connector: Discourse topic lookup failed, treating as new topic —", err);
    return null;
  }
}
