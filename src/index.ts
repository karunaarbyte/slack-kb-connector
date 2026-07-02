import express from "express";
import config from "./config";
import slackEvents from "./routes/slackEvents";
import slackInteractivity from "./routes/slackInteractivity";

const app = express();

app.get("/health", (req, res) => res.json({ ok: true }));

app.use(slackEvents);
app.use(slackInteractivity);

app.listen(config.port, () => {
  console.log(`slack-kb-connector listening on :${config.port}`);
});
