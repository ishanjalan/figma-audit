// Detects layer naming issues using the shared handover-rules detection package.
// Detection logic lives in packages/handover-rules/src/scan.ts; this file
// adapts the REST FigmaNode tree and maps shared NameDetection to the audit's
// NameIssue shape.
//
// The shared detectName function covers: 'default' (generic Figma names),
// 'low-info', 'copy-suffix', 'short', 'duplicate-sibling', 'non-standard-case',
// 'smart-animate-match'. The audit previously only surfaced 'generic-name' and
// 'non-standard-case'; now it surfaces all shared reasons via this bridge.

import { detectName, findDuplicateSiblings } from '@rules/scan.ts';
import type { NameReason } from '@rules/node.ts';
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

interface ScanCtx {
  ancestors: string[];
  topLevelFrameId: string;
  topLevelFrameName: string;
}

function scanNode(node: FigmaNode, ctx: ScanCtx, issues: NameIssue[]): void {
  if (node.locked) return;
  if (node.reactions && node.reactions.length > 0) return;
  if (node.exportSettings && node.exportSettings.length > 0) return;
  if (node.annotations && node.annotations.length > 0) return;

  const path = ctx.ancestors.join(' › ');
  const ruleNode = toRuleNode(node);
  const detection = detectName(ruleNode);

  if (detection) {
    issues.push({
      nodeId: node.id,
      nodeName: node.name,
      nodeType: node.type,
      reason: detection.reason,
      path,
      topLevelFrameId: ctx.topLevelFrameId,
      topLevelFrameName: ctx.topLevelFrameName,
    });
  }

  // Don't recurse into instance or boolean-op internals.
  if (node.type === 'INSTANCE' || node.type === 'BOOLEAN_OPERATION') return;

  const childCtx = { ...ctx, ancestors: [...ctx.ancestors, node.name] };
  for (const child of node.children ?? []) {
    scanNode(child, childCtx, issues);
  }
}

export function checkNames(document: FigmaNode): NameIssue[] {
  const issues: NameIssue[] = [];

  for (const page of document.children ?? []) {
    for (const topNode of page.children ?? []) {
      if (topNode.type === 'SECTION') {
        for (const child of topNode.children ?? []) {
          scanNode(
            child,
            {
              ancestors: [page.name, topNode.name],
              topLevelFrameId: child.id,
              topLevelFrameName: child.name,
            },
            issues,
          );
        }
      } else {
        scanNode(
          topNode,
          {
            ancestors: [page.name],
            topLevelFrameId: topNode.id,
            topLevelFrameName: topNode.name,
          },
          issues,
        );
      }
    }
  }

  // Duplicate-sibling detection: the shared findDuplicateSiblings operates on
  // full RuleNode subtrees. Run it on each top-level frame to surface duplicates.
  for (const page of document.children ?? []) {
    for (const topNode of page.children ?? []) {
      const ruleNode = toRuleNode(topNode);
      const dups = findDuplicateSiblings(ruleNode);
      for (const dup of dups) {
        // Only add if not already reported by the scan above (detectName also
        // catches duplicate-sibling as a reason).
        if (!issues.find((i) => i.nodeId === dup.node.id && i.reason === 'duplicate-sibling')) {
          issues.push({
            nodeId: dup.node.id,
            nodeName: dup.node.name,
            nodeType: dup.node.type,
            reason: 'duplicate-sibling',
            path: dup.node.parent ? dup.node.parent.name : '',
            topLevelFrameId: topNode.id,
            topLevelFrameName: topNode.name,
          });
        }
      }
    }
  }

  return issues;
}
