import * as fileKb from "../fileKb";
import type { KbStore } from "./index";

export const fileStore: KbStore = {
  async getExisting(channel, threadTs) {
    return fileKb.findEntry(channel, threadTs);
  },

  async getLastMessageTs(channel, threadTs) {
    return fileKb.findEntry(channel, threadTs)?.lastMessageTs;
  },

  async createEntry(channel, threadTs, title, bodyMarkdown, lastMessageTs, permalink) {
    const filePath = fileKb.saveSummary(channel, threadTs, title, bodyMarkdown, lastMessageTs, permalink);
    console.log(`kb-connector: saved locally — ${filePath}`);
    return { message: `Discourse posting is off. Summary saved to ${filePath}` };
  },

  async appendEntry(_existing, channel, threadTs, additionMarkdown, newLastMessageTs) {
    const filePath = fileKb.appendUpdate(channel, threadTs, additionMarkdown, newLastMessageTs);
    console.log(`kb-connector: appended update locally — ${filePath}`);
    return { message: `Discourse posting is off. Update appended to ${filePath}` };
  },
};
