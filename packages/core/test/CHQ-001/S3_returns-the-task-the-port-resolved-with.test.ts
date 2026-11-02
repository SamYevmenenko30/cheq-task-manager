// CHQ-001 S3 — the create use case returns the task the PORT resolved with.
// Spec: docs/specs/CHQ-001.md. Written before any implementation exists; the single typed
// binding below is explained in S1's header.
import { describe, expect, it } from '@jest/globals';

import type { CreateTask, Task, TaskStore } from '../../src/contracts/CHQ-001/task.ts';
import * as core from '../../src/index.ts';
import { digest } from '../../src/testing/digest.ts';

const createTask: CreateTask = core.createTask;

const INSTANT = new Date('2026-11-02T09:30:00Z');

const RESOLVED: Task = {
  id: 'the-id-the-port-chose',
  title: 'the title the port chose',
  createdAt: '2020-01-01T00:00:00.000Z',
};

interface RecordingStore extends TaskStore {
  readonly handed: readonly Task[];
}

/**
 * S3's Given: `add` resolves on a LATER tick with a task that DIFFERS from the one handed.
 *
 * The later tick is a MICROtask. With `types: []` and `lib: ["es2023"]` this package has no
 * timer in its type surface at all, so `setTimeout` is not a name a core test may use; a
 * resolved promise chained once is the later tick available here, and it is enough — a use
 * case that returned its own argument fails on the VALUE, whatever the delay.
 */
function laterTickStore(resolved: Task): RecordingStore {
  const handed: Task[] = [];
  return {
    handed,
    add: (task: Task) => {
      handed.push(task);
      return Promise.resolve().then(() => resolved);
    },
    list: () => Promise.resolve([]),
  };
}

describe('CHQ-001 S3', () => {
  it('S3_returns_the_task_the_port_resolved_with', async () => {
    expect.hasAssertions();
    const outcome = await createTask(laterTickStore(RESOLVED), {
      title: 'Write the README',
      id: 'a1b2c3',
      now: INSTANT,
    });
    expect(outcome.status).toBe('accepted');
    if (outcome.status !== 'accepted') throw new Error('unreachable: the assertion above throws first');
    expect(outcome.task).toEqual(RESOLVED);
  });

  it('S3_does_not_return_the_task_it_handed_to_the_port', async () => {
    expect.hasAssertions();
    const store = laterTickStore(RESOLVED);
    const outcome = await createTask(store, { title: 'Write the README', id: 'a1b2c3', now: INSTANT });
    expect(outcome.status).toBe('accepted');
    if (outcome.status !== 'accepted') throw new Error('unreachable: the assertion above throws first');
    expect(store.handed).toHaveLength(1);
    expect(outcome.task.id).not.toBe('a1b2c3');
    expect(outcome.task.id).toBe(RESOLVED.id);
  });

  it('S3_influence_resolved_task_differs', async () => {
    expect.hasAssertions();
    const input = { title: 'Write the README', id: 'a1b2c3', now: INSTANT };
    const one = await createTask(laterTickStore(RESOLVED), input);
    const other = await createTask(
      laterTickStore({ id: 'another-id', title: 'another title', createdAt: '2021-02-03T04:05:06.000Z' }),
      input,
    );
    expect(digest(other)).not.toBe(digest(one));
  });

  it('S3_influence_title_invariant', async () => {
    expect.hasAssertions();
    // The port resolves with a FIXED task, so what the use case RETURNS cannot depend on the
    // title it was given.
    const one = await createTask(laterTickStore(RESOLVED), {
      title: 'Write the README',
      id: 'a1b2c3',
      now: INSTANT,
    });
    const other = await createTask(laterTickStore(RESOLVED), { title: 'a', id: 'a1b2c3', now: INSTANT });
    expect(digest(other)).toBe(digest(one));
  });
});
