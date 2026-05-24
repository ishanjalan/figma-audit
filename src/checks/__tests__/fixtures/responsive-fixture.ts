/**
 * Minimal Figma document tree for testing checkResponsive.
 *
 * Scenarios:
 *  - FRAME with no constraints and no auto-layout → SHOULD flag
 *  - FRAME with constraint STRETCH → SHOULD NOT flag
 *  - FRAME with constraint SCALE → SHOULD NOT flag
 *  - FRAME with auto-layout + FILL horizontal sizing → SHOULD NOT flag
 *  - FRAME with auto-layout + FIXED horizontal sizing → SHOULD flag
 *  - INSTANCE → SHOULD NOT recurse (fix the master)
 *  - Hidden frame → SHOULD NOT flag
 *  - Locked frame → SHOULD NOT flag
 *  - exportSettings → SHOULD NOT flag (intentional marker)
 *  - COMPONENT type (not FRAME) → SHOULD flag if non-responsive
 */

import type { FigmaNode } from '../../../api/types.ts';

export const responsiveFixture: FigmaNode = {
  id: 'doc',
  name: 'Document',
  type: 'DOCUMENT',
  children: [
    {
      id: 'page1',
      name: 'Page 1',
      type: 'CANVAS',
      children: [
        // ✅ Should flag: no constraints, no auto-layout
        {
          id: 'r1',
          name: 'Fixed Width Card',
          type: 'FRAME',
          constraints: { horizontal: 'LEFT', vertical: 'TOP' },
          children: [],
        },

        // ❌ Should NOT flag: STRETCH constraint
        {
          id: 'r2',
          name: 'Stretchy Frame',
          type: 'FRAME',
          constraints: { horizontal: 'STRETCH', vertical: 'TOP' },
          children: [],
        },

        // ❌ Should NOT flag: SCALE constraint
        {
          id: 'r3',
          name: 'Scaling Frame',
          type: 'FRAME',
          constraints: { horizontal: 'SCALE', vertical: 'TOP' },
          children: [],
        },

        // ❌ Should NOT flag: auto-layout + FILL sizing
        {
          id: 'r4',
          name: 'Full-width Row',
          type: 'FRAME',
          layoutMode: 'HORIZONTAL',
          layoutSizingHorizontal: 'FILL',
          children: [],
        },

        // ✅ Should flag: auto-layout but FIXED horizontal sizing
        {
          id: 'r5',
          name: 'Fixed Auto-layout Frame',
          type: 'FRAME',
          layoutMode: 'VERTICAL',
          layoutSizingHorizontal: 'FIXED',
          constraints: { horizontal: 'LEFT', vertical: 'TOP' },
          children: [],
        },

        // ❌ Should NOT flag: hidden
        {
          id: 'r6',
          name: 'Hidden Frame',
          type: 'FRAME',
          visible: false,
          constraints: { horizontal: 'LEFT', vertical: 'TOP' },
          children: [],
        },

        // ❌ Should NOT flag: locked
        {
          id: 'r7',
          name: 'Locked Frame',
          type: 'FRAME',
          locked: true,
          constraints: { horizontal: 'LEFT', vertical: 'TOP' },
          children: [],
        },

        // ❌ Should NOT flag: exportSettings (intentional marker)
        {
          id: 'r8',
          name: 'Export Asset',
          type: 'FRAME',
          exportSettings: [{ format: 'PNG' }],
          constraints: { horizontal: 'LEFT', vertical: 'TOP' },
          children: [],
        },

        // ✅ Should flag: COMPONENT type, not responsive
        {
          id: 'r9',
          name: 'Card Component',
          type: 'COMPONENT',
          constraints: { horizontal: 'LEFT', vertical: 'TOP' },
          children: [],
        },

        // Instance — should NOT recurse into children
        {
          id: 'inst1',
          name: 'Card / Default',
          type: 'INSTANCE',
          componentId: 'r9',
          children: [
            // This non-responsive frame inside instance should NOT be flagged
            {
              id: 'inst-child',
              name: 'Internal Frame',
              type: 'FRAME',
              constraints: { horizontal: 'LEFT', vertical: 'TOP' },
              children: [],
            },
          ],
        },
      ],
    },
  ],
};
