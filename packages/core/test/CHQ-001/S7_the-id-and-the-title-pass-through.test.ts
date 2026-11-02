// CHQ-001 S7 — the created task carries exactly the given `id` and the trimmed title.
// Spec: docs/specs/CHQ-001.md. Written before any implementation exists; the single typed
// binding below is explained in S1's header.
import { describe, expect, it } from '@jest/globals';

import type { CreateTask, Task, TaskStore } from '../../src/contracts/CHQ-001/task.ts';
import * as core from '../../src/index.ts';
import { digest } from '../../src/testing/digest.ts';

const createTask: CreateTask = core.createTask;

const INSTANT = new Date('2026-11-02T09:30:00Z');

/** A store port whose `add` resolves with whatever it is handed. */
function echoStore(): TaskStore {
  return {
    add: (task: Task) => Promise.resolve(task),
    list: () => Promise.resolve([]),
  };
}

async function taskFor(id: string, title: unknown = '  Write the README  '): Promise<Task> {
  const outcome = await createTask(echoStore(), { title, id, now: INSTANT });
  expect(outcome.status).toBe('accepted');
  if (outcome.status !== 'accepted') throw new Error('unreachable: the assertion above throws first');
  return outcome.task;
}

describe('CHQ-001 S7', () => {
  it('S7_the_created_task_carries_exactly_the_given_id', async () => {
    expect.hasAssertions();
    expect((await taskFor('a1b2c3')).id).toBe('a1b2c3');
  });

  it('S7_the_created_task_carries_the_trimmed_title', async () => {
    expect.hasAssertions();
    expect((await taskFor('a1b2c3')).title).toBe('Write the README');
  });

  it('S7_the_core_validates_nothing_about_the_id', async () => {
    expect.hasAssertions();
    // The core accepts whatever string it is handed: an empty id is not a failure mode here,
    // because there is exactly one and it is about the title (Q2).
    expect((await taskFor('')).id).toBe('');
  });

  it('S7_changing_the_id_alone_changes_the_created_task', async () => {
    expect.hasAssertions();
    const one = await taskFor('a1b2c3');
    const other = await taskFor('z9y8x7');
    expect(other.id).not.toBe(one.id);
    expect(other.title).toBe(one.title);
    expect(other.createdAt).toBe(one.createdAt);
  });

  it('S7_influence_id_differs', async () => {
    expect.hasAssertions();
    const one = await taskFor('a1b2c3');
    const other = await taskFor('z9y8x7');
    expect(digest(other)).not.toBe(digest(one));
  });

  it('S7_influence_title_differs', async () => {
    expect.hasAssertions();
    const one = await taskFor('a1b2c3', '  Write the README  ');
    const other = await taskFor('a1b2c3', '  a  ');
    expect(digest(other)).not.toBe(digest(one));
  });
});
