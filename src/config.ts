import "dotenv/config";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

const discourseEnabled = (process.env.DISCOURSE_ENABLED || "true").toLowerCase() !== "false";

export const config = {
  port: process.env.PORT || 3000,

  slackBotToken: required("SLACK_BOT_TOKEN"),
  slackSigningSecret: required("SLACK_SIGNING_SECRET"),
  slackAllowedChannels: (process.env.SLACK_ALLOWED_CHANNELS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),

  openaiApiKey: required("OPENAI_API_KEY"),
  openaiModel: process.env.OPENAI_MODEL || "gpt-4o-mini",

  discourseEnabled,
  discourseBaseUrl: discourseEnabled ? required("DISCOURSE_BASE_URL").replace(/\/$/, "") : "",
  discourseApiKey: discourseEnabled ? required("DISCOURSE_API_KEY") : "",
  discourseApiUsername: discourseEnabled ? required("DISCOURSE_API_USERNAME") : "",
  discourseCategoryId: discourseEnabled ? Number(required("DISCOURSE_CATEGORY_ID")) : undefined,

  // Maps (channel, thread_ts) -> (topic_id, last_message_ts) so re-triggers
  // don't depend on parsing/searching Discourse post content at all.
  tursoDatabaseUrl: discourseEnabled ? required("TURSO_DATABASE_URL") : "",
  tursoAuthToken: discourseEnabled ? required("TURSO_AUTH_TOKEN") : "",
};

export default config;
