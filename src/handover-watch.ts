/**
 * Tier 2: Pre-handover file watcher.
 *
 * Scans designated "Ready for Dev" projects (FIGMA_HANDOVER_PROJECT_IDS).
 * For each file modified since our last check, runs the audit and posts a
 * comment on the Figma file with issues to address before handover.
 *
 * Schedule: runs hourly via GitHub Actions. State (last-commented version per
 * file) is cached so we never double-comment on an unchanged file.
 *
 * Usage:
 *   npm run handover-watch
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { getProjectFiles, getFile } from './api/client.ts';
import { checkNames } from './checks/names.ts';
import { checkStructure } from './checks/structure.ts';
import { checkResponsive } from './checks/responsive.ts';

const STATE_FILE = '.handover-watch-state.json';

interface WatchState {
  // fileKey → lastModified ISO of the version we already commented on.
  lastCommented: Record<string, string>;
}

function loadState(): WatchState {
  if (!existsSync(STATE_FILE)) return { lastCommented: {} };
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf-8'));
  } catch {
    return { lastCommented: {} };
  }
}

function saveState(state: WatchState): void {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
}

async function postComment(token: string, fileKey: string, message: string): Promise<void> {
  const res = await fetch(`https://api.figma.com/v1/files/${fileKey}/comments`, {
    method: 'POST',
    headers: { 'X-Figma-Token': token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  });
  if (!res.ok) {
    throw new Error(`Comment POST failed ${res.status}: ${await res.text()}`);
  }
}

function formatComment(counts: { names: number; structure: number; responsive: number }): string {
  const total = counts.names + counts.structure + counts.responsive;
  const lines = [
    `🔍 Pre-handover audit — ${total} issue${total !== 1 ? 's' : ''} found before dev handover:`,
    '',
  ];
  if (counts.names > 0) {
    lines.push(`• ${counts.names} layer${counts.names !== 1 ? 's' : ''} with auto-generated names (e.g. "Frame 23")`);
  }
  if (counts.structure > 0) {
    lines.push(`• ${counts.structure} structural issue${counts.structure !== 1 ? 's' : ''} (hidden layers, empty containers, deep nesting)`);
  }
  if (counts.responsive > 0) {
    lines.push(`• ${counts.responsive} frame${counts.responsive !== 1 ? 's' : ''} lacking horizontal responsiveness`);
  }
  lines.push('');
  lines.push('💡 Run the Handover plugin (Plugins → Handover) to fix most of these in one click.');
  return lines.join('\n');
}

async function main() {
  const token = process.env.FIGMA_TOKEN;
  const raw = process.env.FIGMA_HANDOVER_PROJECT_IDS;
  const projectIds = raw?.split(',').map((s) => s.trim()).filter(Boolean) ?? [];

  if (!token) {
    console.error('FIGMA_TOKEN required');
    process.exit(1);
  }
  if (projectIds.length === 0) {
    console.error('FIGMA_HANDOVER_PROJECT_IDS required (comma-separated project IDs of your "Ready for Dev" projects)');
    process.exit(1);
  }

  const state = loadState();
  let commented = 0;
  let skippedClean = 0;
  let skippedUnchanged = 0;
  let errored = 0;

  for (const projectId of projectIds) {
    console.log(`Scanning handover project ${projectId}…`);
    let files;
    try {
      files = await getProjectFiles(token, projectId);
    } catch (err) {
      console.log(`  error listing project: ${err instanceof Error ? err.message : String(err)}`);
      errored++;
      continue;
    }

    for (const f of files) {
      // Skip if we've already commented on this exact version.
      if (state.lastCommented[f.key] === f.last_modified) {
        skippedUnchanged++;
        continue;
      }

      process.stdout.write(`  ${f.name} … `);
      try {
        const file = await getFile(token, f.key);
        const counts = {
          names: checkNames(file.document).length,
          structure: checkStructure(file.document).length,
          responsive: checkResponsive(file.document).length,
        };
        const total = counts.names + counts.structure + counts.responsive;

        if (total === 0) {
          state.lastCommented[f.key] = f.last_modified;
          skippedClean++;
          console.log('✓ clean');
          continue;
        }

        await postComment(token, f.key, formatComment(counts));
        state.lastCommented[f.key] = f.last_modified;
        commented++;
        console.log(`commented (${total} issues)`);
      } catch (err) {
        errored++;
        console.log(`error — ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  saveState(state);
  console.log(
    `\nDone. Commented: ${commented} · clean: ${skippedClean} · unchanged: ${skippedUnchanged} · errored: ${errored}`,
  );
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
