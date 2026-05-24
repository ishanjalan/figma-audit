// Detects frames and components with no horizontal responsiveness.
import type { FigmaNode } from '../api/types.ts';

export interface ResponsiveIssue {
  nodeId: string;
  nodeName: string;
  nodeType: string;
  path: string;
}

function isResponsive(node: FigmaNode): boolean {
  // Auto-layout frame with fill sizing on the horizontal axis.
  if (node.layoutMode && node.layoutMode !== 'NONE') {
    if (node.layoutSizingHorizontal === 'FILL') return true;
  }
  // Constraint-based: SCALE or STRETCH means it adapts to parent width.
  const h = node.constraints?.horizontal;
  if (h === 'SCALE' || h === 'STRETCH') return true;
  return false;
}

function hasIntentionalMarkers(node: FigmaNode): boolean {
  if (node.reactions && node.reactions.length > 0) return true;
  if (node.exportSettings && node.exportSettings.length > 0) return true;
  if (node.annotations && node.annotations.length > 0) return true;
  return false;
}

function scanNode(node: FigmaNode, ancestors: string[], issues: ResponsiveIssue[]): void {
  if (node.locked || node.visible === false) return;
  if (hasIntentionalMarkers(node)) return;

  // Don't recurse into instances — fix the master component, not every copy.
  // BOOLEAN_OPERATION children are shape operands, never independently responsive.
  if (node.type === 'INSTANCE' || node.type === 'BOOLEAN_OPERATION') return;

  if (node.type === 'FRAME' || node.type === 'COMPONENT') {
    if (!isResponsive(node)) {
      issues.push({
        nodeId: node.id,
        nodeName: node.name,
        nodeType: node.type,
        path: ancestors.join(' › '),
      });
    }
  }

  for (const child of node.children ?? []) {
    scanNode(child, [...ancestors, node.name], issues);
  }
}

export function checkResponsive(document: FigmaNode): ResponsiveIssue[] {
  const issues: ResponsiveIssue[] = [];
  for (const page of document.children ?? []) {
    for (const node of page.children ?? []) {
      scanNode(node, [page.name], issues);
    }
  }
  return issues;
}
