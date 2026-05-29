import { describe, it, expect } from 'vitest';
import { checkNames } from '../names.ts';
import { nameFixture } from './fixtures/names-fixture.ts';

describe('checkNames', () => {
  const issues = checkNames(nameFixture);
  const ids = () => issues.map((i) => i.nodeId);
  const byReason = (r: string) => issues.filter((i) => i.reason === r);

  // ── generic-name ─────────────────────────────────────────────────────────────

  it('flags auto-layout frame with generic name', () => {
    expect(ids()).toContain('f1');
    expect(byReason('generic-name').map((i) => i.nodeId)).toContain('f1');
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

  it('does NOT flag a FRAME with a PascalCase name', () => {
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

  // ── non-standard-case ────────────────────────────────────────────────────────

  it('flags FRAME with non-PascalCase human-given name (non-standard-case)', () => {
    expect(ids()).toContain('f10');
    expect(byReason('non-standard-case').map((i) => i.nodeId)).toContain('f10');
  });

  it('does NOT flag non-standard-case inside a Smart Animate frame', () => {
    // sa-child has name 'card layout' (non-PascalCase) but lives under sa-frame
    // which has a SMART_ANIMATE reaction — renaming would break the prototype.
    expect(ids()).not.toContain('sa-child');
  });

  it('does NOT flag the Smart Animate top-level frame itself (reactions guard)', () => {
    // sa-frame has reactions → intentional marker guard fires first
    expect(ids()).not.toContain('sa-frame');
  });

  // ── reason field ─────────────────────────────────────────────────────────────

  it('sets reason: generic-name for auto-generated names', () => {
    const issue = issues.find((i) => i.nodeId === 'f1');
    expect(issue?.reason).toBe('generic-name');
  });

  it('sets reason: non-standard-case for PascalCase violations', () => {
    const issue = issues.find((i) => i.nodeId === 'f10');
    expect(issue?.reason).toBe('non-standard-case');
  });

  // ── metadata ─────────────────────────────────────────────────────────────────

  it('includes topLevelFrameId and topLevelFrameName on every issue', () => {
    for (const issue of issues) {
      expect(issue.topLevelFrameId).toBeTruthy();
      expect(issue.topLevelFrameName).toBeTruthy();
    }
  });

  it('total flagged count matches expected', () => {
    // generic-name: f1, f2, f3, f8, f9 = 5
    // non-standard-case: f10 = 1
    // total = 6
    expect(issues.length).toBe(6);
  });
});
