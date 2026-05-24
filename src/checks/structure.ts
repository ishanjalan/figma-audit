// Detects structural issues: hidden layers and empty containers.
//
// Skip logic mirrors the Handover plugin's scanner so the REST audit and the
// in-Figma plugin stay aligned. Without these guards, the audit massively
// over-reports because it walks instance internals, intentional hidden states,
// and designer markers (reactions, exports, annotations) that the plugin
// correctly leaves alone.
//
// Note: deep-nesting was previously checked here but removed — depth is a
// proxy for "complex screen," not a fixable defect. The plugin catches the
// actual contributors to depth (passthrough/wrapper frames, single-child
// groups, groups-in-autolayout) via its Clean tab; trust those instead.
import type { FigmaNode } from '../api/types.ts';

export type StructureIssueKind = 'hidden' | 'empty-container';

export interface StructureIssue {
  nodeId: string;
  nodeName: string;
  nodeType: string;
  kind: StructureIssueKind;
  path: string;
  // Top-level frame on the page that contains this issue. Used to pin the
  // audit comment on the actual screen instead of dropping it on page 1.
  topLevelFrameId: string;
  topLevelFrameName: string;
}

const CONTAINER_TYPES = new Set(['FRAME', 'GROUP', 'COMPONENT']);

// Instances inherit from their master — fix the source, not the copy.
// Boolean op children are shape operands — flagging them would break the shape.
const SKIP_TYPES = new Set(['INSTANCE', 'BOOLEAN_OPERATION']);

// SECTION and COMPONENT_SET are organisational wrappers — pass through to
// children without flagging the container itself.
const PASSTHROUGH_TYPES = new Set(['SECTION', 'COMPONENT_SET']);

function hasIntentionalMarkers(node: FigmaNode): boolean {
  if (node.reactions && node.reactions.length > 0) return true;
  if (node.exportSettings && node.exportSettings.length > 0) return true;
  if (node.annotations && node.annotations.length > 0) return true;
  return false;
}

// A childless frame/group that has visible fills, strokes, or effects is a
// leaf visual element (background block, image fill, decorative divider).
// It renders something on its own — NOT actually empty, leave it alone.
// Mirrors Handover plugin scanner.ts's empty-container guard.
function isVisualLeaf(node: FigmaNode): boolean {
  const hasVisibleFill =
    Array.isArray(node.fills) && node.fills.some((f) => f.visible !== false);
  const hasVisibleEffect =
    Array.isArray(node.effects) && node.effects.some((e) => e.visible !== false);
  const hasVisibleStroke =
    Array.isArray(node.strokes) &&
    node.strokes.some((s) => s.visible !== false) &&
    (node.strokeWeight === undefined || node.strokeWeight > 0);
  return hasVisibleFill || hasVisibleEffect || hasVisibleStroke;
}

function isComponentControlledVisibility(node: FigmaNode): boolean {
  // If `.visible` is bound to a component boolean property, it's an intentional
  // toggleable state (e.g. a `loading` prop showing a spinner), not dead weight.
  return Boolean(node.componentPropertyReferences?.visible);
}

interface ScanCtx {
  ancestors: string[];
  topLevelFrameId: string;
  topLevelFrameName: string;
}

function scanNode(node: FigmaNode, ctx: ScanCtx, issues: StructureIssue[]): void {
  // Organisational containers — pass through to children, don't flag the wrapper.
  if (PASSTHROUGH_TYPES.has(node.type)) {
    for (const child of node.children ?? []) {
      scanNode(child, { ...ctx, ancestors: [...ctx.ancestors, node.name] }, issues);
    }
    return;
  }

  if (node.locked) return;
  if (hasIntentionalMarkers(node)) return;

  const path = ctx.ancestors.join(' › ');
  const base = {
    path,
    topLevelFrameId: ctx.topLevelFrameId,
    topLevelFrameName: ctx.topLevelFrameName,
  };

  // Hidden layer — check BEFORE SKIP_TYPES so hidden instances are still caught.
  if (node.visible === false) {
    if (!isComponentControlledVisibility(node)) {
      issues.push({ nodeId: node.id, nodeName: node.name, nodeType: node.type, kind: 'hidden', ...base });
    }
    return;  // no recursion — invisibility cascades
  }

  // After visibility: skip instances and boolean-op children.
  if (SKIP_TYPES.has(node.type)) return;

  const children = node.children ?? [];

  // Empty container — but skip leaf visuals (background blocks, etc.) that
  // have visible fills/strokes/effects. They render on their own and aren't
  // dead weight. Mirrors Handover plugin scanner.
  if (CONTAINER_TYPES.has(node.type) && children.length === 0 && !isVisualLeaf(node)) {
    issues.push({ nodeId: node.id, nodeName: node.name, nodeType: node.type, kind: 'empty-container', ...base });
  }

  for (const child of children) {
    scanNode(child, { ...ctx, ancestors: [...ctx.ancestors, node.name] }, issues);
  }
}

export function checkStructure(document: FigmaNode): StructureIssue[] {
  const issues: StructureIssue[] = [];
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
