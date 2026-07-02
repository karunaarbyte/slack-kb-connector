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

// Creates a new topic and returns its URL.
export async function createTopic(
  title: string,
  bodyMarkdown: string,
  sourcePermalink?: string
): Promise<string> {
  const raw = sourcePermalink
    ? `${bodyMarkdown}\n\n---\n*Summarized from a [Slack thread](${sourcePermalink})*`
    : bodyMarkdown;

  const resp = await client.post("/posts.json", {
    title,
    raw,
    category: config.discourseCategoryId,
  });

  const { topic_id, topic_slug } = resp.data;
  return `${config.discourseBaseUrl}/t/${topic_slug}/${topic_id}`;
}
