import { FORCE_SUMMARIZE_ACTION } from "../../constants/slackActions";
import type { AttachmentChoice } from "./attachments";

// Block Kit for the "this thread wasn't judged sufficient — force it
// through anyway?" notice, posted by both runNewThread and runUpdate.
export function forceButtonBlocks(
  notice: string,
  channel: string,
  threadTs: string,
  attachments?: AttachmentChoice
) {
  return [
    { type: "section", text: { type: "mrkdwn", text: notice } },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "✅ Summarize Anyway", emoji: true },
          style: "primary",
          action_id: FORCE_SUMMARIZE_ACTION,
          // Carries the attachment choice forward so re-triggering via this
          // button doesn't reprompt the user for it.
          value: JSON.stringify({ channel, threadTs, attachments }),
        },
      ],
    },
  ];
}
