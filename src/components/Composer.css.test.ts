import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./Composer.css', import.meta.url), 'utf8');

describe('composer mobile typography (issue #251)', () => {
  it('keeps coarse-pointer input text at the iOS no-zoom threshold or larger', () => {
    expect(css).toMatch(
      /@media \(pointer: coarse\)\s*\{\s*\.composer-input\s*\{[^}]*font-size:\s*max\(16px,\s*var\(--panda-size-content\)\)/,
    );
  });
});
