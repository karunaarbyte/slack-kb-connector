import crypto from "crypto";
import { describe, it, expect } from "vitest";
import { verifySlackSignature } from "../src/utils/verifySlackSignature";
import config from "../src/config";

function sign(rawBody: string, timestamp: string): string {
  const base = `v0:${timestamp}:${rawBody}`;
  const hmac = crypto.createHmac("sha256", config.slackSigningSecret);
  hmac.update(base, "utf8");
  return `v0=${hmac.digest("hex")}`;
}

describe("verifySlackSignature", () => {
  it("accepts a correctly signed, fresh request", () => {
    const rawBody = '{"type":"test"}';
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = sign(rawBody, timestamp);
    expect(verifySlackSignature(rawBody, timestamp, signature)).toBe(true);
  });

  it("rejects a wrong signature", () => {
    const rawBody = '{"type":"test"}';
    const timestamp = String(Math.floor(Date.now() / 1000));
    expect(verifySlackSignature(rawBody, timestamp, "v0=deadbeef")).toBe(false);
  });

  it("rejects a signature computed over a different body (tampered payload)", () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = sign('{"original":true}', timestamp);
    expect(verifySlackSignature('{"tampered":true}', timestamp, signature)).toBe(false);
  });

  it("rejects a request older than 5 minutes (replay protection)", () => {
    const rawBody = '{"type":"test"}';
    const oldTimestamp = String(Math.floor(Date.now() / 1000) - 301);
    const signature = sign(rawBody, oldTimestamp);
    expect(verifySlackSignature(rawBody, oldTimestamp, signature)).toBe(false);
  });

  it("rejects a missing timestamp or signature", () => {
    expect(verifySlackSignature("body", undefined, "v0=abc")).toBe(false);
    expect(verifySlackSignature("body", "12345", undefined)).toBe(false);
  });

  it("rejects a non-numeric timestamp", () => {
    const rawBody = "body";
    expect(verifySlackSignature(rawBody, "not-a-number", "v0=abc")).toBe(false);
  });
});
