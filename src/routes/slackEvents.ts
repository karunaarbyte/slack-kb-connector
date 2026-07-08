import express from "express";
import { handleSlackEvent } from "../controllers/slackEventsController";
import { asyncHandler } from "../utils/asyncHandler";

const router = express.Router();

router.post("/slack/events", express.raw({ type: "*/*" }), asyncHandler(handleSlackEvent));

export default router;
