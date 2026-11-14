import { describe, expect, it } from 'vitest';
import { imageHintState, isImeComposition, queuedPreview, submitAction } from './Composer';

describe('isImeComposition (bug hunt #2: IME Enter must not submit)', () => {
  it('flags the live composition marker', () => {
    expect(isImeComposition({ isComposing: true, keyCode: 13 })).toBe(true);
  });

  it('flags the legacy keyCode 229 marker (engines that never set isComposing)', () => {
    expect(isImeComposition({ isComposing: false, keyCode: 229 })).toBe(true);
    expect(isImeComposition({ keyCode: 229 })).toBe(true);
  });

  it('passes through ordinary keys, including plain Enter', () => {
    expect(isImeComposition({ isComposing: false, keyCode: 13 })).toBe(false);
    expect(isImeComposition({})).toBe(false);
  });
});

describe('imageHintState (#214: no agent, no capability claims)', () => {
  it('renders no hint while no agent is connected or connecting', () => {
    expect(imageHintState(undefined)).toBeNull();
  });

  it('names a negotiated agent that lacks image input', () => {
    expect(imageHintState(false)).toBe('unavailable');
  });

  it('shows the paste-or-attach hint once image input is negotiated', () => {
    expect(imageHintState(true)).toBe('available');
  });
});

describe('submitAction (queue messages mid-turn)', () => {
  it('sends when the composer is open', () => {
    expect(submitAction({ hasContent: true, disabled: false, canQueue: false })).toBe('send');
  });

  it('queues while a turn runs or awaits approval', () => {
    expect(submitAction({ hasContent: true, disabled: true, canQueue: true })).toBe('queue');
  });

  it('does nothing with no content, or when the composer is closed for another reason', () => {
    expect(submitAction({ hasContent: false, disabled: false, canQueue: false })).toBe('none');
    expect(submitAction({ hasContent: false, disabled: true, canQueue: true })).toBe('none');
    expect(submitAction({ hasContent: true, disabled: true, canQueue: false })).toBe('none');
  });
});

describe('queuedPreview', () => {
  const images = (count: number) => `${count} image(s)`;

  it('flattens text blocks into one line', () => {
    expect(
      queuedPreview({ id: 'q', content: [{ type: 'text', text: 'first\n\nsecond  line' }] }, images),
    ).toBe('first second line');
  });

  it('adds an image count, alone or after the text', () => {
    const image = { type: 'image' as const, data: 'AAAA', mimeType: 'image/png' };
    expect(queuedPreview({ id: 'q', content: [image, image] }, images)).toBe('2 image(s)');
    expect(queuedPreview({ id: 'q', content: [{ type: 'text', text: 'look' }, image] }, images)).toBe(
      'look · 1 image(s)',
    );
  });
});
