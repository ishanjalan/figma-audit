// Detects layers with Figma's auto-generated default names that the Handover
// plugin would propose a meaningful rename for. Only flags layers where a
// semantic name can actually be inferred — otherwise the audit would report
// "issues" the plugin won't fix, frustrating designers.
//
// Mirrors the detection AND the inferName logic in Handover's names.ts.
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

// ── Rename-inference (port of Handover plugin's inferName) ───────────────────
// Returns true iff the plugin would be able to propose a meaningful name.

function findFirstText(node: FigmaNode, depth: number): string | null {
  if (depth > 3) return null;
  if (node.type === 'TEXT') {
    // We don't have the actual characters in the REST tree by default, but
    // a TEXT node existing under this subtree is enough for the plugin to
    // propose a name. Treat presence as success.
    return 'text';
  }
  for (const child of node.children ?? []) {
    const t = findFirstText(child, depth + 1);
    if (t) return t;
  }
  return null;
}

function canInferName(node: FigmaNode, isTopLevel: boolean): boolean {
  // Priority 1: text descendant within 3 levels.
  if (findFirstText(node, 0)) return true;

  // Priority 2: semantic frame/component context.
  if (node.type === 'FRAME' || node.type === 'COMPONENT') {
    if (isTopLevel) return true;                        // → Screen
    if (node.layoutMode && node.layoutMode !== 'NONE') return true; // → Row/Stack/Card
    // Note: we can't reliably detect "fills parent" (Background) from the
    // REST tree without parent dimensions in scope. Skip — rare case.
    return false;
  }

  if (node.type === 'SECTION') return true;             // → Section
  if (node.type === 'LINE') return true;                // → Divider

  // VECTOR / STAR / POLYGON — the plugin classifies by geometry (Divider/Icon/
  // Shape). The audit doesn't have width/height in scope here, so be liberal
  // and assume the plugin can propose something.
  if (node.type === 'VECTOR' || node.type === 'STAR' || node.type === 'POLYGON') {
    return true;
  }

  // GROUP, RECTANGLE, ELLIPSE, IMAGE without text/layout context — the plugin
  // returns null. Leave alone.
  return false;
}

// ── Scanner ──────────────────────────────────────────────────────────────────

interface ScanCtx {
  ancestors: string[];
  topLevelFrameId: string;
  topLevelFrameName: string;
  isTopLevel: boolean;
}

function scanNode(node: FigmaNode, ctx: ScanCtx, issues: NameIssue[]): void {
  if (node.locked) return;
  if (hasIntentionalMarkers(node)) return;

  if (GENERIC_NAME_RE.test(node.name.trim()) && canInferName(node, ctx.isTopLevel)) {
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
    scanNode(
      child,
      {
        ...ctx,
        ancestors: [...ctx.ancestors, node.name],
        isTopLevel: false,
      },
      issues,
    );
  }
}

export function checkNames(document: FigmaNode): NameIssue[] {
  const issues: NameIssue[] = [];
  for (const page of document.children ?? []) {
    for (const node of page.children ?? []) {
      if (node.type === 'SECTION') {
        // Sections are screen-grouping containers — skip the section itself and
        // treat each child frame as a top-level screen for pinning purposes.
        for (const child of node.children ?? []) {
          scanNode(
            child,
            {
              ancestors: [page.name, node.name],
              topLevelFrameId: child.id,
              topLevelFrameName: child.name,
              isTopLevel: true,
            },
            issues,
          );
        }
      } else {
        scanNode(
          node,
          {
            ancestors: [page.name],
            topLevelFrameId: node.id,
            topLevelFrameName: node.name,
            isTopLevel: true,
          },
          issues,
        );
      }
    }
  }
  return issues;
}
