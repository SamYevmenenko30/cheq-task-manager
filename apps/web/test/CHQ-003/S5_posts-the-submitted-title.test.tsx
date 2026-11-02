// CHQ-003 S5 — submitting the form performs exactly one POST, carrying the typed title.
//
// THE READING THIS FILE TAKES, and the one place CHQ-003 can be read two ways: the assertion
// says the body "carries that title" of `  Write the README  `, while its own `inputs:` line
// declares `surrounding_whitespace=invariant`. An observable that cannot change when the
// surrounding whitespace changes is a TRIMMED title, so that is what is asserted. Both
// clauses then hold at once: the body carries the user's title, and the padding cannot be
// seen. Reported in the handover rather than silently chosen.
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from '@jest/globals';
import { digest } from '@cheq/core/testing';

import { App } from '../../src/App.tsx';
import { callsTo, cleanup, installFetch, json, pending, routes, submitTitle, task, waitForRows } from './support/http.ts';

const PADDED = '  Write the README  ';
const TRIMMED = 'Write the README';

const mount = (): ReturnType<typeof installFetch> => {
  const mock = installFetch(
    routes({
      tasks: (_path, init) =>
        init?.method === 'POST'
          ? Promise.resolve(json(task('new', TRIMMED), 201))
          : Promise.resolve(json([])),
      health: () => pending(),
    }),
  );
  render(<App />);
  return mock;
};

/** The bodies of every POST the form made for `title`, as one digestible value. */
const postedDigest = async (title: string): Promise<string> => {
  cleanup();
  const mock = mount();
  await waitForRows(0);
  await submitTitle(userEvent.setup(), title);
  return digest(callsTo(mock, 'POST', '/tasks').map((c) => c.body));
};

describe('CHQ-003 S5', () => {
  it('S5_performs_exactly_one_post_to_tasks', async () => {
    expect.hasAssertions();
    const mock = mount();
    await waitForRows(0);

    await submitTitle(userEvent.setup(), PADDED);
    expect(callsTo(mock, 'POST', '/tasks').length).toBe(1);
  });

  it('S5_the_post_body_carries_the_title', async () => {
    expect.hasAssertions();
    const mock = mount();
    await waitForRows(0);

    await submitTitle(userEvent.setup(), PADDED);
    const posted = callsTo(mock, 'POST', '/tasks')[0]?.body ?? null;
    expect(posted).toEqual({ title: TRIMMED });
  });

  it('S5_influence_title_text_differs', async () => {
    expect.hasAssertions();
    const readme = await postedDigest('Write the README');
    const deploy = await postedDigest('Deploy the stack');
    expect(deploy).not.toBe(readme);
  });

  it('S5_influence_surrounding_whitespace_invariant', async () => {
    expect.hasAssertions();
    const padded = await postedDigest(PADDED);
    const bare = await postedDigest(TRIMMED);
    expect(bare).toBe(padded);
  });
});
