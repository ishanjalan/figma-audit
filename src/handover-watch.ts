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
import { groupByFrame, buildPinComments } from './pin-comments.ts';

const STATE_FILE = '.handover-watch-state.json';

interface WatchState {
  // fileKey → lastModified ISO of the version we already commented on.
  lastCommented: Record<string, string>;
  // fileKey → frameId → commentId (for pin comments posted by this tool).
  // Used to resolve (delete) pins on screens that are now clean.
  pinnedComments: Record<string, Record<string, string>>;
  // fileKey → summary commentId (top-level unanchored comment).
  summaryComments: Record<string, string>;
}

function loadState(): WatchState {
  if (!existsSync(STATE_FILE)) return { lastCommented: {}, pinnedComments: {}, summaryComments: {} };
  try {
    const s = JSON.parse(readFileSync(STATE_FILE, 'utf-8')) as Partial<WatchState>;
    return {
      lastCommented: s.lastCommented ?? {},
      pinnedComments: s.pinnedComments ?? {},
      summaryComments: s.summaryComments ?? {},
    };
  } catch {
    return { lastCommented: {}, pinnedComments: {}, summaryComments: {} };
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

async function postComment(
  token: string,
  fileKey: string,
  message: string,
  clientMeta?: { node_id: string; node_offset: { x: number; y: number } },
): Promise<CommentResponse> {
  const body: Record<string, unknown> = { message };
  if (clientMeta) body.client_meta = clientMeta;

  const res = await fetch(`https://api.figma.com/v1/files/${fileKey}/comments`, {
    method: 'POST',
    headers: { 'X-Figma-Token': token, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Comment POST failed ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as CommentResponse;
}

async function deleteComment(token: string, fileKey: string, commentId: string): Promise<void> {
  const res = await fetch(`https://api.figma.com/v1/files/${fileKey}/comments/${commentId}`, {
    method: 'DELETE',
    headers: { 'X-Figma-Token': token },
  });
  // 404 is fine — comment was already deleted or the file no longer exists.
  if (!res.ok && res.status !== 404) {
    throw new Error(`Comment DELETE failed ${res.status}: ${await res.text()}`);
  }
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
    structureBreakdown?: { hidden: number; emptyContainer: number; detachedInstance: number };
  },
): Promise<void> {
  const total = counts.names + counts.structure;
  const b = counts.structureBreakdown;
  let structureDetail = `${counts.structure}`;
  if (b) {
    const parts: string[] = [];
    if (b.hidden > 0) parts.push(`${b.hidden} hidden`);
    if (b.emptyContainer > 0) parts.push(`${b.emptyContainer} empty`);
    if (b.detachedInstance > 0) parts.push(`${b.detachedInstance} detached`);
    if (parts.length) structureDetail = `${counts.structure} (${parts.join(' · ')})`;
  }
  const summary = [
    `📛 Names: ${counts.names} → Handover › Names tab`,
    `🧹 Structure: ${structureDetail} → Handover › Clean tab`,
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
  structureBreakdown?: { hidden: number; emptyContainer: number; detachedInstance: number };
}): string {
  const total = counts.names + counts.structure;
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
      if (b.detachedInstance > 0) parts.push(`${b.detachedInstance} detached instance${b.detachedInstance !== 1 ? 's' : ''}`);
    }
    const detail = parts.length ? ` (${parts.join(', ')})` : '';
    lines.push(`• ${counts.structure} structural issue${counts.structure !== 1 ? 's' : ''}${detail} → fix in Handover plugin → Clean tab`);
  }
  lines.push('');
  lines.push('💡 Open the file → Plugins menu → Handover. Set scope to "Page" (top-left toggle) and check every page — the audit covers the whole document. Each tab has a "Fix all" button.');
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
      // Opt-out: designer added [no-audit] to the file name.
      if (/\[no-audit\]/i.test(f.name)) {
        console.log(`  ${f.name} — skipped ([no-audit])`);
        continue;
      }

      // Skip if we've already commented on this exact version.
      if (state.lastCommented[f.key] === f.last_modified) {
        skippedUnchanged++;
        continue;
      }

      process.stdout.write(`  ${f.name} … `);
      try {
        const file = await getFile(token, f.key);
        const nameIssues = checkNames(file.document);
        const structureIssues = checkStructure(file.document);
        const counts = {
          names: nameIssues.length,
          structure: structureIssues.length,
          structureBreakdown: {
            hidden: structureIssues.filter((i) => i.kind === 'hidden').length,
            emptyContainer: structureIssues.filter((i) => i.kind === 'empty-container').length,
            detachedInstance: structureIssues.filter((i) => i.kind === 'detached-instance').length,
          },
        };
        const total = counts.names + counts.structure;

        // ── Resolve stale pins on frames that are now clean ──────────────────
        const dirtyFrameIds = new Set([
          ...nameIssues.map((i) => i.topLevelFrameId),
          ...structureIssues.map((i) => i.topLevelFrameId),
        ]);
        const previousPins = state.pinnedComments[f.key] ?? {};
        let pinsResolved = 0;
        const remainingPins: Record<string, string> = {};
        for (const [frameId, commentId] of Object.entries(previousPins)) {
          if (!dirtyFrameIds.has(frameId)) {
            try {
              await deleteComment(token, f.key, commentId);
              pinsResolved++;
            } catch (err) {
              console.log(`    resolve pin ${commentId} failed: ${err instanceof Error ? err.message : String(err)}`);
              remainingPins[frameId] = commentId; // keep tracking if delete failed
            }
          } else {
            remainingPins[frameId] = commentId; // still dirty — keep existing pin, don't re-post
          }
        }
        state.pinnedComments[f.key] = remainingPins;

        if (total === 0) {
          // Whole file is clean — also remove the old summary comment if we have one.
          const prevSummary = state.summaryComments[f.key];
          if (prevSummary) {
            try {
              await deleteComment(token, f.key, prevSummary);
              delete state.summaryComments[f.key];
            } catch { /* ignore */ }
          }
          state.lastCommented[f.key] = f.last_modified;
          skippedClean++;
          const resolveNote = pinsResolved > 0 ? ` (resolved ${pinsResolved} pin${pinsResolved !== 1 ? 's' : ''})` : '';
          console.log(`✓ clean${resolveNote}`);
          continue;
        }

        // ── Post new summary comment ─────────────────────────────────────────
        // Replace the old summary comment so we don't pile up.
        const prevSummaryId = state.summaryComments[f.key];
        if (prevSummaryId) {
          try { await deleteComment(token, f.key, prevSummaryId); } catch { /* ignore */ }
        }
        const summaryComment = await postComment(token, f.key, formatComment(counts));
        state.summaryComments[f.key] = summaryComment.id;

        // ── Post new pin comments for newly-dirty frames ─────────────────────
        // Skip frames that already have a tracked pin (avoid duplicates).
        const alreadyPinned = new Set(Object.keys(state.pinnedComments[f.key] ?? {}));
        const summaries = groupByFrame(nameIssues, structureIssues, 10);
        const pins = buildPinComments(summaries.filter((s) => !alreadyPinned.has(s.topLevelFrameId)));
        let pinsPosted = 0;
        for (const pin of pins) {
          try {
            const pinComment = await postComment(token, f.key, pin.message, pin.clientMeta);
            state.pinnedComments[f.key] ??= {};
            state.pinnedComments[f.key][pin.topLevelFrameId] = pinComment.id;
            pinsPosted++;
          } catch (err) {
            // Pin may fail if the target node was deleted between fetch and post.
            console.log(`    pin on ${pin.topLevelFrameId} failed: ${err instanceof Error ? err.message : String(err)}`);
          }
        }

        state.lastCommented[f.key] = f.last_modified;
        commented++;

        const pinNote = [
          pinsPosted > 0 ? `+${pinsPosted} pin${pinsPosted !== 1 ? 's' : ''}` : '',
          pinsResolved > 0 ? `✓${pinsResolved} resolved` : '',
        ].filter(Boolean).join(' ');
        const pinSuffix = pinNote ? ` (${pinNote})` : '';
        if (gchatUrl) {
          try {
            await pingGChat(gchatUrl, file.name, f.key, counts);
            console.log(`commented${pinSuffix} + chat ping (${total} issues)`);
          } catch (err) {
            console.log(`commented${pinSuffix} (${total} issues) · chat ping failed: ${err instanceof Error ? err.message : String(err)}`);
          }
        } else {
          console.log(`commented${pinSuffix} (${total} issues)`);
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
