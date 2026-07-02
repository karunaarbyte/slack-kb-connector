import OpenAI from "openai";
import config from "../config";

const client = new OpenAI({ apiKey: config.openaiApiKey });

const SHARED_RULES = `
- Ignore noise: reactions-as-text (e.g. "lol", "+1", "👀"), tangents unrelated to the main topic, and small talk. Focus on the substantive thread of discussion.
- Do not invent facts not present in the transcript. If something is ambiguous or unconfirmed, say so rather than guessing.
- If messages conflict (two people propose different answers, or someone contradicts an earlier claim), note the conflict and which claim (if any) won out — don't silently pick one and present it as uncontested.
- If the final answer is implied rather than explicitly stated (e.g. the conversation just stops after a fix is posted, with a 👍 reaction but no confirmation message), state that the resolution appears to be X but wasn't explicitly confirmed.
- If a reply quotes or refers back to an earlier message ("re: what Sam said above"), resolve the reference using the quoted/earlier content rather than treating the reply in isolation.
- title: a descriptive noun phrase or imperative, not a question — e.g. "Fixing the staging DB connection timeout" or "Deploying via the new CI pipeline", not "How do we fix...?". Concise, specific, under 100 chars, no trailing punctuation.
- body_markdown: structured with headings/bullets — Problem/Context, Discussion (only if it adds necessary nuance), Resolution/Decision. Skip sections that don't apply rather than padding them. Minimum: a real Problem/Context statement plus a real Resolution — do not return a title-only or placeholder body.
- Preserve every link, doc, and shared file mentioned in the transcript as a markdown link — under a "References" section if there are any, so readers can follow them later.
- Attribute key decisions to the person who made them when it's clear from the transcript (e.g. "Karuna decided to roll back the deploy"), but don't force attribution where it's a group consensus.`;

const SYSTEM_PROMPT = `You summarize Slack thread discussions into a knowledge-base article.
Return strict JSON: {"title": string, "body_markdown": string}.
${SHARED_RULES}`;

export interface ThreadSummary {
  title: string;
  body_markdown: string;
}

// Valid JSON with a title and a body isn't the same as a *useful* article —
// this catches the model technically satisfying the schema with thin output
// (e.g. a one-line body_markdown that's really just the title restated).
const MIN_BODY_LENGTH = 40;

function assertSubstantial(title: unknown, body_markdown: unknown): asserts title is string {
  if (typeof title !== "string" || !title.trim()) {
    throw new Error("Malformed summary response from OpenAI: missing title");
  }
  if (typeof body_markdown !== "string" || body_markdown.trim().length < MIN_BODY_LENGTH) {
    throw new Error("Malformed summary response from OpenAI: body_markdown too thin to be useful");
  }
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
  assertSubstantial(parsed.title, parsed.body_markdown);
  return parsed;
}

const EVALUATE_PROMPT = `You judge whether a Slack thread transcript is conclusive enough to archive as a knowledge-base article, and if so, write that article — in one pass.

Sufficient means the thread reaches some resolution, decision, answer, or otherwise-reusable insight — something a future reader could act on or learn from.
Insufficient means it's an open question with no answer yet, an unresolved back-and-forth, or too thin/vague to be useful later.

Edge cases:
- A single link dropped with no discussion is NOT sufficient — there's no synthesized insight, just a pointer.
- A short thread (even 2-3 messages) IS sufficient if it reaches a clear answer or decision — length doesn't determine sufficiency, resolution does.
- A workaround suggested but never confirmed to work is NOT sufficient — flag it as unconfirmed in the reason.
- A postmortem or decision record with reasoning, even without further discussion, IS sufficient.

Return strict JSON with keys in this order: {"reason": string, "sufficient": boolean, "title": string | null, "body_markdown": string | null}.
- reason: write this first. One or two sentences stating specifically what resolution (or lack of one) drove your call — not a vague restatement like "not enough discussion." E.g. "The proposed fix was suggested but nobody confirmed it resolved the issue" or "The team explicitly decided to postpone the migration until Q3."
- sufficient: your verdict, consistent with reason.
- If sufficient is true: title and body_markdown are required, following the same rules as a standalone summary:
${SHARED_RULES}
- If sufficient is false: title and body_markdown must be null.`;

export interface ThreadEvaluation {
  sufficient: boolean;
  reason: string;
  title: string | null;
  body_markdown: string | null;
}

// Single model call that does double duty: judges whether the thread is
// worth archiving, and writes the article if it is. Avoids a second round
// trip (and the risk of the gate and the summary disagreeing) on the common
// path. summarizeThread is still used standalone for the "Summarize Anyway"
// override, which skips the sufficiency judgment entirely.
//
// Few-shot examples below are passed as real message history (not stuffed
// into the system prompt) — models follow demonstrated input/output pairs
// more reliably than adjectives like "concise" or "conclusive" alone.
const FEW_SHOT_EXAMPLES: { role: "user" | "assistant"; content: string }[] = [
  {
    role: "user",
    content: "Alex: has anyone seen this error before? [screenshot]\nJordan: hm not sure, let me check",
  },
  {
    role: "assistant",
    content: JSON.stringify({
      reason:
        "Alex asked a question and Jordan only said they'd look into it — no answer or resolution was reached.",
      sufficient: false,
      title: null,
      body_markdown: null,
    }),
  },
  {
    role: "user",
    content:
      "Priya: staging DB connections are timing out after the pool size bump\nSam: check if the connection limit on the RDS instance itself got raised too, not just the app pool config\nPriya: that was it, RDS max_connections was still at the old default. bumped it and timeouts stopped",
  },
  {
    role: "assistant",
    content: JSON.stringify({
      reason:
        "Sam identified the root cause (RDS max_connections mismatch) and Priya confirmed raising it fixed the timeouts.",
      sufficient: true,
      title: "Staging DB connection timeouts from RDS max_connections mismatch",
      body_markdown:
        "## Problem\nStaging DB connections started timing out after the app-level connection pool size was increased.\n\n## Resolution\nThe RDS instance's own `max_connections` setting was still at its old default, so it — not the app pool — was the actual bottleneck. Raising `max_connections` on the RDS instance resolved the timeouts.",
    }),
  },
];

export async function evaluateThread(transcript: string): Promise<ThreadEvaluation> {
  const resp = await client.chat.completions.create({
    model: config.openaiModel,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: EVALUATE_PROMPT },
      ...FEW_SHOT_EXAMPLES,
      { role: "user", content: transcript },
    ],
    temperature: 0.2,
  });

  const raw = resp.choices[0].message.content ?? "{}";
  const parsed = JSON.parse(raw);
  if (typeof parsed.sufficient !== "boolean") {
    throw new Error("Malformed evaluation response from OpenAI");
  }
  if (parsed.sufficient) {
    assertSubstantial(parsed.title, parsed.body_markdown);
  }
  return {
    sufficient: parsed.sufficient,
    reason: parsed.reason || "",
    title: parsed.title ?? null,
    body_markdown: parsed.body_markdown ?? null,
  };
}
