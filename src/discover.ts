/**
 * One-time discovery via Activity Logs API.
 *
 * Paginates through org activity logs, collects every unique team_id AND
 * every unique file key surfaced in file events, and prints values ready to
 * paste into .env (also writes them in-place if .env exists).
 *
 * Why both? Team-based enumeration misses files that live in containers we
 * don't walk (workspaces, etc.). Harvesting file keys directly from activity
 * logs is the safety net.
 *
 * Usage:
 *   npm run discover
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const BASE = 'https://api.figma.com/v1';

async function apiFetch(url: string, token: string): Promise<unknown> {
  const res = await fetch(url, { headers: { 'X-Figma-Token': token } });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}

interface ActivityLogResponse {
  meta: {
    activity_logs: Array<{
      context: { team_id?: string | null; org_id?: string | null } | null;
      entity: { type: string; id?: string; key?: string; name?: string } | null;
    }>;
    cursor?: string;
    next_page: boolean;
  };
}

interface Discovered {
  teams: Map<string, string>;   // teamId → name
  files: Map<string, string>;   // fileKey → name (best-effort)
}

async function discover(token: string): Promise<Discovered> {
  const teams = new Map<string, string>();
  const files = new Map<string, string>();

  // Pull back ~90 days (the documented log retention window for Enterprise).
  const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
  const startTime = Math.floor((Date.now() - NINETY_DAYS_MS) / 1000);

  let cursor: string | undefined;
  let page = 1;
  let totalEvents = 0;

  // Stop after this many consecutive pages with no new team OR file found.
  const STALE_PAGE_LIMIT = 8;
  let stalePages = 0;

  process.stdout.write('Paginating activity logs');

  while (true) {
    const url = new URL(`${BASE}/activity_logs`);
    url.searchParams.set('limit', '1000');
    url.searchParams.set('order', 'desc');
    url.searchParams.set('start_time', String(startTime));
    if (cursor) url.searchParams.set('cursor', cursor);

    const data = (await apiFetch(url.toString(), token)) as ActivityLogResponse;
    const logs = data.meta.activity_logs;
    totalEvents += logs.length;

    const teamsBefore = teams.size;
    const filesBefore = files.size;

    for (const log of logs) {
      // Team discovery: any context.team_id is a candidate.
      const teamId = log.context?.team_id;
      if (teamId && !teams.has(teamId)) teams.set(teamId, 'Unknown');

      const entity = log.entity;
      if (!entity) continue;

      // If this event's entity IS the team, grab its name.
      if (entity.type === 'team' && entity.id && entity.name) {
        teams.set(entity.id, entity.name);
      }

      // File discovery: any file entity. Note entity.key (not entity.id) for files.
      if (entity.type === 'file' && entity.key) {
        if (!files.has(entity.key)) files.set(entity.key, entity.name ?? 'Unknown');
      }
    }

    const foundSomething = teams.size > teamsBefore || files.size > filesBefore;

    process.stdout.write(
      ` · page ${page} (${teams.size} teams, ${files.size} files)`,
    );

    if (!data.meta.next_page || !data.meta.cursor) break;

    if (!foundSomething) {
      stalePages++;
      if (stalePages >= STALE_PAGE_LIMIT) {
        process.stdout.write(
          ` · no new teams/files in ${STALE_PAGE_LIMIT} pages, stopping`,
        );
        break;
      }
    } else {
      stalePages = 0;
    }

    cursor = data.meta.cursor;
    page++;
    await new Promise((r) => setTimeout(r, 500));
  }

  console.log(`\n\nScanned ${totalEvents} events across ${page} pages.`);
  return { teams, files };
}

function updateEnv(updates: Record<string, string>): void {
  const envPath = '.env';

  if (!existsSync(envPath)) {
    console.log('No .env found — add these lines manually:');
    for (const [k, v] of Object.entries(updates)) console.log(`${k}=${v}`);
    return;
  }

  let contents = readFileSync(envPath, 'utf-8');

  for (const [key, value] of Object.entries(updates)) {
    const re = new RegExp(`^${key}=.*`, 'm');
    if (re.test(contents)) {
      contents = contents.replace(re, `${key}=${value}`);
    } else {
      contents += `\n${key}=${value}\n`;
    }
  }

  writeFileSync(envPath, contents, 'utf-8');
  console.log(`✓ .env updated with ${Object.keys(updates).join(', ')}`);
}

async function main() {
  const token = process.env.FIGMA_TOKEN;
  if (!token) {
    console.error('FIGMA_TOKEN required');
    process.exit(1);
  }

  console.log('Discovering teams and files via activity logs (last ~90 days)…\n');
  const { teams, files } = await discover(token);

  console.log(`\nFound ${teams.size} unique team${teams.size !== 1 ? 's' : ''}:\n`);
  teams.forEach((name, id) => console.log(`  ${id}  ${name}`));

  console.log(`\nFound ${files.size} unique file${files.size !== 1 ? 's' : ''} in event history.`);

  const teamIds = [...teams.keys()];
  const fileKeys = [...files.keys()];

  console.log(`\nFIGMA_TEAM_IDS=${teamIds.join(',')}`);
  console.log(`FIGMA_FILE_KEYS=<${fileKeys.length} keys, see .env>\n`);

  updateEnv({
    FIGMA_TEAM_IDS: teamIds.join(','),
    FIGMA_FILE_KEYS: fileKeys.join(','),
  });
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
