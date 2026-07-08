import express from "express";
import { handleSlackEvent } from "../controllers/slackEventsController";

const router = express.Router();

router.post("/slack/events", express.raw({ type: "*/*" }), handleSlackEvent);

export default router;
