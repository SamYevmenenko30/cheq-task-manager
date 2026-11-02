// CHQ-001 S2 — `createdAt` is the ISO-8601 instant of the `now` the use case was given.
// Spec: docs/specs/CHQ-001.md. Written before any implementation exists; the single typed
// binding below is explained in S1's header.
import { describe, expect, it } from '@jest/globals';

import type { CreateTask, Task, TaskStore } from '../../src/contracts/CHQ-001/task.ts';
import * as core from '../../src/index.ts';
import { digest } from '../../src/testing/digest.ts';

/** A store port whose `add` resolves with whatever it is handed. */
function echoStore(): TaskStore {
  return {
    add: (task: Task) => Promise.resolve(task),
    list: () => Promise.resolve([]),
  };
}

const createTask: CreateTask = core.createTask;

const INSTANT = new Date('2026-11-02T09:30:00Z');
const OTHER_INSTANT = new Date('2027-03-04T05:06:07Z');

async function createdAtFor(now: Date, title: unknown = 'Write the README'): Promise<string> {
  const outcome = await createTask(echoStore(), { title, id: 'a1b2c3', now });
  expect(outcome.status).toBe('accepted');
  if (outcome.status !== 'accepted') throw new Error('unreachable: the assertion above throws first');
  return outcome.task.createdAt;
}

describe('CHQ-001 S2', () => {
  it('S2_the_same_now_gives_the_same_createdAt', async () => {
    expect.hasAssertions();
    // Two DISTINCT Date objects for the SAME instant: the use case must read the instant,
    // not the identity of the object it was handed.
    const one = await createdAtFor(new Date('2026-11-02T09:30:00Z'));
    const other = await createdAtFor(new Date('2026-11-02T09:30:00Z'));
    expect(other).toBe(one);
  });

  it('S2_a_different_now_gives_a_different_createdAt', async () => {
    expect.hasAssertions();
    const one = await createdAtFor(INSTANT);
    const other = await createdAtFor(OTHER_INSTANT);
    expect(other).not.toBe(one);
  });

  it('S2_createdAt_is_the_utc_iso_instant_of_the_given_now', async () => {
    expect.hasAssertions();
    expect(await createdAtFor(INSTANT)).toBe('2026-11-02T09:30:00.000Z');
  });

  it('S2_influence_now_differs', async () => {
    expect.hasAssertions();
    const one = await createdAtFor(INSTANT);
    const other = await createdAtFor(OTHER_INSTANT);
    expect(digest(other)).not.toBe(digest(one));
  });

  it('S2_influence_title_invariant', async () => {
    expect.hasAssertions();
    const one = await createdAtFor(INSTANT, 'Write the README');
    const other = await createdAtFor(INSTANT, 'a');
    expect(digest(other)).toBe(digest(one));
  });
});
