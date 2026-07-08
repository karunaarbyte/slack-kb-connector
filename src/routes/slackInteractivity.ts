import express from "express";
import { handleSlackInteractivity } from "../controllers/slackInteractivityController";

const router = express.Router();

router.post(
  "/slack/interactivity",
  express.raw({ type: "application/x-www-form-urlencoded" }),
  handleSlackInteractivity
);

export default router;
