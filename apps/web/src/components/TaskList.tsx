// The task list and its three states (S1, S2, S3, S4).
//
// Two invariants THIS component enforces.
//
//   EXACTLY ONE STATE IS RENDERED. Loading, error, empty and the list are mutually exclusive
//   branches, so "a loading state is shown and no empty state is" (S2) and "the empty state,
//   not an error" (S3) hold by construction rather than by three independent conditions that
//   could all be true at once.
//
//   ONLY A TASK IS A `listitem`. The empty state is a paragraph, never an `<li>` reading "no
//   tasks yet", so counting rows counts tasks (the gates' `waitForRows(0)` and S2's "no task
//   row" both depend on it).

import type { TasksState } from '../hooks/use-tasks.ts';
import styles from './TaskList.module.css';

/** The date as the row shows it; the ISO instant stays in `dateTime` for a machine to read. */
function readableDate(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? iso : at.toISOString().slice(0, 10);
}

export interface TaskListProps {
  readonly state: TasksState;
}

export function TaskList({ state }: TaskListProps) {
  if (state.status === 'loading') {
    return <p className={styles['note']}>Loading tasks&#8230;</p>;
  }

  if (state.status === 'error') {
    // `role="alert"` is the vision's own word for this state ("show an alert when an API call
    // fails"). The copy deliberately shares no wording with the loading or empty state (S4).
    return (
      <p role="alert" className={styles['failure']}>
        Could not reach the API: {state.message}
      </p>
    );
  }

  if (state.tasks.length === 0) {
    return <p className={styles['note']}>No tasks yet.</p>;
  }

  return (
    <ul className={styles['list']}>
      {state.tasks.map((task) => (
        <li key={task.id} className={styles['row']}>
          <span className={styles['title']}>{task.title}</span>
          <time className={styles['created']} dateTime={task.createdAt}>
            {readableDate(task.createdAt)}
          </time>
        </li>
      ))}
    </ul>
  );
}
