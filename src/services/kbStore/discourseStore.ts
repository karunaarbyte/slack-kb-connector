import * as discourse from "../discourse";
import * as db from "../db";
import type { KbStore } from "./index";

export const discourseStore: KbStore = {
  async getExisting(channel, threadTs) {
    const mapping = await db.getThreadMapping(channel, threadTs);
    if (!mapping) return null;

    try {
      const previousBody = await discourse.getTopicBody(mapping.topicId);
      return { previousBody, lastMessageTs: mapping.lastMessageTs, topicId: mapping.topicId };
    } catch (err) {
      // The mapped topic is gone (deleted outside `yarn delete-topics`, e.g.
      // via the Discourse UI directly) — the mapping is stale. Self-heal by
      // dropping it and reporting "no existing entry" so the caller falls
      // through to create a fresh topic, rather than failing this and every
      // future trigger on the thread until someone manually cleans up the DB.
      if (!discourse.isNotFoundError(err)) throw err;
      console.warn(
        `kb-connector: mapped topic ${mapping.topicId} no longer exists, dropping stale mapping`
      );
      await db.deleteMappingsByTopicId(mapping.topicId);
      return null;
    }
  },

  async getLastMessageTs(channel, threadTs) {
    const mapping = await db.getThreadMapping(channel, threadTs);
    return mapping?.lastMessageTs;
  },

  async createEntry(channel, threadTs, title, bodyMarkdown, lastMessageTs, permalink) {
    const { topicId, topicUrl } = await discourse.createTopic(
      title,
      bodyMarkdown,
      channel,
      threadTs,
      lastMessageTs,
      permalink
    );
    await db.insertNewMapping(channel, threadTs, topicId, topicUrl, lastMessageTs);
    console.log(`kb-connector: posted to Discourse — ${topicUrl}`);
    return { message: `Posted to KB: ${topicUrl}` };
  },

  async appendEntry(existing, channel, threadTs, additionMarkdown, newLastMessageTs) {
    if (existing.topicId === undefined) {
      throw new Error("expected existing.topicId to be set in Discourse mode");
    }
    const topicUrl = await discourse.createReply(
      existing.topicId,
      additionMarkdown,
      channel,
      threadTs,
      newLastMessageTs
    );
    await db.updateMapping(channel, threadTs, existing.topicId, topicUrl, newLastMessageTs);
    console.log(`kb-connector: appended reply to Discourse — ${topicUrl}`);
    return { message: `Added to existing KB topic: ${topicUrl}` };
  },
};
