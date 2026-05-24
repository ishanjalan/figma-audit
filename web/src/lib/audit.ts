// Wraps the shared check functions and produces the comment body.
import { checkNames } from '../../../src/checks/names.ts';
import { checkStructure } from '../../../src/checks/structure.ts';
import { checkResponsive } from '../../../src/checks/responsive.ts';
import type { FigmaNode } from '../../../src/api/types.ts';

export interface StructureBreakdown {
  hidden: number;
  emptyContainer: number;
  deepNesting: number;
}

export interface AuditCounts {
  names: number;
  structure: number;
  structureBreakdown: StructureBreakdown;
  responsive: number;
  total: number;
}

export function auditDocument(doc: FigmaNode): AuditCounts {
  const names = checkNames(doc).length;
  const structureIssues = checkStructure(doc);
  const structureBreakdown: StructureBreakdown = {
    hidden: structureIssues.filter((i) => i.kind === 'hidden').length,
    emptyContainer: structureIssues.filter((i) => i.kind === 'empty-container').length,
    deepNesting: structureIssues.filter((i) => i.kind === 'deep-nesting').length,
  };
  const responsive = checkResponsive(doc).length;
  return {
    names,
    structure: structureIssues.length,
    structureBreakdown,
    responsive,
    total: names + structureIssues.length + responsive,
  };
}

export function formatComment(counts: AuditCounts): string {
  const lines = [
    `🔍 Pre-handover audit — ${counts.total} issue${counts.total !== 1 ? 's' : ''} found before dev handover:`,
    '',
  ];
  if (counts.names > 0) {
    lines.push(`• ${counts.names} layer${counts.names !== 1 ? 's' : ''} with auto-generated names → fix in Handover plugin → Names tab`);
  }
  if (counts.structure > 0) {
    const b = counts.structureBreakdown;
    const parts: string[] = [];
    if (b.hidden > 0) parts.push(`${b.hidden} hidden`);
    if (b.emptyContainer > 0) parts.push(`${b.emptyContainer} empty container${b.emptyContainer !== 1 ? 's' : ''}`);
    if (b.deepNesting > 0) parts.push(`${b.deepNesting} deeply-nested`);
    lines.push(`• ${counts.structure} structural issue${counts.structure !== 1 ? 's' : ''} (${parts.join(', ')}) → fix in Handover plugin → Clean tab`);
  }
  if (counts.responsive > 0) {
    lines.push(`• ${counts.responsive} frame${counts.responsive !== 1 ? 's' : ''} lacking horizontal responsiveness → fix in Handover plugin → Fluid tab`);
  }
  lines.push('');
  lines.push('💡 Open the file → Plugins menu → Handover. Set scope to "Page" (top-left toggle) and check every page — the audit covers the whole document. Each tab has a "Fix all" button.');
  return lines.join('\n');
}
