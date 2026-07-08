// config.ts throws at import time if required env vars are missing (fail
// fast in production) — tests need dummy values in place before any module
// that transitively imports config.ts is loaded. DISCOURSE_ENABLED=false so
// no Discourse-specific vars are required either.
process.env.SLACK_BOT_TOKEN ||= "xoxb-test";
process.env.SLACK_SIGNING_SECRET ||= "test-signing-secret";
process.env.OPENAI_API_KEY ||= "sk-test";
process.env.DISCOURSE_ENABLED ||= "false";
