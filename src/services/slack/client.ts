import { WebClient } from "@slack/web-api";
import config from "../../config";

// The one shared WebClient instance for this service — other modules in
// this folder import it directly rather than going through the barrel, so
// nothing outside src/services/slack needs (or gets) raw client access.
export const client = new WebClient(config.slackBotToken);
