// Detects structural issues using the shared handover-rules detection package.
// Detection logic lives in packages/handover-rules/src/scan.ts; this file
// adapts the REST API's FigmaNode to RuleNode and re-maps the shared
// IssueType vocabulary to the audit's StructureIssue shape.
//
// Vocabulary alignment (D3): the shared package uses 'hidden-layer'; the
// audit previously used 'hidden'. Both now use 'hidden-layer' so the plugin
// and audit speak the same language.

import { scanStructure } from '@rules/scan.ts';
import type { IssueType } from '@rules/node.ts';
import type { FigmaNode } from '../api/types.ts';
import { toRuleNode } from './rule-adapter.ts';

// Re-export the shared IssueType directly so callers get one vocabulary.
export type StructureIssueKind = IssueType;

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

// Walk up the RuleNode parent chain to reconstruct the breadcrumb path.
// The shared scan already stores path on Issue, but the audit also needs
// topLevelFrame info which we derive from the document walk below.
function getTopLevelFrame(
  page: FigmaNode,
  topLevelNode: FigmaNode,
): { topLevelFrameId: string; topLevelFrameName: string } {
  return { topLevelFrameId: topLevelNode.id, topLevelFrameName: topLevelNode.name };
}

export function checkStructure(document: FigmaNode): StructureIssue[] {
  const result: StructureIssue[] = [];

  for (const page of document.children ?? []) {
    for (const topNode of page.children ?? []) {
      if (topNode.type === 'SECTION') {
        // Sections are screen-grouping containers. Treat each child as a
        // top-level screen for pinning purposes.
        for (const child of topNode.children ?? []) {
          const ruleNode = toRuleNode(child);
          const issues = scanStructure(ruleNode);
          const tlf = { topLevelFrameId: child.id, topLevelFrameName: child.name };
          for (const issue of issues) {
            result.push({
              nodeId: issue.id,
              nodeName: issue.name,
              nodeType: issue.nodeType,
              kind: issue.type,
              path: issue.path,
              ...tlf,
            });
          }
        }
      } else {
        const ruleNode = toRuleNode(topNode);
        const issues = scanStructure(ruleNode);
        const tlf = getTopLevelFrame(page, topNode);
        for (const issue of issues) {
          result.push({
            nodeId: issue.id,
            nodeName: issue.name,
            nodeType: issue.nodeType,
            kind: issue.type,
            path: issue.path,
            ...tlf,
          });
        }
      }
    }
  }

  return result;
}
