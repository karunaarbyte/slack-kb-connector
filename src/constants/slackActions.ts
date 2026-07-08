// Slack interactivity callback/action IDs, shared across controllers and
// the block-building code that constructs the buttons/modals using them.
// Kept in one place so no controller has to import from another controller
// just to get a string constant.

// Callback ID configured on the "Summarize to KB" message shortcut in the
// Slack app config (Interactivity & Shortcuts).
export const SUMMARIZE_SHORTCUT_CALLBACK_ID = "kb_summarize";

// Callback ID for the "which attachments to post?" modal, shown only when
// the thread has images/files.
export const ATTACHMENT_MODAL_CALLBACK_ID = "kb_attachment_choice";

// Action ID for the "Choose attachments…" button posted by the "kb!" text
// trigger. The Events API gives us no trigger_id, so that path can't open a
// modal directly — it posts this button instead, and the button click's
// trigger_id is what opens the modal.
export const CHOOSE_ATTACHMENTS_ACTION = "kb_choose_attachments";

// Action ID for the "No attachments" button posted alongside
// CHOOSE_ATTACHMENTS_ACTION by the "kb!" text trigger — skips the modal
// entirely and summarizes with no attachments.
export const NO_ATTACHMENTS_ACTION = "kb_no_attachments";

// Action ID for the "Summarize Anyway" button. Reused for both "archive
// this new thread anyway" and "append this update anyway" — runKbSummary
// figures out which case applies at runtime.
export const FORCE_SUMMARIZE_ACTION = "kb_force_summarize";
