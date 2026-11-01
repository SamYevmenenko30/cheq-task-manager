// The observable a spec test cites: a short, stable, structural digest of a core state value.
//
// `stableStringify` REFUSES what would make a "deterministic hash" depend on something other
// than the value — a Date (timezone), `undefined` (absent vs present is ambiguous), NaN and
// Infinity (not round-trippable), a function or a symbol (identity, not value), and a cycle.
// Refusing loudly is the point: a digest that silently swallowed a Date would make a test pass
// in one timezone and fail in another, and the spec would be blamed for it.
//
// Map and Set are expanded into SORTED arrays, so insertion order cannot change the digest.
import { sha256Hex } from './sha256.ts';

// A sound guard, not a dressed-up assertion: reading an arbitrary key of ANY non-null object
// legitimately yields `unknown`, which is exactly what this predicate claims.
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function fail(what: string, path: string): never {
  throw new TypeError(
    `digest: refusing to serialise ${what} at ${path === '' ? '<root>' : path} — ` +
      `it would make the digest depend on something other than the value.`,
  );
}

function stringify(value: unknown, path: string, seen: Set<object>): string {
  if (value === null) return 'null';

  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'string':
      return JSON.stringify(value);
    case 'bigint':
      return `${value.toString()}n`;
    case 'number':
      if (Number.isNaN(value)) fail('NaN', path);
      if (!Number.isFinite(value)) fail('Infinity', path);
      return Object.is(value, -0) ? '-0' : value.toString();
    case 'undefined':
      return fail('undefined', path);
    case 'function':
      return fail('a function', path);
    case 'symbol':
      return fail('a symbol', path);
    default:
      break;
  }

  const object = value;
  if (seen.has(object)) fail('a cycle', path);
  seen.add(object);

  let out: string;
  if (object instanceof Date) {
    out = fail('a Date', path);
  } else if (Array.isArray(object)) {
    const items: unknown[] = object;
    out = `[${items.map((item, i) => stringify(item, `${path}[${i}]`, seen)).join(',')}]`;
  } else if (object instanceof Set) {
    const items = [...object].map((item, i) => stringify(item, `${path}#set[${i}]`, seen));
    out = `Set{${items.toSorted().join(',')}}`;
  } else if (object instanceof Map) {
    const entries = [...object].map(([k, v], i) => {
      const key = stringify(k, `${path}#mapkey[${i}]`, seen);
      return `${key}:${stringify(v, `${path}#map[${key}]`, seen)}`;
    });
    out = `Map{${entries.toSorted().join(',')}}`;
  } else {
    const record: Record<string, unknown> = isRecord(object) ? object : {};
    const keys = Object.keys(record).toSorted();
    out = `{${keys
      .map((key) => `${JSON.stringify(key)}:${stringify(record[key], `${path}.${key}`, seen)}`)
      .join(',')}}`;
  }

  seen.delete(object);
  return out;
}

/** The canonical textual form of `state`: key order, Map and Set order cannot affect it. */
export function stableStringify(state: unknown): string {
  return stringify(state, '', new Set<object>());
}

/** The first 16 hex characters of the SHA-256 of `stableStringify(state)`. */
export function digest(state: unknown): string {
  return sha256Hex(stableStringify(state)).slice(0, 16);
}
