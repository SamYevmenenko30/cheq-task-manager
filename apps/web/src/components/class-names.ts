// `noUncheckedIndexedAccess` is on, so reading a class out of a CSS module gives
// `string | undefined` — and a template literal would render the word "undefined" into the
// class attribute. This joins only the names that are there.

export function cx(...names: readonly (string | undefined | false)[]): string {
  return names.filter((name): name is string => typeof name === 'string' && name !== '').join(' ');
}
