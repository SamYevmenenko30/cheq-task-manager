// CHQ-001's list use case (S4).
//
// The invariant THIS module enforces: the port's sequence is returned untouched — nothing
// added, nothing reordered. The core promises no order at all (spec Q3); whatever order a
// caller observes is the adapter's, and is asserted where it is produced.

import type { ListTasks } from '../contracts/CHQ-001/task.ts';

export const listTasks: ListTasks = (store) => store.list();
