import OpenAI from "openai";
import config from "../config";

const client = new OpenAI({ apiKey: config.openaiApiKey });

const SYSTEM_PROMPT = `You summarize Slack thread discussions into a knowledge-base article.
Return strict JSON: {"title": string, "body_markdown": string}.
- title: concise, specific, under 100 chars, no trailing punctuation.
- body_markdown: well-structured markdown capturing the problem/context, discussion, and resolution/decision if any. Use headings and bullet lists where useful. Do not invent facts not present in the transcript.`;

export interface ThreadSummary {
  title: string;
  body_markdown: string;
}

export async function summarizeThread(transcript: string): Promise<ThreadSummary> {
  const resp = await client.chat.completions.create({
    model: config.openaiModel,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: transcript },
    ],
    temperature: 0.2,
  });

  const raw = resp.choices[0].message.content ?? "{}";
  const parsed = JSON.parse(raw);
  if (!parsed.title || !parsed.body_markdown) {
    throw new Error("Malformed summary response from OpenAI");
  }
  return parsed;
}
