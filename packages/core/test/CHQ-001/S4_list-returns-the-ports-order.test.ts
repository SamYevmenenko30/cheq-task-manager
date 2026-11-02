// CHQ-001 S4 — the list use case returns what the port resolved with, in that order.
// Spec: docs/specs/CHQ-001.md. Written before any implementation exists; the single typed
// binding below is explained in S1's header.
import { describe, expect, it } from '@jest/globals';

import type { ListTasks, Task, TaskStore } from '../../src/contracts/CHQ-001/task.ts';
import * as core from '../../src/index.ts';
import { digest } from '../../src/testing/digest.ts';

const listTasks: ListTasks = core.listTasks;

const THREE: readonly Task[] = [
  { id: 'id-1', title: 'first', createdAt: '2026-11-02T09:30:00.000Z' },
  { id: 'id-2', title: 'second', createdAt: '2026-11-02T09:31:00.000Z' },
  { id: 'id-3', title: 'third', createdAt: '2026-11-02T09:32:00.000Z' },
];

/**
 * The same three tasks in a different order. Written out rather than built by indexing
 * `THREE`: `noUncheckedIndexedAccess` makes an element `Task | undefined`, and a cast to
 * hide that would be the evasion the portable subset forbids.
 */
const REORDERED: readonly Task[] = [
  { id: 'id-2', title: 'second', createdAt: '2026-11-02T09:31:00.000Z' },
  { id: 'id-1', title: 'first', createdAt: '2026-11-02T09:30:00.000Z' },
  { id: 'id-3', title: 'third', createdAt: '2026-11-02T09:32:00.000Z' },
];

/** S4's Given: a store port whose `list` resolves with a given sequence. */
function listStore(tasks: readonly Task[]): TaskStore {
  return {
    add: (task: Task) => Promise.resolve(task),
    list: () => Promise.resolve(tasks),
  };
}

describe('CHQ-001 S4', () => {
  it('S4_returns_the_ports_three_tasks_in_order_and_adds_nothing', async () => {
    expect.hasAssertions();
    // `toEqual` over the whole sequence carries both halves of the assertion: the ORDER, and
    // that the use case added nothing of its own.
    expect(await listTasks(listStore(THREE))).toEqual(THREE);
  });

  it('S4_returns_an_empty_list_for_an_empty_store', async () => {
    expect.hasAssertions();
    // An empty store is an empty list and never a failure: the call RESOLVES.
    expect(await listTasks(listStore([]))).toEqual([]);
  });

  it('S4_influence_stored_tasks_differs', async () => {
    expect.hasAssertions();
    const one = await listTasks(listStore(THREE));
    const other = await listTasks(listStore(REORDERED));
    expect(digest(other)).not.toBe(digest(one));
  });
});
