// The create-task form (S5, S6, S7).
//
// Two invariants THIS component enforces.
//
//   THE TITLE RULE IS NOT RE-WRITTEN HERE. `acceptTitle` is `@cheq/core`'s own function — the
//   same one the API's 400 comes from (`apps/api/src/app.ts`) — so the trim that S5 observes
//   and the refusal that S7 observes are that ONE rule reaching this screen. A `trim() === ''`
//   written here would be a second rule that can disagree with the first while nothing notices.
//
//   A TITLE THE RULE REFUSES NEVER REACHES `fetch`. The guard returns before the request, which
//   is the falsifiable half of "caught in the form before it reaches the API": zero requests,
//   not a 400 handled nicely (S7).

import { useCallback, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import type { Task } from '@cheq/core';
import { INVALID_TITLE_REASON, acceptTitle } from '@cheq/core';

import { createTask } from '../api/client.ts';
import { messageOf } from '../hooks/failure.ts';
import styles from './TaskForm.module.css';

export interface TaskFormProps {
  /** Called with the task the `201` body carried, never with the one that was typed. */
  readonly onCreated: (task: Task) => void;
}

export function TaskForm({ onCreated }: TaskFormProps) {
  const [title, setTitle] = useState('');
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const [sending, setSending] = useState(false);

  // Both handlers are memoised because `react-perf(jsx-no-new-function-as-prop)` is an error
  // here: a function literal in a JSX attribute is a new value on every render, so every render
  // of the form would also re-render the element it is passed to.
  const changeTitle = useCallback((event: ChangeEvent<HTMLInputElement>): void => {
    setTitle(event.target.value);
  }, []);

  const submit = useCallback((event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();

    const accepted = acceptTitle(title);
    if (accepted === undefined) {
      setProblem(INVALID_TITLE_REASON);
      return;
    }

    setProblem(undefined);
    setSending(true);
    void createTask(accepted).then(
      (task) => {
        setSending(false);
        setTitle('');
        onCreated(task);
      },
      (cause: unknown) => {
        setSending(false);
        setProblem(messageOf(cause));
      },
    );
  }, [title, onCreated]);

  return (
    <form className={styles['form']} onSubmit={submit} noValidate>
      <div className={styles['field']}>
        <label className={styles['label']} htmlFor="task-title">
          Title
        </label>
        <input
          className={styles['input']}
          id="task-title"
          name="title"
          type="text"
          value={title}
          autoComplete="off"
          placeholder="What needs doing?"
          onChange={changeTitle}
        />
      </div>
      <button className={styles['submit']} type="submit" disabled={sending}>
        {sending ? 'Adding…' : 'Add task'}
      </button>
      {problem === undefined ? null : (
        <p role="alert" className={styles['problem']}>
          {problem}
        </p>
      )}
    </form>
  );
}
