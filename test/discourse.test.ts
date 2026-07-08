import { describe, it, expect } from "vitest";
import { isNotFoundError } from "../src/services/discourse";

describe("isNotFoundError", () => {
  it("recognizes a 404 axios-shaped error", () => {
    expect(isNotFoundError({ response: { status: 404 } })).toBe(true);
  });

  it("rejects other status codes", () => {
    expect(isNotFoundError({ response: { status: 500 } })).toBe(false);
    expect(isNotFoundError({ response: { status: 403 } })).toBe(false);
  });

  it("rejects errors with no response (network failure, etc.)", () => {
    expect(isNotFoundError(new Error("network down"))).toBe(false);
    expect(isNotFoundError(undefined)).toBe(false);
    expect(isNotFoundError(null)).toBe(false);
  });
});
