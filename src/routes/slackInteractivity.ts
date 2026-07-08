import express from "express";
import { handleSlackInteractivity } from "../controllers/slackInteractivityController";
import { asyncHandler } from "../utils/asyncHandler";

const router = express.Router();

router.post(
  "/slack/interactivity",
  express.raw({ type: "application/x-www-form-urlencoded" }),
  asyncHandler(handleSlackInteractivity)
);

export default router;
