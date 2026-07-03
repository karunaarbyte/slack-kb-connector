import { DatabaseSync } from "node:sqlite";
import fs from "fs";
import path from "path";
import config from "../config";

// Constructed lazily, on first actual use, rather than at module load — this
// module is imported unconditionally by kbSummary.ts, but in fallback (file)
// mode nothing ever calls into it, so there's no reason to touch disk.
let _db: DatabaseSync | null = null;
function getDb(): DatabaseSync {
  if (!_db) {
    fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
    _db = new DatabaseSync(config.dbPath);
    _db.exec(`
      CREATE TABLE IF NOT EXISTS kb_threads (
        channel TEXT NOT NULL,
        thread_ts TEXT NOT NULL,
        topic_id INTEGER NOT NULL,
        topic_url TEXT NOT NULL,
        last_message_ts TEXT NOT NULL,
        PRIMARY KEY (channel, thread_ts)
      )
    `);
  }
  return _db;
}

export interface ThreadMapping {
  topicId: number;
  topicUrl: string;
  lastMessageTs: string;
}

export async function getThreadMapping(
  channel: string,
  threadTs: string
): Promise<ThreadMapping | null> {
  const row = getDb()
    .prepare("SELECT topic_id, topic_url, last_message_ts FROM kb_threads WHERE channel = ? AND thread_ts = ?")
    .get(channel, threadTs) as any;
  if (!row) return null;
  return {
    topicId: Number(row.topic_id),
    topicUrl: String(row.topic_url),
    lastMessageTs: String(row.last_message_ts),
  };
}

export async function deleteMappingsByTopicId(topicId: number): Promise<void> {
  getDb().prepare("DELETE FROM kb_threads WHERE topic_id = ?").run(topicId);
}

// Used only for the "brand new thread" path — a plain INSERT (no ON
// CONFLICT) so that a lost race (two triggers both saw no existing mapping,
// both created a Discourse topic) surfaces as a thrown constraint error
// instead of one silently overwriting the other's topic_id.
export async function insertNewMapping(
  channel: string,
  threadTs: string,
  topicId: number,
  topicUrl: string,
  lastMessageTs: string
): Promise<void> {
  getDb()
    .prepare("INSERT INTO kb_threads (channel, thread_ts, topic_id, topic_url, last_message_ts) VALUES (?, ?, ?, ?, ?)")
    .run(channel, threadTs, topicId, topicUrl, lastMessageTs);
}

// Used for the "append to a known existing topic" path, where a mapping is
// already known to exist and we're just advancing last_message_ts.
export async function updateMapping(
  channel: string,
  threadTs: string,
  topicId: number,
  topicUrl: string,
  lastMessageTs: string
): Promise<void> {
  getDb()
    .prepare(
      `
      INSERT INTO kb_threads (channel, thread_ts, topic_id, topic_url, last_message_ts)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (channel, thread_ts)
      DO UPDATE SET topic_id = excluded.topic_id, topic_url = excluded.topic_url, last_message_ts = excluded.last_message_ts
      `
    )
    .run(channel, threadTs, topicId, topicUrl, lastMessageTs);
}
