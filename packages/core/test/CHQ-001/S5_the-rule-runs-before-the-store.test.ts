// CHQ-001 S5 — for a title the rule rejects, the port's `add` is never called.
// Spec: docs/specs/CHQ-001.md. Written before any implementation exists; the single typed
// binding below is explained in S1's header.
import { describe, expect, it } from '@jest/globals';

import type { CreateTask, Task, TaskStore } from '../../src/contracts/CHQ-001/task.ts';
import * as core from '../../src/index.ts';
import { digest } from '../../src/testing/digest.ts';

const createTask: CreateTask = core.createTask;

const INSTANT = new Date('2026-11-02T09:30:00Z');

interface RecordingStore extends TaskStore {
  readonly addCalls: readonly Task[];
}

/** Records every call of `add`, which is the observable of S5. */
function recordingStore(): RecordingStore {
  const addCalls: Task[] = [];
  return {
    addCalls,
    add: (task: Task) => {
      addCalls.push(task);
      return Promise.resolve(task);
    },
    list: () => Promise.resolve([]),
  };
}

async function addCallCountFor(title: unknown): Promise<number> {
  const store = recordingStore();
  await createTask(store, { title, id: 'a1b2c3', now: INSTANT });
  return store.addCalls.length;
}

describe('CHQ-001 S5', () => {
  it('S5_never_calls_add_for_a_title_the_rule_rejects', async () => {
    expect.hasAssertions();
    const refused: readonly unknown[] = ['', '   ', null, 42];
    const attempts = await Promise.all(
      refused.map(async (title) => {
        const store = recordingStore();
        const outcome = await createTask(store, { title, id: 'a1b2c3', now: INSTANT });
        return { status: outcome.status, addCalls: store.addCalls.length };
      }),
    );
    for (const attempt of attempts) {
      expect(attempt.status).toBe('invalid-title');
      expect(attempt.addCalls).toBe(0);
    }
  });

  it('S5_calls_add_once_for_a_title_the_rule_accepts', async () => {
    expect.hasAssertions();
    // The control that gives the assertion above its meaning: a use case that never called
    // the port at all would satisfy "never called" for free.
    expect(await addCallCountFor('Write the README')).toBe(1);
  });

  it('S5_influence_title_differs', async () => {
    expect.hasAssertions();
    const rejected = await addCallCountFor('   ');
    const accepted = await addCallCountFor('Write the README');
    expect(digest(accepted)).not.toBe(digest(rejected));
  });
});
