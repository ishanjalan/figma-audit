// Wraps the shared check functions and produces the comment body.
import { checkNames } from '../../../src/checks/names.ts';
import { checkStructure } from '../../../src/checks/structure.ts';
import { checkResponsive } from '../../../src/checks/responsive.ts';
import type { FigmaNode } from '../../../src/api/types.ts';

export interface AuditCounts {
  names: number;
  structure: number;
  responsive: number;
  total: number;
}

export function auditDocument(doc: FigmaNode): AuditCounts {
  const names = checkNames(doc).length;
  const structure = checkStructure(doc).length;
  const responsive = checkResponsive(doc).length;
  return { names, structure, responsive, total: names + structure + responsive };
}

export function formatComment(counts: AuditCounts): string {
  const lines = [
    `🔍 Pre-handover audit — ${counts.total} issue${counts.total !== 1 ? 's' : ''} found before dev handover:`,
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
