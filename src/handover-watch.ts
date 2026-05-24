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

interface CommentResponse {
  id: string;
  message: string;
  created_at: string;
}

async function postComment(token: string, fileKey: string, message: string): Promise<CommentResponse> {
  const res = await fetch(`https://api.figma.com/v1/files/${fileKey}/comments`, {
    method: 'POST',
    headers: { 'X-Figma-Token': token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  });
  if (!res.ok) {
    throw new Error(`Comment POST failed ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as CommentResponse;
}

function figmaFileUrl(key: string): string {
  return `https://www.figma.com/design/${key}`;
}

/**
 * Per-file Google Chat ping. Sent after we post the in-Figma comment so the
 * design owner gets a reliable notification with a link back to the file —
 * Figma's own notifications only reach file watchers.
 */
async function pingGChat(
  webhookUrl: string,
  fileName: string,
  fileKey: string,
  counts: {
    names: number;
    structure: number;
    structureBreakdown?: { hidden: number; emptyContainer: number; deepNesting: number };
    responsive: number;
  },
): Promise<void> {
  const total = counts.names + counts.structure + counts.responsive;
  const b = counts.structureBreakdown;
  const structureDetail = b
    ? `${counts.structure} (${b.hidden} hidden · ${b.emptyContainer} empty · ${b.deepNesting} deep)`
    : `${counts.structure}`;
  const summary = [
    `📛 Names: ${counts.names} → Handover › Names tab`,
    `🧹 Structure: ${structureDetail} → Handover › Clean tab`,
    `📐 Responsive: ${counts.responsive} → Handover › Fluid tab`,
  ].join('<br>');

  const body = {
    cardsV2: [
      {
        cardId: `handover-${fileKey}`,
        card: {
          header: {
            title: `🔍 Pre-handover: ${fileName}`,
            subtitle: `${total} issue${total !== 1 ? 's' : ''} to fix before dev handover`,
          },
          sections: [
            {
              widgets: [
                { textParagraph: { text: summary } },
                {
                  buttonList: {
                    buttons: [
                      {
                        text: 'Open in Figma',
                        onClick: { openLink: { url: figmaFileUrl(fileKey) } },
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
      },
    ],
  };

  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`GChat ping failed ${res.status}: ${await res.text()}`);
  }
}

function formatComment(counts: {
  names: number;
  structure: number;
  structureBreakdown?: { hidden: number; emptyContainer: number; deepNesting: number };
  responsive: number;
}): string {
  const total = counts.names + counts.structure + counts.responsive;
  const lines = [
    `🔍 Pre-handover audit — ${total} issue${total !== 1 ? 's' : ''} found before dev handover:`,
    '',
  ];
  if (counts.names > 0) {
    lines.push(`• ${counts.names} layer${counts.names !== 1 ? 's' : ''} with auto-generated names → fix in Handover plugin → Names tab`);
  }
  if (counts.structure > 0) {
    const b = counts.structureBreakdown;
    const parts: string[] = [];
    if (b) {
      if (b.hidden > 0) parts.push(`${b.hidden} hidden`);
      if (b.emptyContainer > 0) parts.push(`${b.emptyContainer} empty container${b.emptyContainer !== 1 ? 's' : ''}`);
      if (b.deepNesting > 0) parts.push(`${b.deepNesting} deeply-nested`);
    }
    const detail = parts.length ? ` (${parts.join(', ')})` : '';
    lines.push(`• ${counts.structure} structural issue${counts.structure !== 1 ? 's' : ''}${detail} → fix in Handover plugin → Clean tab`);
  }
  if (counts.responsive > 0) {
    lines.push(`• ${counts.responsive} frame${counts.responsive !== 1 ? 's' : ''} lacking horizontal responsiveness → fix in Handover plugin → Fluid tab`);
  }
  lines.push('');
  lines.push('💡 Open the file → Plugins menu → Handover. Each tab has a "Fix all" button.');
  return lines.join('\n');
}

async function main() {
  const token = process.env.FIGMA_TOKEN;
  const raw = process.env.FIGMA_HANDOVER_PROJECT_IDS;
  const projectIds = raw?.split(',').map((s) => s.trim()).filter(Boolean) ?? [];
  const gchatUrl = process.env.GCHAT_WEBHOOK_URL;

  if (!token) {
    console.error('FIGMA_TOKEN required');
    process.exit(1);
  }
  if (projectIds.length === 0) {
    console.error('FIGMA_HANDOVER_PROJECT_IDS required (comma-separated project IDs of your "Ready for Dev" projects)');
    process.exit(1);
  }
  if (!gchatUrl) {
    console.log('Note: GCHAT_WEBHOOK_URL not set — in-file comments will post but no Chat notifications will be sent.');
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
        const structureIssues = checkStructure(file.document);
        const counts = {
          names: checkNames(file.document).length,
          structure: structureIssues.length,
          structureBreakdown: {
            hidden: structureIssues.filter((i) => i.kind === 'hidden').length,
            emptyContainer: structureIssues.filter((i) => i.kind === 'empty-container').length,
            deepNesting: structureIssues.filter((i) => i.kind === 'deep-nesting').length,
          },
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

        if (gchatUrl) {
          try {
            await pingGChat(gchatUrl, file.name, f.key, counts);
            console.log(`commented + chat ping (${total} issues)`);
          } catch (err) {
            console.log(`commented (${total} issues) · chat ping failed: ${err instanceof Error ? err.message : String(err)}`);
          }
        } else {
          console.log(`commented (${total} issues)`);
        }
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
