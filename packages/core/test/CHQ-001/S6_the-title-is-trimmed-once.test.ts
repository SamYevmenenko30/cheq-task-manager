// CHQ-001 S6 — the surrounding whitespace is removed once, where the title is validated.
// Spec: docs/specs/CHQ-001.md. Written before any implementation exists; the single typed
// binding below is explained in S1's header.
import { describe, expect, it } from '@jest/globals';

import type { CreateTask, Task, TaskStore } from '../../src/contracts/CHQ-001/task.ts';
import * as core from '../../src/index.ts';
import { digest } from '../../src/testing/digest.ts';

const createTask: CreateTask = core.createTask;

const INSTANT = new Date('2026-11-02T09:30:00Z');

const PADDED = '  Write the README  ';
const TRIMMED = 'Write the README';

interface RecordingStore extends TaskStore {
  readonly handed: readonly Task[];
}

/** Records the task handed to `add` and resolves with it, so both sides of S6 are readable. */
function recordingEchoStore(): RecordingStore {
  const handed: Task[] = [];
  return {
    handed,
    add: (task: Task) => {
      handed.push(task);
      return Promise.resolve(task);
    },
    list: () => Promise.resolve([]),
  };
}

describe('CHQ-001 S6', () => {
  it('S6_the_task_handed_to_the_port_carries_the_trimmed_title', async () => {
    expect.hasAssertions();
    const store = recordingEchoStore();
    await createTask(store, { title: PADDED, id: 'a1b2c3', now: INSTANT });
    expect(store.handed.map((task) => task.title)).toEqual([TRIMMED]);
  });

  it('S6_the_returned_task_carries_the_trimmed_title', async () => {
    expect.hasAssertions();
    const outcome = await createTask(recordingEchoStore(), { title: PADDED, id: 'a1b2c3', now: INSTANT });
    expect(outcome.status).toBe('accepted');
    if (outcome.status !== 'accepted') throw new Error('unreachable: the assertion above throws first');
    expect(outcome.task.title).toBe(TRIMMED);
  });

  it('S6_influence_title_differs', async () => {
    expect.hasAssertions();
    const store = recordingEchoStore();
    const one = await createTask(store, { title: PADDED, id: 'a1b2c3', now: INSTANT });
    const other = await createTask(store, { title: '  a  ', id: 'a1b2c3', now: INSTANT });
    expect(digest(other)).not.toBe(digest(one));
  });
});
