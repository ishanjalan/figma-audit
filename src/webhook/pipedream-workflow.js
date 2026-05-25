/**
 * Pipedream workflow — Figma webhook (v2) → GitHub Actions relay.
 *
 * Paste this into a Pipedream "Run Node.js code" step.
 * See README › Webhook setup for full instructions.
 *
 * Environment variables to set in Pipedream (Settings → Environment Variables):
 *   FIGMA_WEBHOOK_PASSCODE   — random string, same value as in your .env
 *   GITHUB_TOKEN             — classic PAT with repo scope
 *   GITHUB_REPO              — e.g. "yourorg/figma-audit"
 *
 * Deduplication: each unique file_key is dispatched at most once per 5 minutes.
 * Figma auto-saves every ~30s, so without this every open file would burn
 * ~120 Pipedream credits/hour per designer.
 */

// In-memory dedup map: file_key → timestamp of last dispatch.
// Pipedream keeps the worker warm between invocations, so this persists
// for the lifetime of the worker (typically several minutes).
const lastDispatched = globalThis._figmaLastDispatched ??= new Map();
const DEDUP_MS = 5 * 60 * 1000; // 5 minutes

export default defineComponent({
  async run({ steps, $ }) {
    const body = steps.trigger.event.body ?? {};

    // Figma v2 webhooks echo back the passcode we registered with.
    if (body.passcode !== process.env.FIGMA_WEBHOOK_PASSCODE) {
      return $.flow.exit('Invalid passcode — ignoring');
    }

    // Figma sends a PING on registration to verify the endpoint is reachable.
    if (body.event_type === 'PING') {
      return 'PING acknowledged';
    }

    // Only act on file saves.
    if (body.event_type !== 'FILE_UPDATE' || !body.file_key) {
      return $.flow.exit(`Ignored event: ${body.event_type}`);
    }

    // Deduplicate: skip if we already dispatched for this file recently.
    const now = Date.now();
    const last = lastDispatched.get(body.file_key) ?? 0;
    if (now - last < DEDUP_MS) {
      return $.flow.exit(`Skipped — already dispatched ${body.file_key} ${Math.round((now - last) / 1000)}s ago`);
    }
    lastDispatched.set(body.file_key, now);

    // Trigger the handover-file.yml workflow for just this one file.
    const res = await fetch(
      `https://api.github.com/repos/${process.env.GITHUB_REPO}/dispatches`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        body: JSON.stringify({
          event_type: 'figma-file-update',
          client_payload: {
            file_key: body.file_key,
            file_name: body.file_name ?? body.file_key,
          },
        }),
      },
    );

    if (!res.ok) {
      throw new Error(`GitHub dispatch failed ${res.status}: ${await res.text()}`);
    }

    return `Dispatched audit for ${body.file_name ?? body.file_key}`;
  },
});
