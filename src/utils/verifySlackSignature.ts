import crypto from "crypto";
import type { Request } from "express";
import config from "../config";

// Verifies the x-slack-signature header per Slack's signing secret spec.
// rawBody must be the exact, unparsed request body string.
export function verifySlackSignature(
  rawBody: string,
  timestamp: string | undefined,
  signature: string | undefined
): boolean {
  if (!timestamp || !signature) return false;

  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (age > 300) return false; // reject requests older than 5 minutes (replay protection)

  const base = `v0:${timestamp}:${rawBody}`;
  const hmac = crypto.createHmac("sha256", config.slackSigningSecret);
  hmac.update(base, "utf8");
  const computed = `v0=${hmac.digest("hex")}`;

  const a = Buffer.from(computed, "utf8");
  const b = Buffer.from(signature, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// Extracts the raw body from a request whose body was parsed with
// express.raw(), verifies the Slack signature, and returns the raw body
// string on success or null on failure — used by every /slack/* route.
export function verifySlackRequest(req: Request): string | null {
  const rawBody = (req.body as Buffer).toString("utf8");
  const timestamp = req.get("x-slack-request-timestamp");
  const signature = req.get("x-slack-signature");
  if (!verifySlackSignature(rawBody, timestamp, signature)) return null;
  return rawBody;
}
