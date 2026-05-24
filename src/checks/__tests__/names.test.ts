import { describe, it, expect } from 'vitest';
import { checkNames } from '../names.ts';
import { nameFixture } from './fixtures/names-fixture.ts';

describe('checkNames', () => {
  const issues = checkNames(nameFixture);
  const ids = () => issues.map((i) => i.nodeId);

  it('flags auto-layout frame with generic name', () => {
    expect(ids()).toContain('f1');
  });

  it('flags top-level frame with generic name (no layout needed at top level)', () => {
    expect(ids()).toContain('f2');
  });

  it('flags group with a TEXT child', () => {
    expect(ids()).toContain('f3');
  });

  it('flags LINE with generic name', () => {
    expect(ids()).toContain('f8');
  });

  it('flags VECTOR with generic name', () => {
    expect(ids()).toContain('f9');
  });

  it('does NOT flag a frame with a semantic name', () => {
    expect(ids()).not.toContain('f4');
  });

  it('does NOT flag Rectangle with generic name (no text/layout — plugin cannot rename)', () => {
    expect(ids()).not.toContain('f5');
  });

  it('does NOT flag locked node', () => {
    expect(ids()).not.toContain('f6');
  });

  it('does NOT flag node with reactions (intentional marker)', () => {
    expect(ids()).not.toContain('f7');
  });

  it('does NOT recurse into INSTANCE internals', () => {
    // Frame 5 lives inside inst1 — should never appear
    expect(ids()).not.toContain('inst-child');
  });

  it('includes topLevelFrameId and topLevelFrameName on every issue', () => {
    for (const issue of issues) {
      expect(issue.topLevelFrameId).toBeTruthy();
      expect(issue.topLevelFrameName).toBeTruthy();
    }
  });

  it('total flagged count matches expected', () => {
    // f1, f2, f3, f8, f9 = 5
    expect(issues.length).toBe(5);
  });
});
