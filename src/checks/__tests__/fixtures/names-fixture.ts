/**
 * Minimal Figma document tree for testing checkNames.
 *
 * Scenarios covered:
 *  - Frame with auto-generated name + auto-layout → SHOULD flag (canInferName returns true)
 *  - Frame with auto-generated name + no layout, no text → SHOULD NOT flag (plugin can't rename)
 *  - Frame with semantic name → SHOULD NOT flag
 *  - Rectangle with auto-generated name, no text/layout → SHOULD NOT flag
 *  - Frame with auto-generated name containing a TEXT child → SHOULD flag
 *  - Locked node → SHOULD NOT flag
 *  - Node with reactions → SHOULD NOT flag (intentional marker)
 *  - Top-level frame with auto-generated name → SHOULD flag (isTopLevel = true)
 */

import type { FigmaNode } from '../../../api/types.ts';

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
        {
          id: 'f1',
          name: 'Frame 1',
          type: 'FRAME',
          layoutMode: 'VERTICAL',
          children: [],
        },
        // ✅ Should flag: top-level frame with generic name (isTopLevel = true)
        {
          id: 'f2',
          name: 'Frame 2',
          type: 'FRAME',
          children: [],
        },
        // ✅ Should flag: frame with a TEXT child (within 3 levels)
        {
          id: 'f3',
          name: 'Group 1',
          type: 'GROUP',
          children: [
            { id: 'txt1', name: 'Button label', type: 'TEXT', children: [] },
          ],
        },
        // ❌ Should NOT flag: semantic name
        {
          id: 'f4',
          name: 'Hero Banner',
          type: 'FRAME',
          layoutMode: 'HORIZONTAL',
          children: [],
        },
        // ❌ Should NOT flag: Rectangle with generic name, no text/layout (plugin can't rename)
        {
          id: 'f5',
          name: 'Rectangle 1',
          type: 'RECTANGLE',
          children: [],
        },
        // ❌ Should NOT flag: locked node
        {
          id: 'f6',
          name: 'Frame 3',
          type: 'FRAME',
          layoutMode: 'HORIZONTAL',
          locked: true,
          children: [],
        },
        // ❌ Should NOT flag: has reactions (intentional marker)
        {
          id: 'f7',
          name: 'Frame 4',
          type: 'FRAME',
          layoutMode: 'VERTICAL',
          reactions: [{ trigger: { type: 'ON_CLICK' } }],
          children: [],
        },
        // ✅ Should flag: LINE with generic name
        {
          id: 'f8',
          name: 'Line 1',
          type: 'LINE',
          children: [],
        },
        // ✅ Should flag: VECTOR with generic name
        {
          id: 'f9',
          name: 'Vector 1',
          type: 'VECTOR',
          children: [],
        },
        // Instance internals — SHOULD NOT recurse into them
        {
          id: 'inst1',
          name: 'Button / Primary',
          type: 'INSTANCE',
          componentId: 'master-btn',
          children: [
            // This Frame 5 inside an instance should not be flagged
            { id: 'inst-child', name: 'Frame 5', type: 'FRAME', layoutMode: 'HORIZONTAL', children: [] },
          ],
        },
      ],
    },
  ],
};
