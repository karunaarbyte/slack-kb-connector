import config from "../../config";
import { discourseStore } from "./discourseStore";
import { fileStore } from "./fileStore";

// A KB entry already archived for a thread — the state needed to append to
// it. topicId is Discourse-specific (undefined in file-store mode); callers
// that need it (discourseStore.appendEntry) assert it's present rather than
// branching on which store is active.
export interface KbEntry {
  previousBody: string;
  lastMessageTs: string;
  topicId?: number;
}

// Abstracts "where does a KB article live" — Discourse or the local
// markdown-file fallback — so kbSummary's orchestration never branches on
// config.discourseEnabled itself. Adding a third backend means implementing
// this interface once, not editing the orchestrator in multiple places.
export interface KbStore {
  getExisting(channel: string, threadTs: string): Promise<KbEntry | null>;
  getLastMessageTs(channel: string, threadTs: string): Promise<string | undefined>;
  createEntry(
    channel: string,
    threadTs: string,
    title: string,
    bodyMarkdown: string,
    lastMessageTs: string,
    permalink: string
  ): Promise<{ message: string }>;
  appendEntry(
    existing: KbEntry,
    channel: string,
    threadTs: string,
    additionMarkdown: string,
    newLastMessageTs: string
  ): Promise<{ message: string }>;
}

// Chosen once, at module load — the rest of the app depends only on the
// KbStore interface, never on config.discourseEnabled directly.
export const kbStore: KbStore = config.discourseEnabled ? discourseStore : fileStore;
