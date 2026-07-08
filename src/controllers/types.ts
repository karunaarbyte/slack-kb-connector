// The subset of Slack's interactivity payload shapes this codebase actually
// reads. Slack's own payloads are much larger (this is what @slack/bolt
// models in full) — these interfaces only cover the fields destructured in
// slackInteractivityController.ts, discriminated on `type` so narrowing an
// `if (payload.type === "block_actions")` check actually types the rest of
// that branch instead of leaving it as `any`.

export interface SlackInteractionAction {
  action_id: string;
  value?: string;
}

export interface BlockActionsPayload {
  type: "block_actions";
  actions?: SlackInteractionAction[];
  trigger_id?: string;
  container?: { message_ts?: string };
  message?: { ts?: string };
}

export interface ViewSubmissionPayload {
  type: "view_submission";
  view: {
    callback_id?: string;
    private_metadata?: string;
    state?: {
      values?: Record<string, Record<string, { selected_options?: { value: string }[] }>>;
    };
  };
}

export interface MessageActionPayload {
  type: "message_action";
  callback_id?: string;
  channel?: { id?: string };
  message?: { ts?: string; thread_ts?: string };
  trigger_id?: string;
}

// Only the three interaction types this app handles are modeled — Slack can
// send others (e.g. shortcut invocations outside a message), but those never
// reach the checks below since each one narrows on a specific `type` literal
// and returns early otherwise.
export type InteractivityPayload = BlockActionsPayload | ViewSubmissionPayload | MessageActionPayload;

// Events API payload shapes handled by slackEventsController.ts.
export interface UrlVerificationPayload {
  type: "url_verification";
  challenge: string;
}

export interface MessageEvent {
  type: "message";
  channel: string;
  thread_ts?: string;
  ts: string;
  text?: string;
  bot_id?: string;
  subtype?: string;
}

export interface EventCallbackPayload {
  type: "event_callback";
  event_id?: string;
  // Slack sends many event types (reaction_added, channel_created, ...) —
  // modeled loosely here since only "message" is ever handled. isMessageEvent
  // below is the real narrowing tool; a plain `event.type === "message"`
  // check can't narrow this on its own because this member's `type` is a
  // generic `string`, not a literal.
  event: { type: string; [key: string]: unknown };
}

export type SlackEventsPayload = UrlVerificationPayload | EventCallbackPayload;

export function isMessageEvent(event: { type: string }): event is MessageEvent {
  return event.type === "message";
}
