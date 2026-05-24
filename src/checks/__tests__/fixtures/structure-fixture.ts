/**
 * Minimal Figma document tree for testing checkStructure.
 *
 * Scenarios covered:
 *  hidden:
 *    - visible: false node → SHOULD flag
 *    - visible: false bound to componentPropertyReferences.visible → SHOULD NOT flag
 *    - hidden node inside hidden parent → parent flagged, child NOT separately flagged
 *  empty-container:
 *    - FRAME with no children, no fills → SHOULD flag
 *    - FRAME with no children but has visible fill → SHOULD NOT flag (visual leaf)
 *    - GROUP with no children → SHOULD flag
 *    - COMPONENT with no children → SHOULD flag
 *  detached-instance:
 *    - INSTANCE with no componentId → SHOULD flag
 *    - INSTANCE with componentId present → SHOULD NOT flag
 *  skips:
 *    - locked → SHOULD NOT flag
 *    - reactions/exportSettings/annotations → SHOULD NOT flag
 *    - SECTION wrapper → SHOULD NOT flag the section itself
 *    - BOOLEAN_OPERATION → SHOULD NOT flag or recurse
 */

import type { FigmaNode } from '../../../api/types.ts';

export const structureFixture: FigmaNode = {
  id: 'doc',
  name: 'Document',
  type: 'DOCUMENT',
  children: [
    {
      id: 'page1',
      name: 'Page 1',
      type: 'CANVAS',
      children: [
        // ✅ hidden: visible false → should flag
        {
          id: 'h1',
          name: 'Hidden Layer',
          type: 'FRAME',
          visible: false,
          children: [
            // child of hidden — should NOT be separately flagged
            { id: 'h1-child', name: 'Child of hidden', type: 'FRAME', children: [] },
          ],
        },

        // ❌ hidden, but bound to component bool prop → should NOT flag
        {
          id: 'h2',
          name: 'Loading Spinner',
          type: 'INSTANCE',
          componentId: 'spinner-master',
          visible: false,
          componentPropertyReferences: { visible: 'loading#BOOLEAN' },
          children: [],
        },

        // ✅ empty-container: bare frame no children no fills → should flag
        {
          id: 'e1',
          name: 'Empty Frame',
          type: 'FRAME',
          children: [],
        },

        // ❌ empty-container: frame with visible fill → visual leaf, should NOT flag
        {
          id: 'e2',
          name: 'Background Block',
          type: 'FRAME',
          fills: [{ type: 'SOLID', visible: true }],
          children: [],
        },

        // ❌ empty-container: frame with invisible fill — fill is off, so still empty visual
        // → should flag (visible:false fill counts as no fill)
        {
          id: 'e3',
          name: 'Invisible Fill Frame',
          type: 'FRAME',
          fills: [{ type: 'SOLID', visible: false }],
          children: [],
        },

        // ✅ empty-container: group no children → should flag
        {
          id: 'e4',
          name: 'Empty Group',
          type: 'GROUP',
          children: [],
        },

        // ✅ detached-instance: INSTANCE with no componentId → should flag
        {
          id: 'di1',
          name: 'Broken Component',
          type: 'INSTANCE',
          // componentId intentionally absent
          children: [],
        },

        // ❌ instance with valid componentId → should NOT flag
        {
          id: 'di2',
          name: 'Valid Instance',
          type: 'INSTANCE',
          componentId: 'master-xyz',
          children: [
            // internals should not be walked
            { id: 'di2-child', name: 'Empty Frame', type: 'FRAME', children: [] },
          ],
        },

        // ❌ locked → should not flag at all
        {
          id: 'lk1',
          name: 'Locked Empty',
          type: 'FRAME',
          locked: true,
          children: [],
        },

        // ❌ reactions → intentional marker, skip
        {
          id: 'rx1',
          name: 'Interactive Frame',
          type: 'FRAME',
          reactions: [{ trigger: { type: 'ON_CLICK' } }],
          children: [],
        },

        // SECTION passthrough — section itself not flagged, but children are walked
        {
          id: 'sec1',
          name: 'Design Section',
          type: 'SECTION',
          children: [
            // ✅ empty frame inside section → should flag
            { id: 'sec-child', name: 'Empty inside section', type: 'FRAME', children: [] },
          ],
        },

        // BOOLEAN_OPERATION — not walked, not flagged
        {
          id: 'bo1',
          name: 'Icon Shape',
          type: 'BOOLEAN_OPERATION',
          children: [
            { id: 'bo-child', name: 'Some Vector', type: 'VECTOR', children: [] },
          ],
        },
      ],
    },
  ],
};
