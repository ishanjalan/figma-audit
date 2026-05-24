// Detects layers with Figma's auto-generated default names.
// Mirrors the detection logic in the Handover plugin's names.ts.
import type { FigmaNode } from '../api/types.ts';

const GENERIC_NAME_RE =
  /^(Frame|Group|Rectangle|Ellipse|Vector|Polygon|Star|Line|Image|Component|Instance|Section)\s+\d+$/i;

export interface NameIssue {
  nodeId: string;
  nodeName: string;
  nodeType: string;
  path: string;
}

function scanNode(node: FigmaNode, ancestors: string[], issues: NameIssue[]): void {
  if (node.locked) return;

  if (GENERIC_NAME_RE.test(node.name.trim())) {
    issues.push({
      nodeId: node.id,
      nodeName: node.name,
      nodeType: node.type,
      path: ancestors.join(' › '),
    });
  }

  // Mirror plugin behaviour: don't recurse into instance or boolean-op internals.
  if (node.type === 'INSTANCE' || node.type === 'BOOLEAN_OPERATION') return;

  for (const child of node.children ?? []) {
    scanNode(child, [...ancestors, node.name], issues);
  }
}

export function checkNames(document: FigmaNode): NameIssue[] {
  const issues: NameIssue[] = [];
  for (const page of document.children ?? []) {
    for (const node of page.children ?? []) {
      scanNode(node, [page.name], issues);
    }
  }
  return issues;
}
