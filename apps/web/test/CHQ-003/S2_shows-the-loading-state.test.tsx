// CHQ-003 S2 — while `GET /tasks` is in flight the app says so, and says nothing else.
//
// One case, not three: the assertion is a single claim with three parts, and a part asserted
// on its own ("no row is shown") is vacuously true of a tree that renders no list at all —
// green on the base, which red-check refuses. The presence assertion therefore comes first
// and the two absences ride with it.
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from '@jest/globals';

import { App } from '../../src/App.tsx';
import { installFetch, pending, rowTexts, routes } from './support/http.ts';

describe('CHQ-003 S2', () => {
  it('S2_shows_a_loading_state_and_neither_a_row_nor_the_empty_state', () => {
    installFetch(routes({ tasks: () => pending(), health: () => pending() }));
    render(<App />);

    expect(screen.queryByText(/loading/i)).not.toBeNull();
    expect(rowTexts()).toEqual([]);
    expect(screen.queryByText(/no tasks? yet/i)).toBeNull();
  });
});
