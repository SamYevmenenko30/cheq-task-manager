// Contracts for CHQ-001, added by the TEST phase under that spec's `contracts: allowed`
// front matter (docs/specs/CHQ-001.md). Types ONLY: no function bodies, no factories, no
// initialised values. Every type here is derived from an ASSERTION of that spec; the
// spec's Appendix was not read.
//
// The invariant THIS file carries: time and the id enter as arguments. `now` is a `Date`
// the caller supplies and `id` is a string the core passes through unvalidated (S7, Q2),
// so nothing declared here can read a clock or mint a value.

/**
 * The shape of Vision §6. "Suggested task shape (you may add fields)" governs the whole
 * shape, so no reader may assert a field ABSENT — which is why the tests that judge a task
 * name the fields they assert instead of comparing the whole object to a literal.
 */
export interface Task {
  readonly id: string;
  readonly title: string;
  /** The ISO-8601 instant of the `now` the use case was given, UTC with a `Z` suffix (S2). */
  readonly createdAt: string;
}

/**
 * The data-access port. Both methods are asynchronous whatever the adapter behind them is
 * (§4); the adapter itself is `apps/api`'s, never this package's (Cross-package effects).
 */
export interface TaskStore {
  add(task: Task): Promise<Task>;
  list(): Promise<readonly Task[]>;
}

/**
 * What the create use case is handed.
 *
 * `title` is `unknown` and that is forced, not stylistic: S1 asserts a verdict for values
 * that are not strings at all (`null`, `42`), and a narrower type would make those
 * assertions unwritable without a cast — which is exactly what the portable subset forbids.
 */
export interface CreateTaskInput {
  readonly title: unknown;
  readonly id: string;
  readonly now: Date;
}

/**
 * The verdict of S1: accepted with the task, or the ONE invalid-title failure carrying its
 * reason and no task. A named union for a single failure mode rather than a generic
 * `Result<T, E>` — the choice the spec's Non-goals record.
 */
export type CreateTaskOutcome =
  | { readonly status: 'accepted'; readonly task: Task }
  | { readonly status: 'invalid-title'; readonly reason: string };

/** The create use case (S1, S2, S3, S5, S6, S7). */
export type CreateTask = (store: TaskStore, input: CreateTaskInput) => Promise<CreateTaskOutcome>;

/** The list use case (S4). It has no failure: an empty store is an empty list. */
export type ListTasks = (store: TaskStore) => Promise<readonly Task[]>;
