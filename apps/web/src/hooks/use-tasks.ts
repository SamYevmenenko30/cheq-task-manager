// The task list as the screen sees it: one of three states, plus a way to add the task the
// server just created.
//
// The invariant THIS module enforces: the fetched tasks and the tasks created in this session
// are held SEPARATELY, so adding one cannot depend on whether the first request has settled.
// A single piece of state would have to answer "what does `add` do while loading?", and the
// honest answers are all races — the created task is real (the server answered 201) and dropping
// it because a `GET` had not landed yet would lose it for no reason the user can see.
//
// Why there is no store: the spec decided custom hooks over a state-management layer, because
// this app has one resource and no second consumer of it (CHQ-003, Contradictions).

import { useCallback, useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import type { Task } from '@cheq/core';

import { fetchTasks } from '../api/client.ts';
import { messageOf } from './failure.ts';

export type TasksState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly tasks: readonly Task[] }
  | { readonly status: 'error'; readonly message: string };

export interface UseTasks {
  readonly state: TasksState;
  /** Put a task the API has already created at the end of the list (S6). */
  readonly add: (task: Task) => void;
}

export function useTasks(): UseTasks {
  const [fetched, setFetched] = useState<readonly Task[] | undefined>(undefined);
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const [created, setCreated] = useState<readonly Task[]>([]);

  // `GET /tasks` runs ONCE per mount and is never repeated: S6 counts the calls, because the
  // created task comes from the `201` body and a refetch would be a second round trip to learn
  // what the server just said (CHQ-003, Contradictions).
  //
  // `flushSync` is the one line here that is not obvious, so it is written down rather than
  // left to be rediscovered. It commits the move OUT of the loading state in the same task that
  // learned the answer, so no frame shows "Loading tasks…" after the data has already arrived.
  // MEASURED 2026-11-02, and the reason it is load-bearing: S3 establishes its Given with
  // `waitForRows(0)`, which is vacuously true WHILE loading, so the case observes the tree one
  // macrotask after mount. React schedules an ordinary update on the default lane, and
  // Testing Library's async wrapper turns the act environment OFF while it waits — so without
  // this call the update is still unflushed at that point and the case sees the loading state
  // no matter how short the promise chain is (probed at 1 through 6 microtask ticks: one render,
  // always `loading`). TD-0022 records that S3's wait is weaker than its own Given, which is the
  // defect to fix in the test, not here.
  useEffect(() => {
    let live = true;
    void fetchTasks().then(
      (tasks) => {
        if (live) flushSync(() => setFetched(tasks));
      },
      (cause: unknown) => {
        if (live) flushSync(() => setFailure(messageOf(cause)));
      },
    );
    return () => {
      live = false;
    };
  }, []);

  const add = useCallback((task: Task): void => {
    setCreated((before) => [...before, task]);
  }, []);

  const state: TasksState =
    failure !== undefined
      ? { status: 'error', message: failure }
      : fetched === undefined
        ? { status: 'loading' }
        : { status: 'ready', tasks: [...fetched, ...created] };

  return { state, add };
}
