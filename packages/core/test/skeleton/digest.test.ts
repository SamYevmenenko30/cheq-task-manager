// Skeleton fixture: spec-less, never red-checked, never a spec's check:. It exists because a
// hand-written SHA-256 that is subtly wrong would still look like a stable digest — the only
// honest check is the published vectors, including the 56-byte case where the padding branch
// changes.
import { describe, expect, it } from '@jest/globals';

import { digest, stableStringify } from '../../src/testing/digest.ts';
import { sha256Hex, utf8Bytes } from '../../src/testing/sha256.ts';

describe('sha256 against the published vectors', () => {
  it('hashes the empty string', () => {
    expect(sha256Hex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('hashes "abc"', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('hashes the 56-byte message, where the padding branch changes', () => {
    expect(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
  });

  it('hashes a message longer than one block', () => {
    expect(sha256Hex('The quick brown fox jumps over the lazy dog')).toBe(
      'd7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592',
    );
  });
});

describe('utf8 encoding is the encoder, not the platform', () => {
  it('encodes a two-byte code point', () => {
    expect(utf8Bytes('é')).toEqual([0xc3, 0xa9]);
  });

  it('encodes a surrogate pair as four bytes', () => {
    expect(utf8Bytes('\u{1f600}')).toEqual([0xf0, 0x9f, 0x98, 0x80]);
  });
});

describe('the digest depends on the value and nothing else', () => {
  it('ignores object key order', () => {
    expect(digest({ a: 1, b: 2 })).toBe(digest({ b: 2, a: 1 }));
  });

  it('ignores Set insertion order', () => {
    expect(digest(new Set(['x', 'y']))).toBe(digest(new Set(['y', 'x'])));
  });

  it('ignores Map insertion order', () => {
    const one = new Map([
      ['k1', 1],
      ['k2', 2],
    ]);
    const two = new Map([
      ['k2', 2],
      ['k1', 1],
    ]);
    expect(digest(one)).toBe(digest(two));
  });

  it('separates a Set from an array with the same members', () => {
    expect(digest(new Set(['x']))).not.toBe(digest(['x']));
  });

  it('is 16 hex characters', () => {
    expect(digest({ a: 1 })).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('the digest refuses what would make it depend on something else', () => {
  it('refuses a Date', () => {
    expect(() => stableStringify({ at: new Date(0) })).toThrow(/a Date/);
  });

  it('refuses undefined', () => {
    expect(() => stableStringify({ a: undefined })).toThrow(/undefined/);
  });

  it('refuses NaN', () => {
    expect(() => stableStringify({ a: Number.NaN })).toThrow(/NaN/);
  });

  it('refuses a cycle', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic['self'] = cyclic;
    expect(() => stableStringify(cyclic)).toThrow(/a cycle/);
  });

  it('names the path of the offending value', () => {
    expect(() => stableStringify({ outer: { inner: Number.NaN } })).toThrow(/\.outer\.inner/);
  });
});
