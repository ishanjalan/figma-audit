/**
 * Registers (or lists/deletes) Figma FILE_UPDATE webhooks using the v2 API.
 *
 * Webhooks can be scoped to a team, project, or file. We attach at the team
 * level so every file in the team triggers the event.
 *
 * Usage:
 *   npm run webhook:register   # attach webhooks to all FIGMA_HANDOVER_TEAM_IDS
 *   npm run webhook:list       # list all webhooks on your plan
 *   npm run webhook:delete     # delete webhooks registered by this tool
 *
 * Required env vars (add to .env):
 *   FIGMA_TOKEN                 — plan access token (figp_…)
 *   FIGMA_HANDOVER_TEAM_IDS     — comma-separated team IDs to watch
 *   FIGMA_WEBHOOK_ENDPOINT      — your Pipedream HTTP trigger URL
 *   FIGMA_WEBHOOK_PASSCODE      — same random string set in Pipedream env vars
 *
 * For Enterprise plans, use FIGMA_ORG_ID instead of team IDs.
 * plan_api_id format:
 *   Professional:          team-<teamId>
 *   Org / Enterprise:      organization-<orgId>
 */

import { parseArgs } from 'node:util';

// Webhooks are v2 — the v1 endpoint was removed.
const BASE = 'https://api.figma.com/v2';

const token = process.env.FIGMA_TOKEN;
const rawTeamIds = process.env.FIGMA_HANDOVER_TEAM_IDS;
const orgId = process.env.FIGMA_ORG_ID;
const endpoint = process.env.FIGMA_WEBHOOK_ENDPOINT;
const passcode = process.env.FIGMA_WEBHOOK_PASSCODE;

if (!token) { console.error('FIGMA_TOKEN required'); process.exit(1); }

const { values } = parseArgs({ options: { action: { type: 'string', default: 'register' } } });
const action = values.action as 'register' | 'list' | 'delete';

async function figmaFetch(path: string, opts?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      'X-Figma-Token': token!,
      'Content-Type': 'application/json',
      ...(opts?.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`Figma ${res.status}: ${await res.text()}`);
  return res.json() as Promise<Record<string, unknown>>;
}

// ── Plan API ID ───────────────────────────────────────────────────────────────
// Enterprise/Org plans use organization-<orgId>; Professional uses team-<teamId>.

function planApiId(): string | null {
  if (orgId) return `organization-${orgId}`;
  const teamIds = rawTeamIds?.split(',').map((s) => s.trim()).filter(Boolean) ?? [];
  if (teamIds.length > 0) return `team-${teamIds[0]}`;
  return null;
}

// ── List ──────────────────────────────────────────────────────────────────────

async function listWebhooks(): Promise<Array<{ id: string; event_type: string; endpoint: string; status: string; context: { type: string; id: string } }>> {
  const id = planApiId();
  if (!id) { console.error('FIGMA_HANDOVER_TEAM_IDS or FIGMA_ORG_ID required'); process.exit(1); }

  const data = await figmaFetch(`/webhooks?plan_api_id=${encodeURIComponent(id)}`);
  const contexts = (data.contexts ?? []) as Array<{ webhooks: unknown[] }>;
  const hooks = contexts.flatMap((c) => c.webhooks ?? []) as Array<{
    id: string; event_type: string; endpoint: string; status: string;
    context: { type: string; id: string };
  }>;

  if (hooks.length === 0) {
    console.log('No webhooks registered.');
    return hooks;
  }
  for (const h of hooks) {
    console.log(`  [${h.id}] ${h.event_type} → ${h.endpoint} (${h.status}) [${h.context.type}:${h.context.id}]`);
  }
  return hooks;
}

// ── Register ──────────────────────────────────────────────────────────────────

async function registerForTeam(teamId: string) {
  if (!endpoint) { console.error('FIGMA_WEBHOOK_ENDPOINT required'); process.exit(1); }
  if (!passcode) { console.error('FIGMA_WEBHOOK_PASSCODE required'); process.exit(1); }

  const data = await figmaFetch('/webhooks', {
    method: 'POST',
    body: JSON.stringify({
      event_type: 'FILE_UPDATE',
      team_id: teamId,
      endpoint,
      passcode,
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

  if (action === 'list') {
    console.log('Active webhooks:');
    await listWebhooks();
    return;
  }

  if (action === 'delete') {
    console.log('Deleting all webhooks:');
    const hooks = await listWebhooks();
    for (const h of hooks) await deleteWebhook(h.id);
    return;
  }

  // Default: register
  if (teamIds.length === 0) { console.error('FIGMA_HANDOVER_TEAM_IDS required'); process.exit(1); }
  console.log(`Registering FILE_UPDATE webhooks (v2) → ${endpoint}`);
  for (const id of teamIds) await registerForTeam(id);
  console.log('\nDone. Figma will POST FILE_UPDATE events to your Pipedream endpoint.');
  console.log('Run "npm run webhook:list" to confirm.');
}

main().catch((err) => { console.error('Fatal:', err); process.exit(1); });
