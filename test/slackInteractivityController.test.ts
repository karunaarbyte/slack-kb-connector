import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/utils/verifySlackSignature", () => ({
  verifySlackRequest: vi.fn(),
}));
vi.mock("../src/services/kbSummary", () => ({
  runKbSummary: vi.fn(),
  getNewThreadAttachments: vi.fn(),
}));
vi.mock("../src/services/slack", () => ({
  openModal: vi.fn(),
  updateMessage: vi.fn(),
  deleteMessage: vi.fn(),
}));

import { verifySlackRequest } from "../src/utils/verifySlackSignature";
import { runKbSummary } from "../src/services/kbSummary";
import * as slack from "../src/services/slack";
import { handleSlackInteractivity } from "../src/controllers/slackInteractivityController";
import {
  SUMMARIZE_SHORTCUT_CALLBACK_ID,
  ATTACHMENT_MODAL_CALLBACK_ID,
  CHOOSE_ATTACHMENTS_ACTION,
  NO_ATTACHMENTS_ACTION,
  FORCE_SUMMARIZE_ACTION,
} from "../src/constants/slackActions";

function fakeRes() {
  const res: any = {
    status: vi.fn(function (this: any, code: number) {
      res.statusCode = code;
      return res;
    }),
    send: vi.fn(),
  };
  return res;
}

function fakeReq(payload: unknown) {
  return {
    body: Buffer.from(`payload=${encodeURIComponent(JSON.stringify(payload))}`),
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(verifySlackRequest).mockImplementation((req: any) => req.body.toString("utf8"));
  vi.mocked(slack.updateMessage).mockResolvedValue(undefined as any);
  vi.mocked(slack.deleteMessage).mockResolvedValue(undefined as any);
});

describe("handleSlackInteractivity", () => {
  it("rejects an invalid signature with 401", async () => {
    vi.mocked(verifySlackRequest).mockReturnValue(null);
    const res = fakeRes();
    await handleSlackInteractivity(fakeReq({ type: "block_actions" }), res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(runKbSummary).not.toHaveBeenCalled();
  });

  it("opens the attachment modal on CHOOSE_ATTACHMENTS_ACTION", async () => {
    const res = fakeRes();
    await handleSlackInteractivity(
      fakeReq({
        type: "block_actions",
        trigger_id: "trig1",
        actions: [{ action_id: CHOOSE_ATTACHMENTS_ACTION, value: JSON.stringify({ channel: "C1", threadTs: "111" }) }],
      }),
      res
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(slack.openModal).toHaveBeenCalledWith("trig1", expect.objectContaining({ callback_id: ATTACHMENT_MODAL_CALLBACK_ID }));
    expect(runKbSummary).not.toHaveBeenCalled();
  });

  it("summarizes with no attachments on NO_ATTACHMENTS_ACTION", async () => {
    const res = fakeRes();
    await handleSlackInteractivity(
      fakeReq({
        type: "block_actions",
        container: { message_ts: "222" },
        actions: [{ action_id: NO_ATTACHMENTS_ACTION, value: JSON.stringify({ channel: "C1", threadTs: "111" }) }],
      }),
      res
    );
    expect(slack.updateMessage).toHaveBeenCalled();
    expect(runKbSummary).toHaveBeenCalledWith("C1", "111", {});
    expect(slack.deleteMessage).toHaveBeenCalledWith("C1", "222");
  });

  it("force-summarizes and forwards the attachment choice on FORCE_SUMMARIZE_ACTION", async () => {
    const res = fakeRes();
    await handleSlackInteractivity(
      fakeReq({
        type: "block_actions",
        container: { message_ts: "222" },
        actions: [
          {
            action_id: FORCE_SUMMARIZE_ACTION,
            value: JSON.stringify({ channel: "C1", threadTs: "111", attachments: { images: true, files: false } }),
          },
        ],
      }),
      res
    );
    expect(runKbSummary).toHaveBeenCalledWith("C1", "111", {
      force: true,
      attachments: { images: true, files: false },
    });
  });

  it("no-ops on an unrecognized block action", async () => {
    const res = fakeRes();
    await handleSlackInteractivity(
      fakeReq({ type: "block_actions", actions: [{ action_id: "something_else" }] }),
      res
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(runKbSummary).not.toHaveBeenCalled();
    expect(slack.openModal).not.toHaveBeenCalled();
  });

  it("summarizes with the submitted attachment choice on modal submission", async () => {
    const res = fakeRes();
    await handleSlackInteractivity(
      fakeReq({
        type: "view_submission",
        view: {
          callback_id: ATTACHMENT_MODAL_CALLBACK_ID,
          private_metadata: JSON.stringify({ channel: "C1", threadTs: "111", messageTs: "222" }),
          state: { values: { attachments: { choice: { selected_options: [{ value: "images" }] } } } },
        },
      }),
      res
    );
    expect(runKbSummary).toHaveBeenCalledWith("C1", "111", { attachments: { images: true, files: false } });
  });

  it("no-ops on a view_submission with an unrecognized callback_id", async () => {
    const res = fakeRes();
    await handleSlackInteractivity(
      fakeReq({ type: "view_submission", view: { callback_id: "some_other_modal" } }),
      res
    );
    expect(runKbSummary).not.toHaveBeenCalled();
  });

  it("summarizes directly on a message shortcut with no attachments", async () => {
    vi.mocked((await import("../src/services/kbSummary")).getNewThreadAttachments).mockResolvedValue({
      messages: [{ ts: "1" }, { ts: "2" }] as any,
      images: [],
      files: [],
    });
    const res = fakeRes();
    await handleSlackInteractivity(
      fakeReq({
        type: "message_action",
        callback_id: SUMMARIZE_SHORTCUT_CALLBACK_ID,
        channel: { id: "C1" },
        message: { ts: "111" },
      }),
      res
    );
    expect(runKbSummary).toHaveBeenCalledWith("C1", "111", { messages: expect.any(Array) });
    expect(slack.openModal).not.toHaveBeenCalled();
  });

  it("opens the attachment modal instead of summarizing when the shortcut's thread has attachments", async () => {
    vi.mocked((await import("../src/services/kbSummary")).getNewThreadAttachments).mockResolvedValue({
      messages: [],
      images: [{ id: "F1" }] as any,
      files: [],
    });
    const res = fakeRes();
    await handleSlackInteractivity(
      fakeReq({
        type: "message_action",
        callback_id: SUMMARIZE_SHORTCUT_CALLBACK_ID,
        channel: { id: "C1" },
        message: { ts: "111" },
        trigger_id: "trig1",
      }),
      res
    );
    expect(slack.openModal).toHaveBeenCalled();
    expect(runKbSummary).not.toHaveBeenCalled();
  });

  it("no-ops on a message shortcut missing channel/thread", async () => {
    const res = fakeRes();
    await handleSlackInteractivity(
      fakeReq({ type: "message_action", callback_id: SUMMARIZE_SHORTCUT_CALLBACK_ID, message: {} }),
      res
    );
    expect(runKbSummary).not.toHaveBeenCalled();
  });

  it("no-ops on an unrecognized payload type", async () => {
    const res = fakeRes();
    await handleSlackInteractivity(fakeReq({ type: "shortcut" }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(runKbSummary).not.toHaveBeenCalled();
  });
});
