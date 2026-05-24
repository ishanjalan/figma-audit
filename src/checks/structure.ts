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

function isComponentControlledVisibility(node: FigmaNode): boolean {
  // If `.visible` is bound to a component boolean property, it's an intentional
  // toggleable state (e.g. a `loading` prop showing a spinner), not dead weight.
  return Boolean(node.componentPropertyReferences?.visible);
}

function scanNode(
  node: FigmaNode,
  ancestors: string[],
  issues: StructureIssue[],
): void {
  // Organisational containers — pass through to children, don't flag the wrapper.
  if (PASSTHROUGH_TYPES.has(node.type)) {
    for (const child of node.children ?? []) {
      scanNode(child, [...ancestors, node.name], issues);
    }
    return;
  }

  if (node.locked) return;
  if (hasIntentionalMarkers(node)) return;

  const path = ancestors.join(' › ');

  // Hidden layer — check BEFORE SKIP_TYPES so hidden instances are still caught.
  if (node.visible === false) {
    if (!isComponentControlledVisibility(node)) {
      issues.push({ nodeId: node.id, nodeName: node.name, nodeType: node.type, kind: 'hidden', path });
    }
    return;  // no recursion — invisibility cascades
  }

  // After visibility: skip instances and boolean-op children.
  if (SKIP_TYPES.has(node.type)) return;

  const children = node.children ?? [];

  // Empty container.
  if (CONTAINER_TYPES.has(node.type) && children.length === 0) {
    issues.push({ nodeId: node.id, nodeName: node.name, nodeType: node.type, kind: 'empty-container', path });
  }

  for (const child of children) {
    scanNode(child, [...ancestors, node.name], issues);
  }
}

export function checkStructure(document: FigmaNode): StructureIssue[] {
  const issues: StructureIssue[] = [];
  for (const page of document.children ?? []) {
    for (const node of page.children ?? []) {
      scanNode(node, [page.name], issues);
    }
  }
  return issues;
}
