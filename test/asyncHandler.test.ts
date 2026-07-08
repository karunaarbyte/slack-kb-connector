import { describe, it, expect, vi } from "vitest";
import { asyncHandler } from "../src/utils/asyncHandler";

function fakeRes() {
  const res: any = {
    headersSent: false,
    status: vi.fn(function (this: any) {
      return this;
    }),
    send: vi.fn(),
  };
  res.status.mockImplementation((code: number) => {
    res.statusCode = code;
    return res;
  });
  return res;
}

describe("asyncHandler", () => {
  it("does nothing extra when the handler succeeds", async () => {
    const res = fakeRes();
    const handler = asyncHandler(async (_req, r) => {
      r.status(200).send("ok");
    });

    handler({} as any, res, (() => {}) as any);
    await new Promise((r) => setImmediate(r));

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith("ok");
  });

  it("responds 500 if the handler throws before sending a response", async () => {
    const res = fakeRes();
    const handler = asyncHandler(async () => {
      throw new Error("boom");
    });

    handler({} as any, res, (() => {}) as any);
    await new Promise((r) => setImmediate(r));

    expect(res.status).toHaveBeenCalledWith(500);
  });

  it("does not try to send again if the handler already sent a response before throwing", async () => {
    const res = fakeRes();
    const handler = asyncHandler(async (_req, r) => {
      r.status(200).send("ok");
      r.headersSent = true;
      throw new Error("boom, but after ack");
    });

    handler({} as any, res, (() => {}) as any);
    await new Promise((r) => setImmediate(r));

    expect(res.status).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(200);
  });
});
