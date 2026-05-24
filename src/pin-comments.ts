// Group audit issues by their containing top-level frame and produce
// per-frame pin-comment payloads (with `client_meta` for Figma to anchor
// the comment to the actual screen instead of dropping it on page 1).
//
// Used by both the CLI handover-watch and the web UI so they post the same
// shape of pin comments.

import type { NameIssue } from './checks/names.ts';
import type { StructureIssue, StructureIssueKind } from './checks/structure.ts';

export interface PerFrameSummary {
  topLevelFrameId: string;
  topLevelFrameName: string;
  total: number;
  names: number;
  structure: number;
  structureBreakdown: Record<StructureIssueKind, number>;
}

export interface PinComment {
  topLevelFrameId: string;
  message: string;
  /** Figma client_meta payload. node_offset {0,0} anchors top-left of frame. */
  clientMeta: { node_id: string; node_offset: { x: number; y: number } };
}

/**
 * Group issues by the top-level frame they live in and rank by total count.
 * Returns at most `limit` frames (default 10) so we don't spam the file with
 * a pin per issue.
 */
export function groupByFrame(
  names: NameIssue[],
  structure: StructureIssue[],
  limit = 10,
): PerFrameSummary[] {
  const map = new Map<string, PerFrameSummary>();

  const ensure = (id: string, name: string): PerFrameSummary => {
    let entry = map.get(id);
    if (!entry) {
      entry = {
        topLevelFrameId: id,
        topLevelFrameName: name,
        total: 0,
        names: 0,
        structure: 0,
        structureBreakdown: { hidden: 0, 'empty-container': 0, 'detached-instance': 0 },
      };
      map.set(id, entry);
    }
    return entry;
  };

  for (const i of names) {
    const e = ensure(i.topLevelFrameId, i.topLevelFrameName);
    e.names++;
    e.total++;
  }
  for (const i of structure) {
    const e = ensure(i.topLevelFrameId, i.topLevelFrameName);
    e.structure++;
    e.structureBreakdown[i.kind]++;
    e.total++;
  }
  return [...map.values()]
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);
}

export function formatPinComment(s: PerFrameSummary): string {
  const lines = [`🔍 Pre-handover: ${s.total} issue${s.total !== 1 ? 's' : ''} in this screen`, ''];
  if (s.names > 0) {
    lines.push(`• ${s.names} auto-named layer${s.names !== 1 ? 's' : ''} → Handover › Names tab`);
  }
  if (s.structure > 0) {
    const b = s.structureBreakdown;
    const parts: string[] = [];
    if (b.hidden > 0) parts.push(`${b.hidden} hidden`);
    if (b['empty-container'] > 0) parts.push(`${b['empty-container']} empty`);
    if (b['detached-instance'] > 0) parts.push(`${b['detached-instance']} detached`);
    lines.push(`• ${s.structure} structural (${parts.join(', ')}) → Handover › Clean tab`);
  }
  return lines.join('\n');
}

export function buildPinComments(summaries: PerFrameSummary[]): PinComment[] {
  return summaries.map((s) => ({
    topLevelFrameId: s.topLevelFrameId,
    message: formatPinComment(s),
    clientMeta: {
      node_id: s.topLevelFrameId,
      node_offset: { x: 0, y: 0 },
    },
  }));
}
