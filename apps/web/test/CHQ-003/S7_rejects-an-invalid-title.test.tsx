// CHQ-003 S7 — an empty or whitespace-only title is caught in the form, before the wire.
//
// THE READING THIS FILE TAKES: "NO request is performed at all" cannot mean zero requests in
// the process, because S1 and S8 require the app to fetch the list and the health on mount.
// It means no request CAUSED BY THE SUBMIT, so what is asserted is that no POST was made and
// that the list was not fetched a second time. Reported in the handover.
//
// The validation message is read out of `role="alert"` and only then matched against
// /title/i: the form's own label carries the word "title" too, so a document-wide text query
// would pass on the label alone and assert nothing.
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from '@jest/globals';
import { digest } from '@cheq/core/testing';

import { App } from '../../src/App.tsx';
import { callsTo, cleanup, installFetch, json, pending, present, routes, submitTitle, task, waitForRows } from './support/http.ts';

const mount = (): ReturnType<typeof installFetch> => {
  const mock = installFetch(
    routes({
      tasks: (_path, init) =>
        init?.method === 'POST'
          ? Promise.resolve(json(task('new', 'accepted'), 201))
          : Promise.resolve(json([])),
      health: () => pending(),
    }),
  );
  render(<App />);
  return mock;
};

/** Whether the form complained, and how many POSTs it made, as one digestible value. */
const observe = async (title: string): Promise<string> => {
  cleanup();
  const mock = mount();
  await waitForRows(0);
  await submitTitle(userEvent.setup(), title);
  return digest({
    complained: screen.queryByRole('alert') !== null,
    posts: callsTo(mock, 'POST', '/tasks').length,
  });
};

describe('CHQ-003 S7', () => {
  it('S7_an_empty_title_shows_a_message_naming_the_title_and_performs_no_request', async () => {
    expect.hasAssertions();
    const mock = mount();
    await waitForRows(0);

    await submitTitle(userEvent.setup(), '');

    const message = present(screen.queryByRole('alert'), 'the validation message (role="alert")');
    expect(message.textContent ?? '').toMatch(/title/i);
    expect(callsTo(mock, 'POST', '/tasks').length).toBe(0);
    expect(callsTo(mock, 'GET', '/tasks').length).toBe(1);
  });

  it('S7_a_whitespace_only_title_shows_a_message_naming_the_title_and_performs_no_request', async () => {
    expect.hasAssertions();
    const mock = mount();
    await waitForRows(0);

    await submitTitle(userEvent.setup(), '   ');

    const message = present(screen.queryByRole('alert'), 'the validation message (role="alert")');
    expect(message.textContent ?? '').toMatch(/title/i);
    expect(callsTo(mock, 'POST', '/tasks').length).toBe(0);
    expect(callsTo(mock, 'GET', '/tasks').length).toBe(1);
  });

  it('S7_influence_title_text_differs', async () => {
    expect.hasAssertions();
    const blank = await observe('   ');
    const real = await observe('Write the README');
    expect(real).not.toBe(blank);
  });
});
