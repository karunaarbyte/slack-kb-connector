import type { Request, Response, RequestHandler } from "express";

// Express doesn't forward a rejected promise from an async handler to its
// error handling — an uncaught throw (e.g. JSON.parse on a malformed
// payload) before the handler calls res.status(...) just leaves the request
// hanging until Slack's own client-side timeout. This ensures every request
// gets a response no matter what the handler does.
export function asyncHandler(
  handler: (req: Request, res: Response) => Promise<void>
): RequestHandler {
  return (req, res) => {
    handler(req, res).catch((err) => {
      console.error("kb-connector: unhandled error in request handler —", err);
      if (!res.headersSent) {
        res.status(500).send("internal error");
      }
    });
  };
}
