import { client } from "./client";

// Thin wrapper so callers (slackInteractivity.ts) don't need raw WebClient
// access just to open a modal from a trigger_id.
export async function openModal(triggerId: string, view: any): Promise<void> {
  await client.views.open({ trigger_id: triggerId, view });
}
