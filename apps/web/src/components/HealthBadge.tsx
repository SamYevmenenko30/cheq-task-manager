// The API health indicator (S8, S9, S10).
//
// Two invariants THIS component enforces.
//
//   THE STATES DIFFER BY TEXT, not by colour. A colour-only badge is unreadable to a
//   colour-blind reader and invisible to a test — the vision's "green/red badge" is the
//   example, not the requirement (S8).
//
//   IT IS ONE ELEMENT WHOSE TEXT CHANGES, never a different element per state. S10 asserts
//   that the very node seen while the API was down is still connected once it recovers, which
//   is how "without the page being reloaded" is observable from inside the document; branching
//   on the state to render a different tag would replace that node.
//
// And one thing it deliberately does NOT render: an indicator while the first answer is still
// in flight. An indicator present before anything is known would state something about the
// API's health that nobody has checked — a reader (or a test) comparing "checking" against the
// two real states would find a THIRD state that differs from both.

import type { Health } from '../hooks/use-health.ts';
import { cx } from './class-names.ts';
import styles from './HealthBadge.module.css';

const TEXT = {
  healthy: 'API: healthy',
  down: 'API: unreachable',
} as const satisfies Record<Exclude<Health, 'checking'>, string>;

export interface HealthBadgeProps {
  readonly health: Health;
}

export function HealthBadge({ health }: HealthBadgeProps) {
  if (health === 'checking') return null;

  return (
    <p
      role="status"
      aria-label="API health"
      data-health={health}
      className={cx(styles['badge'], styles[health])}
    >
      {TEXT[health]}
    </p>
  );
}
