// The one reader of a rejected promise's reason, so that every state that shows a message shows
// it the same way. A `catch` binding is `unknown`, and `String(cause)` would render
// "Error: ..." into the UI.

export function messageOf(cause: unknown): string {
  if (cause instanceof Error && cause.message !== '') return cause.message;
  return 'the request failed';
}
