/**
 * Minimal Figma document tree for testing checkStructure.
 *
 * All nodes that test empty-container / transparent-fill behaviour have a
 * non-zero absoluteBoundingBox so the shared scanner's zero-size check fires
 * only when explicitly tested, not as a side-effect of missing geometry.
 *
 * Scenarios covered:
 *  hidden-layer (D3: was 'hidden' in the pre-Phase-2 audit):
 *    - visible: false node → SHOULD flag as 'hidden-layer'
 *    - visible: false bound to componentPropertyReferences.visible → SHOULD NOT flag
 *    - hidden node inside hidden parent → parent flagged, child NOT separately flagged
 *  empty-container:
 *    - FRAME with no children, no fills → SHOULD flag
 *    - FRAME with no children but has visible fill → SHOULD NOT flag (visual leaf)
 *    - GROUP with no children → SHOULD flag
 *  transparent-fill:
 *    - FRAME with no children but fill visible:false → SHOULD flag as 'transparent-fill'
 *      (the shared scanner catches the invisible fill before the empty-container check)
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

const bb = (w = 100, h = 100) => ({ absoluteBoundingBox: { x: 0, y: 0, width: w, height: h } });

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
        // ✅ hidden-layer: visible false → should flag
        {
          id: 'h1',
          name: 'Hidden Layer',
          type: 'FRAME',
          visible: false,
          ...bb(),
          children: [
            // child of hidden — should NOT be separately flagged
            { id: 'h1-child', name: 'Child of hidden', type: 'FRAME', ...bb(), children: [] },
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
          ...bb(),
          children: [],
        },

        // ✅ empty-container: bare frame no children no fills → should flag
        {
          id: 'e1',
          name: 'Empty Frame',
          type: 'FRAME',
          ...bb(),
          children: [],
        },

        // ❌ empty-container: frame with visible fill → visual leaf, should NOT flag
        {
          id: 'e2',
          name: 'Background Block',
          type: 'FRAME',
          fills: [{ type: 'SOLID', visible: true }],
          ...bb(),
          children: [],
        },

        // ✅ transparent-fill: frame with fill explicitly set to visible:false.
        // The shared scanner fires 'transparent-fill' (not 'empty-container') because
        // the fill IS present but invisible — a different issue class than truly empty.
        {
          id: 'e3',
          name: 'Invisible Fill Frame',
          type: 'FRAME',
          fills: [{ type: 'SOLID', visible: false }],
          ...bb(),
          children: [],
        },

        // ✅ empty-container: group no children → should flag
        {
          id: 'e4',
          name: 'Empty Group',
          type: 'GROUP',
          ...bb(),
          children: [],
        },

        // ✅ detached-instance: INSTANCE with no componentId → should flag
        {
          id: 'di1',
          name: 'Broken Component',
          type: 'INSTANCE',
          // componentId intentionally absent
          ...bb(),
          children: [],
        },

        // ❌ instance with valid componentId → should NOT flag
        {
          id: 'di2',
          name: 'Valid Instance',
          type: 'INSTANCE',
          componentId: 'master-xyz',
          ...bb(),
          children: [
            // internals should not be walked
            { id: 'di2-child', name: 'Empty Frame', type: 'FRAME', ...bb(), children: [] },
          ],
        },

        // ❌ locked → should not flag at all
        {
          id: 'lk1',
          name: 'Locked Empty',
          type: 'FRAME',
          locked: true,
          ...bb(),
          children: [],
        },

        // ❌ reactions → intentional marker, skip
        {
          id: 'rx1',
          name: 'Interactive Frame',
          type: 'FRAME',
          reactions: [{ trigger: { type: 'ON_CLICK' } }],
          ...bb(),
          children: [],
        },

        // SECTION passthrough — section itself not flagged, but children are walked
        {
          id: 'sec1',
          name: 'Design Section',
          type: 'SECTION',
          children: [
            // ✅ empty frame inside section → should flag
            { id: 'sec-child', name: 'Empty inside section', type: 'FRAME', ...bb(), children: [] },
          ],
        },

        // BOOLEAN_OPERATION — not walked, not flagged
        {
          id: 'bo1',
          name: 'Icon Shape',
          type: 'BOOLEAN_OPERATION',
          children: [
            { id: 'bo-child', name: 'Some Vector', type: 'VECTOR', ...bb(), children: [] },
          ],
        },
      ],
    },
  ],
};
