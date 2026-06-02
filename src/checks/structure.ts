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
import { readyFrames } from './dev-filter.ts';

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


export function checkStructure(document: FigmaNode): StructureIssue[] {
  const result: StructureIssue[] = [];

  for (const page of document.children ?? []) {
    // Only audit frames/sections marked "Ready for dev" by the designer.
    for (const { frame } of readyFrames(page)) {
      const ruleNode = toRuleNode(frame);
      const issues = scanStructure(ruleNode);
      const tlf = { topLevelFrameId: frame.id, topLevelFrameName: frame.name };
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

  return result;
}
