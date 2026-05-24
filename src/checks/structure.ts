// Detects structural issues: hidden layers, empty containers, and deep nesting.
import type { FigmaNode } from '../api/types.ts';

export type StructureIssueKind = 'hidden' | 'empty-container' | 'deep-nesting';

export interface StructureIssue {
  nodeId: string;
  nodeName: string;
  nodeType: string;
  kind: StructureIssueKind;
  depth?: number;
  path: string;
}

const CONTAINER_TYPES = new Set(['FRAME', 'GROUP', 'SECTION', 'COMPONENT', 'COMPONENT_SET']);
const MAX_NESTING_DEPTH = 5;

function scanNode(
  node: FigmaNode,
  ancestors: string[],
  depth: number,
  issues: StructureIssue[],
): void {
  if (node.locked) return;

  const path = ancestors.join(' › ');

  // Hidden layer — no point recursing into invisible subtree.
  if (node.visible === false) {
    issues.push({ nodeId: node.id, nodeName: node.name, nodeType: node.type, kind: 'hidden', path });
    return;
  }

  // Deep nesting — flag the node but still recurse to catch deeper issues.
  if (depth > MAX_NESTING_DEPTH) {
    issues.push({ nodeId: node.id, nodeName: node.name, nodeType: node.type, kind: 'deep-nesting', depth, path });
  }

  const children = node.children ?? [];

  // Empty container.
  if (CONTAINER_TYPES.has(node.type) && children.length === 0) {
    issues.push({ nodeId: node.id, nodeName: node.name, nodeType: node.type, kind: 'empty-container', path });
  }

  for (const child of children) {
    scanNode(child, [...ancestors, node.name], depth + 1, issues);
  }
}

export function checkStructure(document: FigmaNode): StructureIssue[] {
  const issues: StructureIssue[] = [];
  for (const page of document.children ?? []) {
    for (const node of page.children ?? []) {
      scanNode(node, [page.name], 0, issues);
    }
  }
  return issues;
}
