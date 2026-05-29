// Detects structural issues: hidden layers, empty containers, detached instances,
// and redundant-nesting patterns (single-child groups, passthrough frames, wrapper
// frames, redundant frames, groups inside auto-layout).
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
// groups, groups-in-autolayout) via its Clean tab; the checks below mirror
// exactly that per-node detection.
import type { FigmaNode } from '../api/types.ts';

export type StructureIssueKind =
  | 'hidden'
  | 'empty-container'
  | 'detached-instance'
  | 'single-child-group'
  | 'passthrough-frame'
  | 'wrapper-frame'
  | 'redundant-frame'
  | 'group-in-autolayout';

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

// SECTION and COMPONENT_SET are organisational wrappers — pass through to
// children without flagging the container itself.
const PASSTHROUGH_TYPES = new Set(['SECTION', 'COMPONENT_SET']);

// ── Visual-identity helpers ────────────────────────────────────────────────────
// These mirror Handover plugin's scanner.ts helpers.

function hasVisibleFill(node: FigmaNode): boolean {
  return Array.isArray(node.fills) && node.fills.some((f) => f.visible !== false);
}

function hasStroke(node: FigmaNode): boolean {
  return (
    Array.isArray(node.strokes) &&
    node.strokes.some((s) => s.visible !== false) &&
    (node.strokeWeight === undefined || node.strokeWeight > 0)
  );
}

function hasEffects(node: FigmaNode): boolean {
  return Array.isArray(node.effects) && node.effects.some((e) => e.visible !== false);
}

// A childless frame/group that has visible fills, strokes, or effects is a
// leaf visual element (background block, image fill, decorative divider).
// It renders something on its own — NOT actually empty, leave it alone.
function isVisualLeaf(node: FigmaNode): boolean {
  return hasVisibleFill(node) || hasStroke(node) || hasEffects(node);
}

// ── Frame-nesting detectors (port of plugin scanner.ts) ───────────────────────
//
// The REST API doesn't have parent references, so we pass parent explicitly.
// Absolute positions (absoluteBoundingBox) substitute for local x/y/width/height
// where same-frame comparisons are needed (wrapper Tier A, lossless AL).

// Returns true when two bounding boxes are the same within 0.5 px on all axes.
function bbMatch(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return (
    Math.abs(a.x - b.x) < 0.5 &&
    Math.abs(a.y - b.y) < 0.5 &&
    Math.abs(a.width - b.width) < 0.5 &&
    Math.abs(a.height - b.height) < 0.5
  );
}

// A frame is a passthrough when it is a transparent auto-layout wrapper sitting
// inside another auto-layout frame with the same layout direction.
// Mirrors isPassthroughFrame in plugin scanner.ts.
function isPassthroughFrame(node: FigmaNode, parent: FigmaNode): boolean {
  if (node.type !== 'FRAME') return false;
  if (!node.layoutMode || node.layoutMode === 'NONE') return false;
  if (!node.children || node.children.length !== 1) return false;
  if (isVisualLeaf(node)) return false;
  if ((node.opacity ?? 1) !== 1) return false;
  if (node.clipsContent) return false;
  if (
    (node.paddingTop ?? 0) !== 0 || (node.paddingBottom ?? 0) !== 0 ||
    (node.paddingLeft ?? 0) !== 0 || (node.paddingRight ?? 0) !== 0
  ) return false;

  if (parent.type !== 'FRAME') return false;
  if (!parent.layoutMode || parent.layoutMode === 'NONE') return false;
  if (parent.layoutMode !== node.layoutMode) return false;

  if (node.layoutPositioning === 'ABSOLUTE') return false;

  const h = node.layoutSizingHorizontal;
  const v = node.layoutSizingVertical;
  if (h === 'FIXED' || v === 'FIXED') return false;

  const child = node.children[0];
  const ch = child.layoutSizingHorizontal;
  const cv = child.layoutSizingVertical;
  if (!ch || !cv) return false;

  const axisSafe = (w: string, c: string): boolean =>
    w === 'HUG' ? c === 'HUG' || c === 'FIXED' : c === 'FILL';
  if (!axisSafe(h ?? 'HUG', ch) || !axisSafe(v ?? 'HUG', cv)) return false;

  return true;
}

// A wrapper frame is a non-auto-layout FRAME with no visual chrome acting as a
// positional wrapper for its children.
// Mirrors isWrapperFrame in plugin scanner.ts.
function isWrapperFrame(node: FigmaNode, parent: FigmaNode): boolean {
  if (node.type !== 'FRAME') return false;
  if (node.layoutMode && node.layoutMode !== 'NONE') return false;
  if (!node.children || node.children.length === 0) return false;
  if (isVisualLeaf(node)) return false;
  if ((node.opacity ?? 1) !== 1) return false;
  if (node.clipsContent) return false;
  if ((node.rotation ?? 0) !== 0) return false;

  if (parent.type !== 'FRAME') return false;
  if (parent.layoutMode && parent.layoutMode !== 'NONE') return false;
  if ((parent.rotation ?? 0) !== 0) return false;

  // Tier A: frame fills parent exactly (compare absolute bounding boxes).
  const nb = node.absoluteBoundingBox;
  const pb = parent.absoluteBoundingBox;
  if (nb && pb && bbMatch(nb, pb)) return true;

  // Tier B: all children have MIN×MIN constraints.
  return node.children.every(
    (child) => child.constraints?.horizontal === 'MIN' && child.constraints?.vertical === 'MIN',
  );
}

// Child exactly fills the wrapper, and the wrapper's auto-layout sizing can be
// transferred to the child without changing its resolved size.
// Mirrors isLosslessInAutoLayout in plugin scanner.ts.
function isLosslessInAutoLayout(node: FigmaNode): boolean {
  if (!node.children || node.children.length !== 1) return false;
  const child = node.children[0];

  const nb = node.absoluteBoundingBox;
  const cb = child.absoluteBoundingBox;
  if (!nb || !cb) return false;
  if (!bbMatch(nb, cb)) return false;

  if (node.layoutPositioning === 'ABSOLUTE') return false;

  const wh = node.layoutSizingHorizontal;
  const wv = node.layoutSizingVertical;
  const chS = child.layoutSizingHorizontal;
  const cvS = child.layoutSizingVertical;
  if (!chS || !cvS) return false;

  const axisSafe = (w: string, c: string): boolean =>
    w === 'FIXED' ? true : w === 'HUG' ? c === 'HUG' || c === 'FIXED' : c === 'FILL';
  if (!axisSafe(wh ?? 'HUG', chS) || !axisSafe(wv ?? 'HUG', cvS)) return false;

  return true;
}

// A single-child FRAME with no visual identity — the mixed-layout gap that
// isPassthroughFrame and isWrapperFrame deliberately skip.
// Mirrors isRedundantFrame in plugin scanner.ts.
function isRedundantFrame(node: FigmaNode, parent: FigmaNode): boolean {
  if (node.type !== 'FRAME') return false;
  if (!node.children || node.children.length !== 1) return false;
  if (isVisualLeaf(node)) return false;
  if ((node.opacity ?? 1) !== 1) return false;
  if (node.clipsContent) return false;
  if ((node.rotation ?? 0) !== 0) return false;
  if (typeof node.cornerRadius === 'number' && node.cornerRadius > 0) return false;
  if (
    (node.paddingTop ?? 0) !== 0 || (node.paddingBottom ?? 0) !== 0 ||
    (node.paddingLeft ?? 0) !== 0 || (node.paddingRight ?? 0) !== 0
  ) return false;
  if (node.layoutPositioning === 'ABSOLUTE') return false;

  // Dedicated safer fixers handle these — don't double-flag.
  if (isPassthroughFrame(node, parent) || isWrapperFrame(node, parent)) return false;

  if (parent.type === 'GROUP') return true;
  if (parent.type === 'FRAME' || parent.type === 'COMPONENT') {
    if (!parent.layoutMode || parent.layoutMode === 'NONE') return true;
    // Auto-layout parent: only safe when provably lossless.
    return isLosslessInAutoLayout(node);
  }
  return false;
}

// ── Skip-signal helpers ────────────────────────────────────────────────────────

function hasIntentionalMarkers(node: FigmaNode): boolean {
  if (node.reactions && node.reactions.length > 0) return true;
  if (node.exportSettings && node.exportSettings.length > 0) return true;
  if (node.annotations && node.annotations.length > 0) return true;
  return false;
}

function isComponentControlledVisibility(node: FigmaNode): boolean {
  // If `.visible` is bound to a component boolean property, it's an intentional
  // toggleable state (e.g. a `loading` prop showing a spinner), not dead weight.
  return Boolean(node.componentPropertyReferences?.visible);
}

// ── Scanner ────────────────────────────────────────────────────────────────────

interface ScanCtx {
  ancestors: string[];
  topLevelFrameId: string;
  topLevelFrameName: string;
}

function scanNode(
  node: FigmaNode,
  parent: FigmaNode | null,
  ctx: ScanCtx,
  issues: StructureIssue[],
): void {
  // Organisational containers — pass through to children, don't flag the wrapper.
  if (PASSTHROUGH_TYPES.has(node.type)) {
    for (const child of node.children ?? []) {
      scanNode(child, node, { ...ctx, ancestors: [...ctx.ancestors, node.name] }, issues);
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

  // Hidden layer — checked before instance/boolean guards so hidden instances are caught.
  if (node.visible === false) {
    if (!isComponentControlledVisibility(node)) {
      issues.push({ nodeId: node.id, nodeName: node.name, nodeType: node.type, kind: 'hidden', ...base });
    }
    return;  // no recursion — invisibility cascades
  }

  // After visibility: check instances before skipping their internals.
  if (node.type === 'INSTANCE') {
    // A missing/null componentId means the master component was deleted —
    // this is an orphaned (detached) instance that will break in dev inspect.
    if (!node.componentId) {
      issues.push({ nodeId: node.id, nodeName: node.name, nodeType: node.type, kind: 'detached-instance', ...base });
    }
    return; // never recurse into instance internals
  }
  if (node.type === 'BOOLEAN_OPERATION') return;

  const children = node.children ?? [];
  const childCtx = { ...ctx, ancestors: [...ctx.ancestors, node.name] };

  if (CONTAINER_TYPES.has(node.type)) {
    // Empty container — leaf visual elements (background blocks, image fills, etc.)
    // render on their own and aren't dead weight. Leave them alone.
    if (children.length === 0) {
      if (!isVisualLeaf(node)) {
        issues.push({ nodeId: node.id, nodeName: node.name, nodeType: node.type, kind: 'empty-container', ...base });
      }
      return;
    }

    // Single-child GROUP with no mask and neutral blend — the group wrapper is
    // pure overhead. Guards mirror the plugin: skip mask groups, groups with
    // group-level opacity/blend/effects (would silently drop them on dissolve).
    if (
      node.type === 'GROUP' &&
      children.length === 1 &&
      !node.isMask &&
      !children[0].isMask &&
      (node.opacity ?? 1) === 1 &&
      (!node.blendMode || node.blendMode === 'NORMAL') &&
      !hasEffects(node)
    ) {
      issues.push({ nodeId: node.id, nodeName: node.name, nodeType: node.type, kind: 'single-child-group', ...base });
      scanNode(children[0], node, childCtx, issues);
      return;
    }

    // Auto-layout passthrough frame.
    if (parent && isPassthroughFrame(node, parent)) {
      issues.push({ nodeId: node.id, nodeName: node.name, nodeType: node.type, kind: 'passthrough-frame', ...base });
      scanNode(children[0], node, childCtx, issues);
      return;
    }

    // Wrapper frame.
    if (parent && isWrapperFrame(node, parent)) {
      issues.push({ nodeId: node.id, nodeName: node.name, nodeType: node.type, kind: 'wrapper-frame', ...base });
      for (const child of children) {
        scanNode(child, node, childCtx, issues);
      }
      return;
    }

    // Redundant single-child frame (mixed-layout gap or non-AL parent).
    if (parent && isRedundantFrame(node, parent)) {
      issues.push({ nodeId: node.id, nodeName: node.name, nodeType: node.type, kind: 'redundant-frame', ...base });
      scanNode(children[0], node, childCtx, issues);
      return;
    }

    // GROUP inside an auto-layout frame. Groups don't participate in AL sizing
    // and behave as fixed HUG containers, breaking the layout math. Guards mirror
    // the plugin: skip mask groups, ABSOLUTE overlays, groups with opacity/blend/effects.
    if (
      node.type === 'GROUP' &&
      parent &&
      parent.type === 'FRAME' &&
      parent.layoutMode &&
      parent.layoutMode !== 'NONE' &&
      node.layoutPositioning !== 'ABSOLUTE' &&
      !node.isMask &&
      !children.some((c) => c.isMask) &&
      (node.opacity ?? 1) === 1 &&
      (!node.blendMode || node.blendMode === 'NORMAL') &&
      !hasEffects(node)
    ) {
      issues.push({ nodeId: node.id, nodeName: node.name, nodeType: node.type, kind: 'group-in-autolayout', ...base });
      for (const child of children) {
        scanNode(child, node, childCtx, issues);
      }
      return;
    }
  }

  for (const child of children) {
    scanNode(child, node, childCtx, issues);
  }
}

export function checkStructure(document: FigmaNode): StructureIssue[] {
  const issues: StructureIssue[] = [];
  for (const page of document.children ?? []) {
    for (const node of page.children ?? []) {
      if (node.type === 'SECTION') {
        // Sections are screen-grouping containers — skip the section itself and
        // treat each child frame as a top-level screen for pinning purposes.
        for (const child of node.children ?? []) {
          scanNode(
            child,
            null, // top-level frames have no relevant parent for these checks
            { ancestors: [page.name, node.name], topLevelFrameId: child.id, topLevelFrameName: child.name },
            issues,
          );
        }
      } else {
        scanNode(
          node,
          null,
          { ancestors: [page.name], topLevelFrameId: node.id, topLevelFrameName: node.name },
          issues,
        );
      }
    }
  }
  return issues;
}
