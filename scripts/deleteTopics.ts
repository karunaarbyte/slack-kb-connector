/// <reference types="node" />
import * as discourse from "../src/services/discourse";
import * as db from "../src/services/db";

// Deletes one or more Discourse topics by ID, and any Turso kb_threads row
// that still points at them — otherwise a later kb! trigger on that thread
// would try to append to a topic that no longer exists. Usage:
//   yarn delete-topics 301 302 303
async function main() {
  const ids = process.argv.slice(2).map(Number);
  if (ids.length === 0 || ids.some((id) => !Number.isInteger(id))) {
    console.error("Usage: yarn delete-topics <topic-id> [topic-id...]");
    process.exit(1);
  }

  for (const id of ids) {
    try {
      // discourse.deleteTopic treats "already gone" (404) as success, so the
      // DB cleanup below always runs once we know the topic doesn't exist —
      // whether this call deleted it or it was already deleted by hand.
      await discourse.deleteTopic(id);
      await db.deleteMappingsByTopicId(id);
      console.log(`deleted topic ${id} (Discourse + kb_threads)`);
    } catch (err: any) {
      console.error(`failed to delete topic ${id} —`, err?.response?.data || err.message);
    }
  }

  process.exit(0);
}

main();
