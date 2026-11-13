import { describe, expect, it } from 'vitest';
import { nextReleaseTag } from './next-release-tag.mjs';

describe('nextReleaseTag', () => {
  it('uses the package version for the first fork release', () => {
    expect(nextReleaseTag('0.2.0', [])).toBe('panda-v0.2.0');
  });

  it('increments the newest release patch', () => {
    expect(nextReleaseTag('0.2.0', ['panda-v0.2.2', 'panda-v0.2.10']))
      .toBe('panda-v0.2.11');
  });

  it('uses a deliberately raised package version as the new floor', () => {
    expect(nextReleaseTag('0.3.0', ['panda-v0.2.10'])).toBe('panda-v0.3.0');
  });

  it('refuses malformed release tags instead of silently skipping them', () => {
    expect(() => nextReleaseTag('0.2.0', ['panda-vlatest']))
      .toThrow('release tag must be an x.y.z version');
  });
});
