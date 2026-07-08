import { describe, it, expect } from "vitest";
import { forceButtonBlocks } from "../src/services/kbSummary/blocks";
import { FORCE_SUMMARIZE_ACTION } from "../src/constants/slackActions";

describe("forceButtonBlocks", () => {
  it("embeds the channel/threadTs (and no attachments) in the button value", () => {
    const blocks = forceButtonBlocks("some notice", "C123", "111.222");
    const button = (blocks[1] as any).elements[0];

    expect(button.action_id).toBe(FORCE_SUMMARIZE_ACTION);
    expect(JSON.parse(button.value)).toEqual({
      channel: "C123",
      threadTs: "111.222",
      attachments: undefined,
    });
  });

  it("carries the attachment choice forward so a later click doesn't reprompt", () => {
    const blocks = forceButtonBlocks("notice", "C123", "111.222", { images: true, files: false });
    const button = (blocks[1] as any).elements[0];

    expect(JSON.parse(button.value)).toEqual({
      channel: "C123",
      threadTs: "111.222",
      attachments: { images: true, files: false },
    });
  });

  it("renders the notice text in the leading section block", () => {
    const blocks = forceButtonBlocks("Keep discussing?", "C1", "1.1");
    expect((blocks[0] as any).text.text).toBe("Keep discussing?");
  });
});
