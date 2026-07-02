import fs from "fs";
import path from "path";

const OUTPUT_FILE = path.join(__dirname, "..", "..", "kb-summaries.md");

// Discourse-off fallback: append summary to a file in repo root instead of posting.
export function saveSummary(title: string, bodyMarkdown: string, sourcePermalink?: string): string {
  const link = sourcePermalink ? `\n\n*Source: ${sourcePermalink}*` : "";
  const entry = `\n\n## ${title}\n${new Date().toISOString()}\n\n${bodyMarkdown}${link}\n\n---\n`;
  fs.appendFileSync(OUTPUT_FILE, entry, "utf8");
  return OUTPUT_FILE;
}

export { OUTPUT_FILE };
