// Detects layer naming issues using the shared handover-rules detection package.
// Detection logic lives in packages/handover-rules/src/scan.ts; this file
// adapts the REST FigmaNode tree and maps shared NameDetection to the audit's
// NameIssue shape.
//
// Performance: the RuleNode tree is built ONCE per top-level frame via
// toRuleNode(), then the already-wired tree is walked. This gives O(n) work
// instead of the O(n²) that would result from calling toRuleNode() per node.
// It also means every node has a correct parent chain, so isInSmartAnimateFrame
// and isInsideComponent work correctly during detectName().

import { detectName, findDuplicateSiblings } from '@rules/scan.ts';
import type { RuleNode, NameReason } from '@rules/node.ts';
import type { FigmaNode } from '../api/types.ts';
import { toRuleNode } from './rule-adapter.ts';

// Re-export the shared NameReason so callers get the full vocabulary.
export type NameIssueReason = NameReason;

export interface NameIssue {
  nodeId: string;
  nodeName: string;
  nodeType: string;
  reason: NameIssueReason;
  path: string;
  topLevelFrameId: string;
  topLevelFrameName: string;
}

// Build a breadcrumb path by walking the pre-wired RuleNode parent chain.
function pathFromParents(node: RuleNode): string {
  const parts: string[] = [];
  let cur = node.parent;
  while (cur) {
    parts.unshift(cur.name);
    cur = cur.parent;
  }
  return parts.join(' › ');
}

interface TLF { topLevelFrameId: string; topLevelFrameName: string }

// Walk a pre-built, fully parent-wired RuleNode tree. detectName() receives
// correct parent context so SA-frame and inside-component guards work.
function walkRuleNode(node: RuleNode, tlf: TLF, issues: NameIssue[]): void {
  if (node.locked) return;
  if (node.reactions.length > 0) return;
  if (node.exportSettings.length > 0) return;
  if (node.annotations.length > 0) return;

  const detection = detectName(node);
  if (detection) {
    issues.push({
      nodeId: node.id,
      nodeName: node.name,
      nodeType: node.type,
      reason: detection.reason,
      path: pathFromParents(node),
      ...tlf,
    });
  }

  // Don't recurse into instance or boolean-op internals.
  if (node.type === 'INSTANCE' || node.type === 'BOOLEAN_OPERATION') return;

  for (const child of node.children) {
    walkRuleNode(child, tlf, issues);
  }
}

// Append duplicate-sibling issues that detectName() didn't already surface.
// findDuplicateSiblings uses the pre-built tree — no extra toRuleNode() call.
function addDuplicateSiblingIssues(root: RuleNode, tlf: TLF, issues: NameIssue[]): void {
  const dups = findDuplicateSiblings(root);
  for (const dup of dups) {
    if (!issues.find((i) => i.nodeId === dup.node.id && i.reason === 'duplicate-sibling')) {
      issues.push({
        nodeId: dup.node.id,
        nodeName: dup.node.name,
        nodeType: dup.node.type,
        reason: 'duplicate-sibling',
        path: pathFromParents(dup.node),
        ...tlf,
      });
    }
  }
}

export function checkNames(document: FigmaNode): NameIssue[] {
  const issues: NameIssue[] = [];

  for (const page of document.children ?? []) {
    for (const topNode of page.children ?? []) {
      if (topNode.type === 'SECTION') {
        for (const child of topNode.children ?? []) {
          // Build the RuleNode tree once; reuse it for both detection and dup-sibling.
          const root = toRuleNode(child);
          const tlf: TLF = { topLevelFrameId: child.id, topLevelFrameName: child.name };
          walkRuleNode(root, tlf, issues);
          addDuplicateSiblingIssues(root, tlf, issues);
        }
      } else {
        const root = toRuleNode(topNode);
        const tlf: TLF = { topLevelFrameId: topNode.id, topLevelFrameName: topNode.name };
        walkRuleNode(root, tlf, issues);
        addDuplicateSiblingIssues(root, tlf, issues);
      }
    }
  }

  return issues;
}
