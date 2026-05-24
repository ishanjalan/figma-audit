/**
 * Registers (or lists/deletes) the Figma FILE_UPDATE webhook for a team.
 *
 * Usage:
 *   npm run webhook:register   # register for all FIGMA_HANDOVER_TEAM_IDS
 *   npm run webhook:list       # list active webhooks
 *   npm run webhook:delete     # delete all webhooks registered by this tool
 *
 * Required env vars (add to .env):
 *   FIGMA_TOKEN                 — plan access token (figp_…)
 *   FIGMA_HANDOVER_TEAM_IDS     — comma-separated team IDs to watch
 *   FIGMA_WEBHOOK_ENDPOINT      — your Pipedream HTTP trigger URL
 *   FIGMA_WEBHOOK_PASSCODE      — same random string you set in Pipedream's env
 */

import { parseArgs } from 'node:util';

const BASE = 'https://api.figma.com/v1';

const token = process.env.FIGMA_TOKEN;
const rawTeamIds = process.env.FIGMA_HANDOVER_TEAM_IDS;
const endpoint = process.env.FIGMA_WEBHOOK_ENDPOINT;
const passcode = process.env.FIGMA_WEBHOOK_PASSCODE;

if (!token) { console.error('FIGMA_TOKEN required'); process.exit(1); }

const { values } = parseArgs({ options: { action: { type: 'string', default: 'register' } } });
const action = values.action as 'register' | 'list' | 'delete';

async function figmaFetch(path: string, opts?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { 'X-Figma-Token': token!, 'Content-Type': 'application/json', ...(opts?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`Figma ${res.status}: ${await res.text()}`);
  return res.json() as Promise<Record<string, unknown>>;
}

// ── List ──────────────────────────────────────────────────────────────────────

async function listWebhooks(teamId: string) {
  const data = await figmaFetch(`/teams/${teamId}/webhooks`);
  const hooks = (data.webhooks ?? []) as Array<{ id: string; event_type: string; endpoint: string; status: string }>;
  if (hooks.length === 0) {
    console.log(`  Team ${teamId}: no webhooks registered`);
    return hooks;
  }
  for (const h of hooks) {
    console.log(`  [${h.id}] ${h.event_type} → ${h.endpoint} (${h.status})`);
  }
  return hooks;
}

// ── Register ──────────────────────────────────────────────────────────────────

async function registerWebhook(teamId: string) {
  if (!endpoint) { console.error('FIGMA_WEBHOOK_ENDPOINT required'); process.exit(1); }
  if (!passcode) { console.error('FIGMA_WEBHOOK_PASSCODE required'); process.exit(1); }

  const data = await figmaFetch('/webhooks', {
    method: 'POST',
    body: JSON.stringify({
      event_type: 'FILE_UPDATE',
      team_id: teamId,
      endpoint,
      passcode,
      description: 'figma-audit handover watch',
    }),
  });
  console.log(`  Team ${teamId}: webhook registered [${data.id}] → ${endpoint}`);
}

// ── Delete ────────────────────────────────────────────────────────────────────

async function deleteWebhook(webhookId: string) {
  await figmaFetch(`/webhooks/${webhookId}`, { method: 'DELETE' });
  console.log(`  Deleted webhook ${webhookId}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const teamIds = rawTeamIds?.split(',').map((s) => s.trim()).filter(Boolean) ?? [];
  if (teamIds.length === 0) { console.error('FIGMA_HANDOVER_TEAM_IDS required'); process.exit(1); }

  if (action === 'list') {
    console.log('Active webhooks:');
    for (const id of teamIds) await listWebhooks(id);
    return;
  }

  if (action === 'delete') {
    console.log('Deleting webhooks:');
    for (const id of teamIds) {
      const hooks = await listWebhooks(id);
      for (const h of hooks) await deleteWebhook(h.id);
    }
    return;
  }

  // Default: register
  console.log(`Registering FILE_UPDATE webhook → ${endpoint}`);
  for (const id of teamIds) await registerWebhook(id);
  console.log('\nDone. Figma will send FILE_UPDATE events to your Cloudflare Worker.');
  console.log('Next time a file in these teams is saved, handover-file.yml will run automatically.');
}

main().catch((err) => { console.error('Fatal:', err); process.exit(1); });
