import { createClient, type Client } from "@libsql/client";
import config from "../config";

// Constructed lazily, on first actual use, rather than at module load — this
// module is imported unconditionally by kbSummary.ts, but in fallback (file)
// mode config.tursoDatabaseUrl/tursoAuthToken are empty strings, and
// createClient() throws synchronously on an invalid URL. Building it eagerly
// at import time would crash fallback mode even though it never calls any
// function in this file.
let _client: Client | null = null;
function getClient(): Client {
  if (!_client) {
    _client = createClient({ url: config.tursoDatabaseUrl, authToken: config.tursoAuthToken });
  }
  return _client;
}

const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS kb_threads (
    channel TEXT NOT NULL,
    thread_ts TEXT NOT NULL,
    topic_id INTEGER NOT NULL,
    topic_url TEXT NOT NULL,
    last_message_ts TEXT NOT NULL,
    PRIMARY KEY (channel, thread_ts)
  )
`;

// Memoized only on success — a transient failure (Turso unreachable, bad
// token) clears the cache so the next call retries instead of every future
// call failing forever off one stale rejection.
let schemaReady: Promise<void> | null = null;
function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = getClient()
      .execute(CREATE_TABLE_SQL)
      .then(() => undefined)
      .catch((err) => {
        schemaReady = null;
        throw err;
      });
  }
  return schemaReady;
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
  await ensureSchema();
  const resp = await getClient().execute({
    sql: "SELECT topic_id, topic_url, last_message_ts FROM kb_threads WHERE channel = ? AND thread_ts = ?",
    args: [channel, threadTs],
  });
  const row = resp.rows[0];
  if (!row) return null;
  return {
    topicId: Number(row.topic_id),
    topicUrl: String(row.topic_url),
    lastMessageTs: String(row.last_message_ts),
  };
}

export async function deleteMappingsByTopicId(topicId: number): Promise<void> {
  await ensureSchema();
  await getClient().execute({
    sql: "DELETE FROM kb_threads WHERE topic_id = ?",
    args: [topicId],
  });
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
  await ensureSchema();
  await getClient().execute({
    sql: "INSERT INTO kb_threads (channel, thread_ts, topic_id, topic_url, last_message_ts) VALUES (?, ?, ?, ?, ?)",
    args: [channel, threadTs, topicId, topicUrl, lastMessageTs],
  });
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
  await ensureSchema();
  await getClient().execute({
    sql: `
      INSERT INTO kb_threads (channel, thread_ts, topic_id, topic_url, last_message_ts)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (channel, thread_ts)
      DO UPDATE SET topic_id = excluded.topic_id, topic_url = excluded.topic_url, last_message_ts = excluded.last_message_ts
    `,
    args: [channel, threadTs, topicId, topicUrl, lastMessageTs],
  });
}
