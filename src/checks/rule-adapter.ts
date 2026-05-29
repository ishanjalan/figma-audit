// Maps REST API FigmaNode objects to the API-agnostic RuleNode used by handover-rules.
// Runs in Node.js — no Figma sandbox globals needed.
//
// Coordinate system: absoluteBoundingBox gives canvas-absolute coords. The shared
// predicates (isPassthroughFrame, isWrapperFrame, isRedundantFrame,
// isCompletelyOutOfBounds) use local parent-relative x/y, so we subtract the
// parent's absoluteBoundingBox origin when descending the tree.

import type { RuleNode, RulePaint, RuleEffect, RuleReaction, NodeKind } from '@rules/node.ts';
import type { FigmaNode } from '../api/types.ts';

type BB = { x: number; y: number; width: number; height: number };

function extractFills(node: FigmaNode): RulePaint[] {
  if (!Array.isArray(node.fills)) return [];
  return node.fills.map((f) => ({
    type: f.type,
    visible: f.visible,
    opacity: f.opacity,
  }));
}

function extractEffects(node: FigmaNode): RuleEffect[] {
  if (!Array.isArray(node.effects)) return [];
  return node.effects.map((e) => ({ type: e.type, visible: e.visible }));
}

function extractReactions(node: FigmaNode): RuleReaction[] {
  if (!Array.isArray(node.reactions)) return [];
  // REST reactions are untyped unknowns — cast structurally.
  // handover-rules only reads .action.type / .action.transition.type.
  return node.reactions as RuleReaction[];
}

function buildRuleNode(node: FigmaNode, parentBB: BB | null): RuleNode {
  const bb = node.absoluteBoundingBox;

  // Local coordinates: subtract parent origin so isCompletelyOutOfBounds works.
  const x = bb && parentBB ? bb.x - parentBB.x : (bb?.x ?? 0);
  const y = bb && parentBB ? bb.y - parentBB.y : (bb?.y ?? 0);
  const width = bb?.width ?? 0;
  const height = bb?.height ?? 0;

  const rn: RuleNode = {
    id: node.id,
    name: node.name,
    type: node.type as NodeKind,
    visible: node.visible ?? true,
    locked: node.locked ?? false,
    opacity: node.opacity ?? 1,
    blendMode: node.blendMode,

    x,
    y,
    width,
    height,
    rotation: node.rotation ?? 0,

    layoutMode: (node.layoutMode as RuleNode['layoutMode']) ?? 'NONE',
    layoutSizingHorizontal: node.layoutSizingHorizontal as RuleNode['layoutSizingHorizontal'],
    layoutSizingVertical: node.layoutSizingVertical as RuleNode['layoutSizingVertical'],
    layoutPositioning: node.layoutPositioning,
    paddingTop: node.paddingTop ?? 0,
    paddingRight: node.paddingRight ?? 0,
    paddingBottom: node.paddingBottom ?? 0,
    paddingLeft: node.paddingLeft ?? 0,
    constraints: node.constraints,
    overflowDirection: undefined, // not exposed in REST response
    clipsContent: node.clipsContent ?? false,

    fills: extractFills(node),
    strokes: (node.strokes ?? []).map((s) => ({ type: s.type, visible: s.visible })),
    strokeWeight: typeof node.strokeWeight === 'number' ? node.strokeWeight : undefined,
    effects: extractEffects(node),
    cornerRadius: typeof node.cornerRadius === 'number' ? node.cornerRadius : undefined,
    isMask: node.isMask,

    reactions: extractReactions(node),
    exportSettings: Array.isArray(node.exportSettings) ? [...node.exportSettings] : [],
    annotations: Array.isArray(node.annotations) ? [...node.annotations] : [],
    componentPropertyReferences: node.componentPropertyReferences,

    // INSTANCE: REST uses componentId, shared uses mainComponentId.
    // null = detached (master deleted), undefined = not an instance.
    mainComponentId: node.type === 'INSTANCE'
      ? (node.componentId !== undefined ? (node.componentId ?? null) : null)
      : undefined,

    // TEXT characters: not available in the default REST file response.
    characters: undefined,

    // VECTOR vertex count: not in REST API — shared rule skips empty-vector when undefined.
    vectorVertexCount: undefined,

    parent: null, // filled after construction
    children: [],
  };

  // Build children with this node's bb as the new parent origin.
  if (Array.isArray(node.children)) {
    rn.children = node.children.map((child) => {
      const childRn = buildRuleNode(child, bb ?? null);
      childRn.parent = rn;
      return childRn;
    });
  }

  return rn;
}

// Convert a REST FigmaNode tree rooted at a page child (frame / section / etc.)
// to a fully-wired RuleNode tree. The root has no parent (null).
export function toRuleNode(node: FigmaNode): RuleNode {
  const rn = buildRuleNode(node, null);
  return rn;
}
