// CHQ-003 S3 — an empty response is its own state, distinct from loading and from an error.
//
// "no tasks yet" is the VISION's own copy for this state ("empty (no tasks yet)"), so the
// regex quotes the vision rather than inventing a string. The same reason puts /loading/i in
// S2 and `role="alert"` in S4 — §15 of the vision says "show an alert when an API call
// fails".
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from '@jest/globals';

import { App } from '../../src/App.tsx';
import { installFetch, json, pending, rowTexts, routes, waitForRows } from './support/http.ts';

describe('CHQ-003 S3', () => {
  it('S3_shows_the_empty_state_and_neither_loading_nor_an_error_nor_a_row', async () => {
    expect.hasAssertions();
    installFetch(routes({ tasks: () => Promise.resolve(json([])), health: () => pending() }));
    render(<App />);

    await waitForRows(0);
    expect(screen.queryByText(/no tasks? yet/i)).not.toBeNull();
    expect(screen.queryByText(/loading/i)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(rowTexts()).toEqual([]);
  });
});
