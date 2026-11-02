// The one screen. There are no client-side routes — one page, one view (CHQ-003,
// Contradictions): `infra/cdn.tf` carries no distribution-wide `custom_error_response`, because
// mapping `404 -> /index.html 200` would rewrite a genuine API 404 into an HTML page with
// status 200.
//
// The invariant THIS module enforces: it composes and holds no rule. The title rule is
// `@cheq/core`'s, the request shapes are `api/client.ts`'s, and each state belongs to the
// component that renders it — so this file has nothing to get wrong except the layout.

import { HealthBadge } from './components/HealthBadge.tsx';
import { TaskForm } from './components/TaskForm.tsx';
import { TaskList } from './components/TaskList.tsx';
import { useHealth } from './hooks/use-health.ts';
import { useTasks } from './hooks/use-tasks.ts';
import styles from './App.module.css';

export function App() {
  const { state, add } = useTasks();
  const health = useHealth();

  return (
    <main className={styles['page']}>
      <header className={styles['header']}>
        <h1 className={styles['heading']}>cheq</h1>
        <HealthBadge health={health} />
      </header>

      <section className={styles['section']} aria-label="Add a task">
        <TaskForm onCreated={add} />
      </section>

      <section className={styles['section']} aria-label="Tasks">
        <TaskList state={state} />
      </section>
    </main>
  );
}
