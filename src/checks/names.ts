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
  topLevelFrameId: string;
  topLevelFrameName: string;
}

function hasIntentionalMarkers(node: FigmaNode): boolean {
  if (node.reactions && node.reactions.length > 0) return true;
  if (node.exportSettings && node.exportSettings.length > 0) return true;
  if (node.annotations && node.annotations.length > 0) return true;
  return false;
}

interface ScanCtx {
  ancestors: string[];
  topLevelFrameId: string;
  topLevelFrameName: string;
}

function scanNode(node: FigmaNode, ctx: ScanCtx, issues: NameIssue[]): void {
  if (node.locked) return;
  if (hasIntentionalMarkers(node)) return;

  if (GENERIC_NAME_RE.test(node.name.trim())) {
    issues.push({
      nodeId: node.id,
      nodeName: node.name,
      nodeType: node.type,
      path: ctx.ancestors.join(' › '),
      topLevelFrameId: ctx.topLevelFrameId,
      topLevelFrameName: ctx.topLevelFrameName,
    });
  }

  // Mirror plugin behaviour: don't recurse into instance or boolean-op internals.
  if (node.type === 'INSTANCE' || node.type === 'BOOLEAN_OPERATION') return;

  for (const child of node.children ?? []) {
    scanNode(child, { ...ctx, ancestors: [...ctx.ancestors, node.name] }, issues);
  }
}

export function checkNames(document: FigmaNode): NameIssue[] {
  const issues: NameIssue[] = [];
  for (const page of document.children ?? []) {
    for (const node of page.children ?? []) {
      scanNode(
        node,
        { ancestors: [page.name], topLevelFrameId: node.id, topLevelFrameName: node.name },
        issues,
      );
    }
  }
  return issues;
}
