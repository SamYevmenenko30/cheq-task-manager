// The API's health as a polled, three-valued reading.
//
// Two invariants THIS module enforces.
//
//   THE INTERVAL IS CLEARED ON UNMOUNT. A leaked interval outlives the component that owns it,
//   keeps calling whatever `fetch` is current, and shows up as a failure in some LATER test or
//   screen rather than in the one that leaked it.
//
//   A REJECTED CALL AND A NON-`ok` STATUS ARE ONE STATE. S9 asserts that the two read the same:
//   "down" is what the user needs to know, and splitting it would invite a third badge text for
//   a distinction the user cannot act on.

import { useEffect, useState } from 'react';

import { fetchHealth } from '../api/client.ts';

/** `checking` is the state before the first answer — it is neither healthy nor down yet. */
export type Health = 'checking' | 'healthy' | 'down';

/** How often the indicator re-reads `/health` once the page is open. */
export const HEALTH_POLL_MS = 30_000;

export function useHealth(intervalMs: number = HEALTH_POLL_MS): Health {
  const [health, setHealth] = useState<Health>('checking');

  useEffect(() => {
    let live = true;

    const poll = (): void => {
      void fetchHealth().then(
        (ok) => {
          if (live) setHealth(ok ? 'healthy' : 'down');
        },
        () => {
          if (live) setHealth('down');
        },
      );
    };

    poll();
    const timer = setInterval(poll, intervalMs);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [intervalMs]);

  return health;
}
