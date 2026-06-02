/**
 * Minimal Figma document tree for testing checkNames.
 *
 * All top-level frames are marked READY_FOR_DEV so they pass the dev-status
 * filter. One frame (skip-names) is deliberately left without devStatus to
 * verify the filter excludes it.
 *
 * Scenarios covered:
 *  - Frame with auto-generated name + auto-layout → SHOULD flag (default)
 *  - Frame with PascalCase name → SHOULD NOT flag
 *  - Frame with auto-generated name containing a TEXT child → SHOULD flag
 *  - Locked node → SHOULD NOT flag
 *  - Node with reactions → SHOULD NOT flag (intentional marker)
 *  - Top-level frame with auto-generated name → SHOULD flag
 *  - FRAME with non-PascalCase human-given name → SHOULD flag (non-standard-case)
 *  - Node inside Smart Animate frame → SHOULD NOT flag non-standard-case
 *  - Frame without devStatus → SHOULD NOT appear in issues (filtered out)
 */

import type { FigmaNode } from '../../../api/types.ts';

const rfd = { devStatus: { type: 'READY_FOR_DEV' as const } };

export const nameFixture: FigmaNode = {
  id: 'doc',
  name: 'Document',
  type: 'DOCUMENT',
  children: [
    {
      id: 'page1',
      name: 'Page 1',
      type: 'CANVAS',
      children: [
        // ✅ Should flag: auto-layout frame with generic name
        { id: 'f1', ...rfd, name: 'Frame 1', type: 'FRAME', layoutMode: 'VERTICAL', children: [] },

        // ✅ Should flag: top-level frame with generic name (isTopLevel = true)
        { id: 'f2', ...rfd, name: 'Frame 2', type: 'FRAME', children: [] },

        // ✅ Should flag: frame with a TEXT child (within 3 levels)
        {
          id: 'f3', ...rfd,
          name: 'Group 1',
          type: 'GROUP',
          children: [
            { id: 'txt1', name: 'Button label', type: 'TEXT', children: [] },
          ],
        },

        // ❌ Should NOT flag: already PascalCase name
        { id: 'f4', ...rfd, name: 'HeroBanner', type: 'FRAME', layoutMode: 'HORIZONTAL', children: [] },

        // ✅ Should flag non-standard-case: FRAME with human-given non-PascalCase name
        { id: 'f10', ...rfd, name: 'hero cta', type: 'FRAME', layoutMode: 'HORIZONTAL', children: [] },

        // ❌ Should NOT flag non-standard-case: top-level frame has Smart Animate reaction
        {
          id: 'sa-frame', ...rfd,
          name: 'SmartAnimateScreen',
          type: 'FRAME',
          reactions: [{ action: { type: 'NODE', transition: { type: 'SMART_ANIMATE' } } }],
          children: [
            { id: 'sa-child', name: 'card layout', type: 'FRAME', layoutMode: 'VERTICAL', children: [] },
          ],
        },

        // D1: Rectangle with generic name IS flagged (detection is authoritative)
        { id: 'f5', ...rfd, name: 'Rectangle 1', type: 'RECTANGLE', children: [] },

        // ❌ Should NOT flag: locked node
        { id: 'f6', ...rfd, name: 'Frame 3', type: 'FRAME', layoutMode: 'HORIZONTAL', locked: true, children: [] },

        // ❌ Should NOT flag: has reactions (intentional marker)
        {
          id: 'f7', ...rfd,
          name: 'Frame 4',
          type: 'FRAME',
          layoutMode: 'VERTICAL',
          reactions: [{ trigger: { type: 'ON_CLICK' } }],
          children: [],
        },

        // LINE / VECTOR — decorative nodes, not flagged by shared rules
        { id: 'f8', ...rfd, name: 'Line 1', type: 'LINE', children: [] },
        { id: 'f9', ...rfd, name: 'Vector 1', type: 'VECTOR', children: [] },

        // Instance internals — SHOULD NOT recurse into them
        {
          id: 'inst1', ...rfd,
          name: 'Button / Primary',
          type: 'INSTANCE',
          componentId: 'master-btn',
          children: [
            { id: 'inst-child', name: 'Frame 5', type: 'FRAME', layoutMode: 'HORIZONTAL', children: [] },
          ],
        },

        // ── dev-status filter test ──────────────────────────────────────────
        // No devStatus → excluded by readyFrames; issues inside are never reported.
        {
          id: 'skip-names',
          name: 'Frame 99',
          type: 'FRAME',
          layoutMode: 'VERTICAL',
          children: [],
        },
      ],
    },
  ],
};
