import fs from "fs";
import path from "path";

const OUTPUT_FILE = path.join(__dirname, "..", "..", "kb-summaries.md");

// Discourse-off fallback storage. Each entry carries a marker comment
// identifying its Slack thread and how much of it is covered so far — the
// file itself is the source of truth, same role Discourse plays when enabled.
function markerFor(channel: string, threadTs: string, lastMessageTs: string): string {
  return `<!-- kb-connector:thread=${channel}:${threadTs} last_ts=${lastMessageTs} -->`;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function markerRegexFor(channel: string, threadTs: string): RegExp {
  return new RegExp(
    `<!-- kb-connector:thread=${escapeRegex(channel)}:${escapeRegex(threadTs)} last_ts=([0-9.]+) -->`
  );
}

export function saveSummary(
  channel: string,
  threadTs: string,
  title: string,
  bodyMarkdown: string,
  lastMessageTs: string,
  sourcePermalink?: string
): string {
  const link = sourcePermalink ? `\n\n*Source: ${sourcePermalink}*` : "";
  const marker = markerFor(channel, threadTs, lastMessageTs);
  const entry = `\n\n## ${title}\n${new Date().toISOString()}\n${marker}\n\n${bodyMarkdown}${link}\n\n---\n`;
  fs.appendFileSync(OUTPUT_FILE, entry, "utf8");
  return OUTPUT_FILE;
}

export interface FileEntryContext {
  previousBody: string;
  lastMessageTs: string;
}

export function findEntry(channel: string, threadTs: string): FileEntryContext | null {
  if (!fs.existsSync(OUTPUT_FILE)) return null;
  const content = fs.readFileSync(OUTPUT_FILE, "utf8");
  const match = markerRegexFor(channel, threadTs).exec(content);
  if (!match) return null;

  const markerEnd = match.index + match[0].length;
  const rest = content.slice(markerEnd);
  const sepIndex = rest.indexOf("\n---\n");
  const block = sepIndex === -1 ? rest : rest.slice(0, sepIndex);

  return { previousBody: block.trim(), lastMessageTs: match[1] };
}

export function appendUpdate(
  channel: string,
  threadTs: string,
  additionMarkdown: string,
  newLastMessageTs: string
): string {
  const content = fs.readFileSync(OUTPUT_FILE, "utf8");
  const regex = markerRegexFor(channel, threadTs);
  const match = regex.exec(content);
  if (!match) {
    throw new Error("kb-connector: no existing file entry found to append to");
  }

  const markerStart = match.index;
  const markerEnd = markerStart + match[0].length;
  const rest = content.slice(markerEnd);
  const sepIndex = rest.indexOf("\n---\n");
  const blockEnd = sepIndex === -1 ? content.length : markerEnd + sepIndex;

  const newMarker = markerFor(channel, threadTs, newLastMessageTs);
  const insertion = `\n\n### Update — ${new Date().toISOString()}\n${additionMarkdown}`;

  const updated =
    content.slice(0, markerStart) +
    newMarker +
    content.slice(markerEnd, blockEnd) +
    insertion +
    content.slice(blockEnd);

  fs.writeFileSync(OUTPUT_FILE, updated, "utf8");
  return OUTPUT_FILE;
}

export { OUTPUT_FILE };
