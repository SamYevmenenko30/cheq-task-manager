// Vision §5's rule — "The body must include title, a non-empty string" — and the ONE place
// the title is trimmed (CHQ-001 S6, answering Q1).
//
// The invariant THIS module enforces: a title leaves here trimmed or not at all. No later
// reader of a `Task` has to decide whether to trim it again, and nothing else in this
// package decides what "non-empty" means.

/**
 * The reason the single failure of CHQ-001 carries. S1 asserts only that it is not empty;
 * it names the field because that is the one thing this rule judges.
 */
export const INVALID_TITLE_REASON = 'title must be a non-empty string';

/**
 * The trimmed title, or `undefined` when the rule refuses it — a value that is not a string
 * at all, or one that is nothing but whitespace.
 *
 * `unknown` in, because the value has crossed a JSON boundary before it reaches here: S1
 * asserts a verdict for `null` and `42`, not only for `""`.
 */
export function acceptTitle(title: unknown): string | undefined {
  if (typeof title !== 'string') return undefined;
  const trimmed = title.trim();
  return trimmed === '' ? undefined : trimmed;
}
