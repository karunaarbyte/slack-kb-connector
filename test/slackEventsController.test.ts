import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/utils/verifySlackSignature", () => ({
  verifySlackRequest: vi.fn(),
}));
vi.mock("../src/services/kbSummary", () => ({
  runKbSummary: vi.fn(),
  getNewThreadAttachments: vi.fn(),
}));
vi.mock("../src/services/slack", () => ({
  postMessage: vi.fn(),
}));

import { verifySlackRequest } from "../src/utils/verifySlackSignature";
import { runKbSummary, getNewThreadAttachments } from "../src/services/kbSummary";
import * as slack from "../src/services/slack";
import { handleSlackEvent } from "../src/controllers/slackEventsController";

function fakeRes() {
  const res: any = {
    status: vi.fn(function (this: any, code: number) {
      res.statusCode = code;
      return res;
    }),
    json: vi.fn(),
  };
  return res;
}

function fakeReq(payload: unknown) {
  return { body: Buffer.from(JSON.stringify(payload)) } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(verifySlackRequest).mockImplementation((req: any) => req.body.toString("utf8"));
  vi.mocked(getNewThreadAttachments).mockResolvedValue({ messages: [], images: [], files: [] } as any);
});

describe("handleSlackEvent", () => {
  it("rejects an invalid signature with 401", async () => {
    vi.mocked(verifySlackRequest).mockReturnValue(null);
    const res = fakeRes();
    await handleSlackEvent(fakeReq({ type: "event_callback" }), res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(runKbSummary).not.toHaveBeenCalled();
  });

  it("echoes the challenge on url_verification", async () => {
    const res = fakeRes();
    await handleSlackEvent(fakeReq({ type: "url_verification", challenge: "abc123" }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ challenge: "abc123" });
    expect(runKbSummary).not.toHaveBeenCalled();
  });

  it("ignores bot-authored messages", async () => {
    const res = fakeRes();
    await handleSlackEvent(
      fakeReq({
        type: "event_callback",
        event_id: "ev1",
        event: { type: "message", channel: "C1", thread_ts: "100", ts: "200", text: "kb!", bot_id: "B1" },
      }),
      res
    );
    expect(runKbSummary).not.toHaveBeenCalled();
  });

  it("ignores message edits/subtypes", async () => {
    const res = fakeRes();
    await handleSlackEvent(
      fakeReq({
        type: "event_callback",
        event_id: "ev2",
        event: { type: "message", channel: "C1", thread_ts: "100", ts: "200", text: "kb!", subtype: "message_changed" },
      }),
      res
    );
    expect(runKbSummary).not.toHaveBeenCalled();
  });

  it("ignores a message that isn't a thread reply", async () => {
    const res = fakeRes();
    await handleSlackEvent(
      fakeReq({
        type: "event_callback",
        event_id: "ev3",
        event: { type: "message", channel: "C1", ts: "200", text: "kb!" },
      }),
      res
    );
    expect(runKbSummary).not.toHaveBeenCalled();
  });

  it("ignores the thread's own parent message (thread_ts === ts)", async () => {
    const res = fakeRes();
    await handleSlackEvent(
      fakeReq({
        type: "event_callback",
        event_id: "ev4",
        event: { type: "message", channel: "C1", thread_ts: "200", ts: "200", text: "kb!" },
      }),
      res
    );
    expect(runKbSummary).not.toHaveBeenCalled();
  });

  it("ignores thread replies that don't match the trigger text", async () => {
    const res = fakeRes();
    await handleSlackEvent(
      fakeReq({
        type: "event_callback",
        event_id: "ev5",
        event: { type: "message", channel: "C1", thread_ts: "100", ts: "200", text: "not it" },
      }),
      res
    );
    expect(runKbSummary).not.toHaveBeenCalled();
  });

  it("runs the summary on a matching trigger with no attachments", async () => {
    const res = fakeRes();
    await handleSlackEvent(
      fakeReq({
        type: "event_callback",
        event_id: "ev6",
        event: { type: "message", channel: "C1", thread_ts: "100", ts: "200", text: "kb!" },
      }),
      res
    );
    expect(runKbSummary).toHaveBeenCalledWith("C1", "100", { messages: [] });
    expect(slack.postMessage).not.toHaveBeenCalled();
  });

  it("posts an attachment-choice prompt instead of summarizing when the thread has attachments", async () => {
    vi.mocked(getNewThreadAttachments).mockResolvedValue({ messages: [], images: [{ id: "F1" }], files: [] } as any);
    const res = fakeRes();
    await handleSlackEvent(
      fakeReq({
        type: "event_callback",
        event_id: "ev7",
        event: { type: "message", channel: "C1", thread_ts: "100", ts: "200", text: "kb!" },
      }),
      res
    );
    expect(slack.postMessage).toHaveBeenCalled();
    expect(runKbSummary).not.toHaveBeenCalled();
  });

  it("dedupes retried events by event_id", async () => {
    const event = { type: "message", channel: "C1", thread_ts: "100", ts: "200", text: "kb!" };
    const res1 = fakeRes();
    await handleSlackEvent(fakeReq({ type: "event_callback", event_id: "dup1", event }), res1);
    expect(runKbSummary).toHaveBeenCalledTimes(1);

    const res2 = fakeRes();
    await handleSlackEvent(fakeReq({ type: "event_callback", event_id: "dup1", event }), res2);
    expect(runKbSummary).toHaveBeenCalledTimes(1);
    expect(res2.status).toHaveBeenCalledWith(200);
  });
});
