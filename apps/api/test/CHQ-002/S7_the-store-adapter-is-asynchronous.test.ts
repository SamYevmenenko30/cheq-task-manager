// CHQ-002 S7 — the in-memory store adapter, judged ALONE and away from any route: `list()`
// and `add()` each return a Promise (`.then` is a function on the returned value) and the
// resolved value is the data. Vision §2's "asynchronous the way a real database driver would
// be", asserted at the port itself rather than at a call site that could be wrapping a
// synchronous function.
// Spec: docs/specs/CHQ-002.md, body only. Written before any implementation exists; the
// single typed binding below is explained in S1's header.
import type { Task } from '@cheq/core';
import { describe, expect, it } from '@jest/globals';

import * as api from '../../src/index.ts';
import type { CreateInMemoryTaskStore } from './support/app.ts';

const createInMemoryTaskStore: CreateInMemoryTaskStore = api.createInMemoryTaskStore;

/** A task already carrying the fields the core's use case would have produced. */
const TASK: Task = {
  id: 'a1b2c3',
  title: 'Write the README',
  createdAt: '2026-11-02T09:30:00.000Z',
};

describe('CHQ-002 S7', () => {
  it('S7_list_returns_a_promise_that_resolves_to_the_data', async () => {
    expect.hasAssertions();
    const store = createInMemoryTaskStore();
    const returned = store.list();
    // The TYPE promises a Promise; this asks the runtime. A synchronous adapter returning the
    // array directly typechecks against the port and fails right here, which is the whole
    // point of asserting at the port.
    expect(typeof returned.then).toBe('function');
    expect(await returned).toEqual([]);
  });

  it('S7_add_returns_a_promise_that_resolves_to_the_data', async () => {
    expect.hasAssertions();
    const store = createInMemoryTaskStore();
    const returned = store.add(TASK);
    expect(typeof returned.then).toBe('function');
    expect(await returned).toEqual(TASK);
  });

  it('S7_what_add_stored_is_what_list_resolves_with', async () => {
    expect.hasAssertions();
    const store = createInMemoryTaskStore();
    await store.add(TASK);
    // "the resolved value is the data", for `list`: a port that always resolved with `[]`
    // would satisfy the first case and fail this one.
    expect(await store.list()).toEqual([TASK]);
  });
});
