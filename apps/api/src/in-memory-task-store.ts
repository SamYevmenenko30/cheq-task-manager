// The in-memory adapter behind `@cheq/core`'s `TaskStore` port (CHQ-002 S7). It lives here and
// not in the core because an adapter inside `packages/core` would let a core test reach the real
// store instead of a mock (CHQ-001's probe decision 1).
//
// Two invariants THIS module enforces. Both methods are asynchronous in themselves — `async`,
// not a synchronous body a caller wraps — because the port is what a real driver sits behind
// (Vision §2, S7). And `list` resolves with a COPY: the array is this adapter's state, and a
// caller that could mutate what it was handed would be writing to the store through a read.

import type { Task, TaskStore } from '@cheq/core';

export function createInMemoryTaskStore(): TaskStore {
  // Insertion order is this adapter's promise (S3): the core returns the port's sequence
  // untouched and promises no order of its own (CHQ-001's Q3), so the order a client observes
  // is the order of this array.
  const tasks: Task[] = [];

  return {
    async add(task: Task): Promise<Task> {
      tasks.push(task);
      return task;
    },
    async list(): Promise<readonly Task[]> {
      return [...tasks];
    },
  };
}
