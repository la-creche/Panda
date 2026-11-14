import { beforeEach, describe, expect, it } from 'vitest';
import { drainDecision, lastTurnStopped, queueForKey, useMessageQueue, type DrainInput } from './messageQueue';
import type { AcpContentBlock, Turn } from './protocol/types';

const text = (value: string): AcpContentBlock[] => [{ type: 'text', text: value }];
const KEY = 'conn-a::session-1';

function texts(key: string): string[] {
  return queueForKey(useMessageQueue.getState(), key).items.map((item) =>
    item.content.map((block) => (block.type === 'text' ? block.text : '')).join(''),
  );
}

beforeEach(() => {
  useMessageQueue.setState({ queues: {} });
});

describe('message queue store', () => {
  it('keeps messages in order and hands out the head first', () => {
    const store = useMessageQueue.getState();
    store.enqueue(KEY, text('one'));
    store.enqueue(KEY, text('two'));
    expect(texts(KEY)).toEqual(['one', 'two']);
    expect(store.takeNext(KEY)?.content).toEqual(text('one'));
    expect(texts(KEY)).toEqual(['two']);
  });

  it('ignores empty content', () => {
    useMessageQueue.getState().enqueue(KEY, []);
    expect(useMessageQueue.getState().queues).toEqual({});
  });

  it('keeps one queue per session key', () => {
    const store = useMessageQueue.getState();
    store.enqueue(KEY, text('a'));
    store.enqueue('conn-a::session-2', text('b'));
    expect(texts(KEY)).toEqual(['a']);
    expect(texts('conn-a::session-2')).toEqual(['b']);
  });

  it('puts a failed message back at the head', () => {
    const store = useMessageQueue.getState();
    store.enqueue(KEY, text('one'));
    store.enqueue(KEY, text('two'));
    const head = store.takeNext(KEY);
    expect(head).not.toBeNull();
    store.putBack(KEY, head!);
    expect(texts(KEY)).toEqual(['one', 'two']);
  });

  it('pauses only a non-empty queue, and resume clears the pause', () => {
    const store = useMessageQueue.getState();
    store.pause(KEY);
    expect(queueForKey(useMessageQueue.getState(), KEY).paused).toBe(false);
    store.enqueue(KEY, text('one'));
    store.pause(KEY);
    expect(queueForKey(useMessageQueue.getState(), KEY).paused).toBe(true);
    store.resume(KEY);
    expect(queueForKey(useMessageQueue.getState(), KEY).paused).toBe(false);
  });

  it('drops the pause with the last removed message', () => {
    const store = useMessageQueue.getState();
    store.enqueue(KEY, text('one'));
    store.pause(KEY);
    const [only] = queueForKey(useMessageQueue.getState(), KEY).items;
    store.remove(KEY, only!.id);
    expect(useMessageQueue.getState().queues).toEqual({});
  });

  it('clears every queue of a deleted session across connections', () => {
    const store = useMessageQueue.getState();
    store.enqueue('conn-a::session-1', text('a'));
    store.enqueue('conn-b::session-1', text('b'));
    store.enqueue('conn-a::session-2', text('c'));
    store.clearSessionQueues('session-1');
    expect(Object.keys(useMessageQueue.getState().queues)).toEqual(['conn-a::session-2']);
  });
});

describe('lastTurnStopped', () => {
  const turn = (blocks: Turn['blocks']): Turn => ({ id: 't', blocks });

  it('is false for an empty document and an end_turn ending', () => {
    expect(lastTurnStopped({ turns: [] })).toBe(false);
    expect(lastTurnStopped({ turns: [turn([{ kind: 'user_message', content: text('hi') }])] })).toBe(false);
  });

  it('is true when the last turn carries a stop-reason notice', () => {
    const stopped = turn([
      { kind: 'user_message', content: text('hi') },
      { kind: 'turn_notice', stopReason: 'cancelled' },
    ]);
    expect(lastTurnStopped({ turns: [stopped] })).toBe(true);
    // Only the LAST turn counts: a later normal turn clears it.
    expect(lastTurnStopped({ turns: [stopped, turn([{ kind: 'user_message', content: text('next') }])] })).toBe(false);
  });
});

describe('drainDecision', () => {
  const base: DrainInput = {
    turnEnded: false,
    lastTurnStopped: false,
    queued: 1,
    paused: false,
    canSendNow: true,
    dispatchPending: false,
  };

  it('sends the head when the composer may send', () => {
    expect(drainDecision(base)).toBe('send');
    expect(drainDecision({ ...base, turnEnded: true })).toBe('send');
  });

  it('waits with nothing queued, mid-turn, while paused, or while a dispatch is unconfirmed', () => {
    expect(drainDecision({ ...base, queued: 0 })).toBe('wait');
    expect(drainDecision({ ...base, canSendNow: false })).toBe('wait');
    expect(drainDecision({ ...base, paused: true })).toBe('wait');
    expect(drainDecision({ ...base, dispatchPending: true })).toBe('wait');
  });

  it('pauses when the turn that just ended stopped early', () => {
    expect(drainDecision({ ...base, turnEnded: true, lastTurnStopped: true })).toBe('pause');
  });

  it('sends after a resume even though the last turn still shows its stop notice', () => {
    // No new transition: the notice alone does not re-pause.
    expect(drainDecision({ ...base, lastTurnStopped: true })).toBe('send');
  });

  it('never pauses an empty queue', () => {
    expect(drainDecision({ ...base, queued: 0, turnEnded: true, lastTurnStopped: true })).toBe('wait');
  });
});
