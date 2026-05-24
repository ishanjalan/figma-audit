import { describe, it, expect } from 'vitest';
import { checkResponsive } from '../responsive.ts';
import { responsiveFixture } from './fixtures/responsive-fixture.ts';

describe('checkResponsive', () => {
  const issues = checkResponsive(responsiveFixture);
  const ids = () => issues.map((i) => i.nodeId);

  it('flags a FRAME with no stretch constraint and no auto-layout fill', () => {
    expect(ids()).toContain('r1');
  });

  it('flags an auto-layout FRAME with FIXED (not FILL) horizontal sizing', () => {
    expect(ids()).toContain('r5');
  });

  it('flags a non-responsive COMPONENT', () => {
    expect(ids()).toContain('r9');
  });

  it('does NOT flag a frame with STRETCH constraint', () => {
    expect(ids()).not.toContain('r2');
  });

  it('does NOT flag a frame with SCALE constraint', () => {
    expect(ids()).not.toContain('r3');
  });

  it('does NOT flag an auto-layout frame with FILL horizontal sizing', () => {
    expect(ids()).not.toContain('r4');
  });

  it('does NOT flag a hidden frame', () => {
    expect(ids()).not.toContain('r6');
  });

  it('does NOT flag a locked frame', () => {
    expect(ids()).not.toContain('r7');
  });

  it('does NOT flag a frame with exportSettings (intentional marker)', () => {
    expect(ids()).not.toContain('r8');
  });

  it('does NOT recurse into INSTANCE children', () => {
    expect(ids()).not.toContain('inst-child');
  });

  it('attaches topLevelFrameId and topLevelFrameName to every issue', () => {
    for (const issue of issues) {
      expect(issue.topLevelFrameId).toBeTruthy();
      expect(issue.topLevelFrameName).toBeTruthy();
    }
  });

  it('total flagged count matches expected', () => {
    // r1, r5, r9 = 3
    expect(issues.length).toBe(3);
  });
});
