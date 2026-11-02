// The entry point of @cheq/core: the task model, the rules over it, and the data-access
// PORT the rules are written against. Its domain arrives through specs
// (docs/specs/CHQ-<nnn>.md), never through an agent's invention — CHQ-001 is the first, and
// brings the task shape, the title rule and the two use cases below.
//
// The invariant THIS package enforces: everything exported from here runs with no DOM, no
// node builtins and no clock of its own — time, the id and storage enter as arguments. The
// adapter behind `TaskStore` lives in apps/api, never here.

export const CORE_PACKAGE = '@cheq/core' as const;

export type {
  CreateTask,
  CreateTaskInput,
  CreateTaskOutcome,
  ListTasks,
  Task,
  TaskStore,
} from './contracts/CHQ-001/task.ts';
export { createTask } from './tasks/create-task.ts';
export { listTasks } from './tasks/list-tasks.ts';
