// CHQ-001 S1 — the create use case's VERDICT is decided by the title alone.
// Spec: docs/specs/CHQ-001.md. Written before any implementation exists.
import { describe, expect, it } from '@jest/globals';

import type { CreateTask, CreateTaskInput, Task, TaskStore } from '../../src/contracts/CHQ-001/task.ts';
import * as core from '../../src/index.ts';
import { digest } from '../../src/testing/digest.ts';

/** S1's Given: a store port whose `add` resolves with whatever it is handed. */
function echoStore(): TaskStore {
  return {
    add: (task: Task) => Promise.resolve(task),
    list: () => Promise.resolve([]),
  };
}

/**
 * The one thing CHQ-001 leaves missing, named ONCE per file.
 *
 * The contract says what the use case IS; this line says which symbol must satisfy it. Two
 * consequences, both wanted: every call below is typechecked against `CreateTask` rather than
 * being an unchecked call on an error type, and the file's whole "not written yet" sits on
 * this line instead of at every call site. It is reached through the NAMESPACE on purpose —
 * measured 2026-11-02, a named import of an absent export is an ESM link error, so the file
 * would never load and the artifact would carry no row for any case at all.
 */
const createTask: CreateTask = core.createTask;

const INSTANT = new Date('2026-11-02T09:30:00Z');

function withTitle(title: unknown): CreateTaskInput {
  return { title, id: 'a1b2c3', now: INSTANT };
}

/**
 * The observable of S1 is the VERDICT and nothing else — which is why the influence cases
 * digest the status rather than the task: varying `now` MUST change a `createdAt`, and that
 * would make `now=invariant` unwritable against the whole outcome.
 */
async function verdictOf(input: CreateTaskInput): Promise<string> {
  const outcome = await createTask(echoStore(), input);
  return outcome.status;
}

describe('CHQ-001 S1', () => {
  it('S1_accepts_a_single_character_title', async () => {
    expect.hasAssertions();
    const outcome = await createTask(echoStore(), withTitle('a'));
    expect(outcome.status).toBe('accepted');
  });

  it('S1_rejects_every_title_that_is_not_a_usable_string', async () => {
    expect.hasAssertions();
    const refused: readonly unknown[] = ['', '   ', null, 42];
    const outcomes = await Promise.all(refused.map((title) => createTask(echoStore(), withTitle(title))));
    for (const outcome of outcomes) {
      expect(outcome.status).toBe('invalid-title');
      if (outcome.status !== 'invalid-title') throw new Error('unreachable: the assertion above throws first');
      expect(outcome.reason).not.toBe('');
      expect(outcome).not.toHaveProperty('task');
    }
  });

  it('S1_influence_title_differs', async () => {
    expect.hasAssertions();
    const accepted = await verdictOf(withTitle('a'));
    const rejected = await verdictOf(withTitle('   '));
    expect(digest(rejected)).not.toBe(digest(accepted));
  });

  it('S1_influence_id_invariant', async () => {
    expect.hasAssertions();
    const one = await verdictOf({ title: 'Write the README', id: 'a1b2c3', now: INSTANT });
    const other = await verdictOf({ title: 'Write the README', id: 'z9y8x7', now: INSTANT });
    expect(digest(other)).toBe(digest(one));
  });

  it('S1_influence_now_invariant', async () => {
    expect.hasAssertions();
    const one = await verdictOf({ title: 'Write the README', id: 'a1b2c3', now: INSTANT });
    const other = await verdictOf({ title: 'Write the README', id: 'a1b2c3', now: new Date('2027-03-04T05:06:07Z') });
    expect(digest(other)).toBe(digest(one));
  });
});
