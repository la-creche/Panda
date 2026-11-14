import { useEffect, useRef } from 'react';
import { create } from 'zustand';
import type { AcpContentBlock, SessionDocument } from './protocol/types';

/**
 * Queued messages, keyed like composer drafts (one queue per foreground
 * session, `composerDraftKey`): while a turn runs, Enter in the composer
 * holds the message here instead of sending it. The drain hook sends the
 * head of the queue each time the session's turn ends, one turn at a time —
 * CONTEXT.md's 运行中 allows at most one pending turn per connection, so the
 * queue serializes, it never sends concurrently.
 *
 * A queued message is NOT echoed into the transcript: an optimistic
 * user_message always opens a new turn, which would land ahead of the turn
 * still running. It renders in the composer's queue strip until it is sent.
 *
 * The queue pauses when a turn ends with a stop reason other than end_turn
 * (cancelled — the user pressed Stop —, refusal, limits): the next message
 * was written for a turn that did not finish, so the user decides. Resume
 * clears the pause; removing items never does.
 */

export type QueuedMessage = { id: string; content: AcpContentBlock[] };

export type MessageQueue = { items: QueuedMessage[]; paused: boolean };

const EMPTY_QUEUE: MessageQueue = { items: [], paused: false };

interface MessageQueueState {
  queues: Record<string, MessageQueue>;
  enqueue: (key: string, content: AcpContentBlock[]) => void;
  remove: (key: string, id: string) => void;
  /** Removes and returns the head, or null when the queue is empty. */
  takeNext: (key: string) => QueuedMessage | null;
  /** Puts a message back at the head (its send failed before the turn began). */
  putBack: (key: string, message: QueuedMessage) => void;
  pause: (key: string) => void;
  resume: (key: string) => void;
  /** Drops every queue of a deleted session across all connections. */
  clearSessionQueues: (sessionId: string) => void;
}

let nextId = 0;

export const useMessageQueue = create<MessageQueueState>((set, get) => {
  const write = (key: string, next: MessageQueue) =>
    set((s) => {
      const queues = { ...s.queues };
      if (next.items.length === 0 && !next.paused) delete queues[key];
      else queues[key] = next;
      return { queues };
    });
  return {
    queues: {},
    enqueue: (key, content) => {
      if (content.length === 0) return;
      const queue = queueForKey(get(), key);
      nextId += 1;
      write(key, { ...queue, items: [...queue.items, { id: `queued-${nextId}`, content }] });
    },
    remove: (key, id) => {
      const queue = queueForKey(get(), key);
      const items = queue.items.filter((item) => item.id !== id);
      // An emptied queue has nothing left to hold back.
      write(key, { items, paused: items.length > 0 && queue.paused });
    },
    takeNext: (key) => {
      const queue = queueForKey(get(), key);
      const [head, ...rest] = queue.items;
      if (head === undefined) return null;
      write(key, { ...queue, items: rest });
      return head;
    },
    putBack: (key, message) => {
      const queue = queueForKey(get(), key);
      write(key, { ...queue, items: [message, ...queue.items] });
    },
    pause: (key) => {
      const queue = queueForKey(get(), key);
      if (queue.items.length === 0 || queue.paused) return;
      write(key, { ...queue, paused: true });
    },
    resume: (key) => {
      const queue = queueForKey(get(), key);
      if (!queue.paused) return;
      write(key, { ...queue, paused: false });
    },
    clearSessionQueues: (sessionId) =>
      set((s) => {
        const suffix = `::${sessionId}`;
        const drops = Object.keys(s.queues).filter((key) => key.endsWith(suffix));
        if (drops.length === 0) return s;
        const queues = { ...s.queues };
        for (const key of drops) delete queues[key];
        return { queues };
      }),
  };
});

/** Stable read for renders (a missing key returns one shared empty queue). */
export function queueForKey(s: Pick<MessageQueueState, 'queues'>, key: string): MessageQueue {
  return s.queues[key] ?? EMPTY_QUEUE;
}

/** True when the document's last turn ended with a stop-reason notice. */
export function lastTurnStopped(doc: Pick<SessionDocument, 'turns'>): boolean {
  const last = doc.turns[doc.turns.length - 1];
  return last !== undefined && last.blocks.some((block) => block.kind === 'turn_notice');
}

export type DrainInput = {
  /** The session's turn went from running/requires_action to idle since the last check. */
  turnEnded: boolean;
  /** The ended turn carries a stop-reason notice (not end_turn). */
  lastTurnStopped: boolean;
  queued: number;
  paused: boolean;
  /** The composer may send right now (idle, link up, no switch). */
  canSendNow: boolean;
  /** A queued message was dispatched and its turn has not been seen yet. */
  dispatchPending: boolean;
};

export type DrainDecision = 'pause' | 'send' | 'wait';

/** The drain's one decision per check — pure, so the rules are testable. */
export function drainDecision(input: DrainInput): DrainDecision {
  if (input.queued === 0) return 'wait';
  if (input.turnEnded && input.lastTurnStopped && !input.paused) return 'pause';
  if (input.paused || !input.canSendNow || input.dispatchPending) return 'wait';
  return 'send';
}

/**
 * Sends the foreground session's queued messages, one per finished turn.
 * `busy` is the document's turn status (not idle); `canSendNow` is the
 * composer's send gate. A dispatched message stays "pending" until the
 * document reports its turn as busy — the demo driver flips the status a
 * few hundred ms after play(), and the gate must not send twice meanwhile.
 */
export function useMessageQueueDrain({
  sessionKey,
  busy,
  canSendNow,
  stopped,
  send,
}: {
  sessionKey: string;
  busy: boolean;
  canSendNow: boolean;
  stopped: boolean;
  send: (content: AcpContentBlock[]) => void | Promise<void>;
}): void {
  const queue = useMessageQueue((s) => queueForKey(s, sessionKey));
  const seen = useRef<{ key: string; busy: boolean } | null>(null);
  const dispatched = useRef<string | null>(null);

  useEffect(() => {
    const prev = seen.current;
    seen.current = { key: sessionKey, busy };
    if (dispatched.current !== null && (dispatched.current !== sessionKey || busy)) {
      dispatched.current = null;
    }
    const decision = drainDecision({
      turnEnded: prev !== null && prev.key === sessionKey && prev.busy && !busy,
      lastTurnStopped: stopped,
      queued: queue.items.length,
      paused: queue.paused,
      canSendNow,
      dispatchPending: dispatched.current === sessionKey,
    });
    const store = useMessageQueue.getState();
    if (decision === 'pause') {
      store.pause(sessionKey);
      return;
    }
    if (decision !== 'send') return;
    const next = store.takeNext(sessionKey);
    if (next === null) return;
    dispatched.current = sessionKey;
    const fail = (err: unknown) => {
      console.error('[panda/queue] queued message failed to send', err);
      if (dispatched.current === sessionKey) dispatched.current = null;
      const after = useMessageQueue.getState();
      after.putBack(sessionKey, next);
      after.pause(sessionKey);
    };
    try {
      void Promise.resolve(send(next.content)).catch(fail);
    } catch (err) {
      fail(err);
    }
  }, [sessionKey, busy, canSendNow, stopped, queue, send]);
}
