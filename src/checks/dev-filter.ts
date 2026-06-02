// Utilities for filtering Figma nodes by "Ready for dev" status.
//
// Figma allows designers to mark frames and sections with a devStatus:
//   - 'READY_FOR_DEV'  — the design is ready to be implemented
//   - 'COMPLETED'      — implementation is done
//
// The audit only processes READY_FOR_DEV frames (nodes without devStatus, or
// with COMPLETED, are not flagged — they're either not ready yet or already done).
//
// Inheritance rules:
//   - A SECTION marked READY_FOR_DEV → all its child frames are included.
//   - A SECTION with no status (or COMPLETED) → only its children that are
//     individually marked READY_FOR_DEV are included.
//   - A top-level frame with no enclosing section → must be marked itself.

import type { FigmaNode } from '../api/types.ts';

export function isReadyForDev(node: FigmaNode): boolean {
  return node.devStatus?.type === 'READY_FOR_DEV';
}

/**
 * Yield the top-level "screen" nodes that should be audited.
 * Each yielded entry is { frame, sectionName? } — sectionName is set when
 * the frame lives inside a READY_FOR_DEV section (for richer error messages).
 */
export function* readyFrames(
  page: FigmaNode,
): Generator<{ frame: FigmaNode; sectionName?: string }> {
  for (const topNode of page.children ?? []) {
    if (topNode.type === 'SECTION') {
      if (isReadyForDev(topNode)) {
        // Whole section is ready — include every child frame.
        for (const child of topNode.children ?? []) {
          yield { frame: child, sectionName: topNode.name };
        }
      } else {
        // Section not marked — fall through to per-frame status check.
        for (const child of topNode.children ?? []) {
          if (isReadyForDev(child)) {
            yield { frame: child, sectionName: topNode.name };
          }
        }
      }
    } else {
      // Top-level frame (not in a section) — must be individually marked.
      if (isReadyForDev(topNode)) {
        yield { frame: topNode };
      }
    }
  }
}
