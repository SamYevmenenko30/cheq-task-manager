// CHQ-003 S6 — the created task comes from the 201 body, and the list is NOT refetched.
//
// The spec decided this (Contradictions): `POST /tasks` already returns the created task
// (CHQ-002 S4), so a refetch would be a second round trip to learn what the server just
// said. The falsifiable half is the call count, which is why `GET /tasks` is counted rather
// than the row alone.
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from '@jest/globals';

import { App } from '../../src/App.tsx';
import { callsTo, installFetch, json, pending, rowTexts, routes, submitTitle, task, waitForRows } from './support/http.ts';

const TITLE = 'Write the README';

describe('CHQ-003 S6', () => {
  it('S6_shows_the_created_task_without_fetching_the_list_again', async () => {
    expect.hasAssertions();
    const mock = installFetch(
      routes({
        tasks: (_path, init) =>
          init?.method === 'POST'
            ? Promise.resolve(json(task('created', TITLE), 201))
            : Promise.resolve(json([])),
        health: () => pending(),
      }),
    );
    render(<App />);
    await waitForRows(0);

    await submitTitle(userEvent.setup(), TITLE);

    await waitForRows(1);
    expect(rowTexts()[0] ?? '').toContain(TITLE);
    expect(callsTo(mock, 'GET', '/tasks').length).toBe(1);
  });
});
