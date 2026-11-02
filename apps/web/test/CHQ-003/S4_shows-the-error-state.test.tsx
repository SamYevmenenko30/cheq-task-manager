// CHQ-003 S4 — a rejected `GET /tasks` is an error state, and it is not the other two.
//
// The error is addressed by `role="alert"`, which is the vision's own word for it (§15,
// "show an alert when an API call fails"). "the error text is not the loading or empty text"
// is asserted on the alert's own text, so a tree that labels its error with the loading copy
// fails here.
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from '@jest/globals';

import { App } from '../../src/App.tsx';
import { installFetch, pending, present, rowTexts, routes } from './support/http.ts';

describe('CHQ-003 S4', () => {
  it('S4_shows_an_error_state_whose_text_is_neither_the_loading_nor_the_empty_text', async () => {
    expect.hasAssertions();
    installFetch(routes({ tasks: () => Promise.reject(new Error('the API is down')), health: () => pending() }));
    render(<App />);

    const alert = await waitFor(() => present(screen.queryByRole('alert'), 'the error state (role="alert")'));
    const text = alert.textContent ?? '';
    expect(text.length).toBeGreaterThan(0);
    expect(text).not.toMatch(/loading/i);
    expect(text).not.toMatch(/no tasks? yet/i);
    expect(rowTexts()).toEqual([]);
  });
});
