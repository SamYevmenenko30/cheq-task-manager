// CHQ-001's create use case (S1, S2, S3, S5, S6, S7).
//
// Two invariants THIS module enforces. The rule runs before the store, so a title the rule
// refuses never reaches the port and cannot be persisted and then reported as an error (S5).
// And the task that comes back is the one the port RESOLVED with, not the one handed to it
// (S3) — the port is where a task becomes real, so its answer is the one that counts.

import type { CreateTask } from '../contracts/CHQ-001/task.ts';
import { INVALID_TITLE_REASON, acceptTitle } from './title-rule.ts';

export const createTask: CreateTask = async (store, input) => {
  const title = acceptTitle(input.title);
  if (title === undefined) {
    return { status: 'invalid-title', reason: INVALID_TITLE_REASON };
  }

  // `createdAt` is the instant of the `now` the caller supplied, and the `id` passes through
  // unread (S7): this package has no clock and no id source of its own.
  const task = await store.add({ id: input.id, title, createdAt: input.now.toISOString() });
  return { status: 'accepted', task };
};
