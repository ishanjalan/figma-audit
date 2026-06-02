import { describe, it, expect } from 'vitest';
import { checkStructure } from '../structure.ts';
import { structureFixture } from './fixtures/structure-fixture.ts';

describe('checkStructure', () => {
  const issues = checkStructure(structureFixture);
  const ids = () => issues.map((i) => i.nodeId);
  const byKind = (kind: string) => issues.filter((i) => i.kind === kind);

  // ── hidden-layer ─────────────────────────────────────────────────────────────
  // D3: shared vocabulary uses 'hidden-layer' (aligned with the Handover plugin).

  it('flags a hidden frame', () => {
    expect(ids()).toContain('h1');
    expect(byKind('hidden-layer').find((i) => i.nodeId === 'h1')?.kind).toBe('hidden-layer');
  });

  it('does NOT flag a hidden frame bound to a component bool prop', () => {
    expect(ids()).not.toContain('h2');
  });

  it('does NOT separately flag children of a hidden parent (cascades)', () => {
    expect(ids()).not.toContain('h1-child');
  });

  // ── empty-container ──────────────────────────────────────────────────────────

  it('flags an empty FRAME with no fills', () => {
    expect(ids()).toContain('e1');
    expect(byKind('empty-container').find((i) => i.nodeId === 'e1')?.kind).toBe('empty-container');
  });

  it('does NOT flag an empty FRAME that has a visible fill (visual leaf)', () => {
    expect(ids()).not.toContain('e2');
  });

  it('flags an empty GROUP', () => {
    expect(ids()).toContain('e4');
    expect(byKind('empty-container').find((i) => i.nodeId === 'e4')?.kind).toBe('empty-container');
  });

  it('flags an empty FRAME inside a SECTION passthrough', () => {
    expect(ids()).toContain('sec-child');
  });

  it('does NOT flag the SECTION container itself', () => {
    expect(ids()).not.toContain('sec1');
  });

  it('pins issues inside a top-level SECTION to the child frame, not the section', () => {
    const issue = issues.find((i) => i.nodeId === 'sec-child');
    expect(issue?.topLevelFrameId).toBe('sec-child');
    expect(issue?.topLevelFrameName).toBe('Empty inside section');
  });

  // ── transparent-fill ─────────────────────────────────────────────────────────
  // A FRAME with fills but all fills invisible is 'transparent-fill', not
  // 'empty-container' — the shared scanner distinguishes these correctly.

  it('flags a FRAME with only invisible fills as transparent-fill', () => {
    expect(ids()).toContain('e3');
    expect(byKind('transparent-fill').find((i) => i.nodeId === 'e3')?.kind).toBe('transparent-fill');
  });

  // ── detached-instance ───────────────────────────────────────────────────────

  it('flags an INSTANCE with no componentId', () => {
    expect(ids()).toContain('di1');
    expect(byKind('detached-instance').find((i) => i.nodeId === 'di1')?.kind).toBe('detached-instance');
  });

  it('does NOT flag an INSTANCE with a valid componentId', () => {
    expect(ids()).not.toContain('di2');
  });

  it('does NOT recurse into INSTANCE internals', () => {
    expect(ids()).not.toContain('di2-child');
  });

  // ── guards ──────────────────────────────────────────────────────────────────

  it('does NOT flag a locked node', () => {
    expect(ids()).not.toContain('lk1');
  });

  it('does NOT flag a node with reactions (intentional marker)', () => {
    expect(ids()).not.toContain('rx1');
  });

  it('does NOT flag or recurse into BOOLEAN_OPERATION', () => {
    expect(ids()).not.toContain('bo1');
    expect(ids()).not.toContain('bo-child');
  });

  // ── metadata ────────────────────────────────────────────────────────────────

  it('attaches topLevelFrameId and topLevelFrameName to every issue', () => {
    for (const issue of issues) {
      expect(issue.topLevelFrameId).toBeTruthy();
      expect(issue.topLevelFrameName).toBeTruthy();
    }
  });

  it('total issue count matches expected', () => {
    // h1 (hidden-layer), e1 (empty-container), e3 (transparent-fill),
    // e4 (empty-container), di1 (detached-instance), sec-child (empty-container) = 6
    expect(issues.length).toBe(6);
  });

  // ── dev-status filter ────────────────────────────────────────────────────────

  it('does NOT report issues inside a frame with no devStatus', () => {
    // skip1 has no devStatus — readyFrames excludes it entirely
    expect(ids()).not.toContain('skip1');
    expect(ids()).not.toContain('skip1-child');
  });
});
