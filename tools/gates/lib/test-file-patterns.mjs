// The ONE classification of paths. spec-gate, test-guard, red-check and the lights all import
// this module, because a path classified twice is a path that slips between two gates.
//
// Zero dependencies, Node 22 ESM, built-ins only (this module needs none at all): a gate has to
// run in a fresh worktree before an install finishes.
//
// What is a legal form, and where each one comes from:
//
//   spec test   packages/core/test/CHQ-<nnn>/S<n>_<slug>.test.ts
//               apps/api/test/CHQ-<nnn>/S<n>_<slug>.test.ts
//               apps/web/test/CHQ-<nnn>/S<n>_<slug>.test.ts(x)
//   e2e test    e2e/CHQ-<nnn>/S<n>_<slug>.spec.ts
//   support     <test dir>/**/{Support,Fixtures,support,fixtures}/*.ts(x)
//   skeleton    <test dir>/skeleton/<name>.test.ts(x)   — guarded: NEVER red-checked, never a
//               spec's check:, because it has no spec to be red against
//   test config vitest.config.ts · playwright.config.ts · apps/web/test/setup.ts ·
//               **/vite.config.ts · **/tsconfig*.json — guarded, because narrowing an `include`
//               throws tests out of the run without touching a single test file
//   contract    packages/core/src/contracts/CHQ-<nnn>/*.ts — only when a spec says
//               `contracts: allowed`
//
// Anything else under a test directory is `unclassified-test`, which is CANNOT VERIFY for every
// caller — never green, never silently skipped. That is deliberate: a file a gate cannot name is
// a file nobody is judging.
//
// The accepted EXTENSIONS per kind are not a style preference, they are the collectors:
//   core / core-dom  include: ['test/**/*.test.ts']        vitest.config.ts:23, vitest.config.ts:34
//   api              include: ['test/**/*.test.ts']        vitest.config.ts:42
//   web              include: ['test/**/*.test.{ts,tsx}']  vitest.config.ts:51
//   e2e              testDir: './e2e'                      playwright.config.ts:10
// So `.tsx` under packages/core/test is NOT collected by Vitest, and this module says
// unclassified-test for it rather than pretending the runner would see it. Conversely web
// accepts BOTH extensions, because refusing `.test.ts` there would leave a file that RUNS and
// nothing classifies.
//
// Playwright's default testMatch also matches `*.test.ts` under e2e/ — a file named that way
// would run while this module calls it unclassified-test (CANNOT VERIFY). The cure is the name:
// e2e cases are `.spec.ts`. UNVERIFIED: the default testMatch pattern is read from Playwright's
// documentation, not measured here; playwright.config.ts declares no testMatch of its own.

/** The four spec kinds. A kind is also the Vitest project name for core/api/web. */
export const KINDS = ['core', 'api', 'web', 'e2e'];

/** Closed vocabulary of `classify().form`. Nothing outside this list is ever returned. */
export const FORMS = [
  'spec-test',
  'e2e-test',
  'support',
  'skeleton',
  'test-config',
  'contract',
  'unclassified-test',
  'not-a-test',
  'invalid',
];

/** Forms whose presence is CANNOT VERIFY for the caller: a test file nobody can place. */
export const CANNOT_VERIFY_FORMS = new Set(['unclassified-test', 'invalid']);

/**
 * Forms that are guarded rather than judged: a change to one of these must be declared, but the
 * file itself is never red-checked and is never a spec's `check:` target.
 */
export const GUARDED_FORMS = new Set(['skeleton', 'test-config', 'support']);

/** The workspace root of each kind. */
export const KIND_ROOT = Object.freeze({
  core: 'packages/core',
  api: 'apps/api',
  web: 'apps/web',
  e2e: 'e2e',
});

/** The test directory of each kind. e2e has no `test/` level — the whole `e2e/` tree is it. */
export const TEST_DIR = Object.freeze({
  core: 'packages/core/test',
  api: 'apps/api/test',
  web: 'apps/web/test',
  e2e: 'e2e',
});

/** Accepted suffixes per kind — exactly what that kind's runner collects (see the header). */
export const TEST_EXT = Object.freeze({
  core: ['.test.ts'],
  api: ['.test.ts'],
  web: ['.test.ts', '.test.tsx'],
  e2e: ['.spec.ts'],
});

/**
 * Directory names that hold helpers rather than cases. Four spellings on purpose: the plan writes
 * them lowercase, this repository's APFS volume is case-insensitive, and a gate that answered
 * `support` for one spelling and CANNOT VERIFY for the other would be a coin toss on which
 * machine wrote the file. Mixed spellings such as `SUPPORT/` are NOT accepted.
 */
export const SUPPORT_DIRS = new Set(['Support', 'Fixtures', 'support', 'fixtures']);

/** Test configuration files: guarded by exact path. */
export const TEST_CONFIG_FILES = new Set([
  'vitest.config.ts',
  'playwright.config.ts',
  'apps/web/test/setup.ts',
]);

const SPEC_DIR_RE = /^CHQ-\d{3}$/;
// S<n> with no leading zero, then a lowercase kebab slug, then the suffix.
const CASE_FILE_RE = /^S([1-9]\d*)_([a-z0-9]+(?:-[a-z0-9]+)*)\.(test\.tsx?|spec\.ts)$/;
const TSCONFIG_RE = /^tsconfig(\.[A-Za-z0-9._-]+)?\.json$/;
const VITE_CONFIG_RE = /^vite\.config\.ts$/;
const WORKSPACE_DIR_RE = /^(packages|apps)\/[^/]+$/;

function normalize(input) {
  if (typeof input !== 'string') return { ok: false, reason: 'path is not a string' };
  let p = input.replace(/\\/g, '/').replace(/\/{2,}/g, '/');
  while (p.startsWith('./')) p = p.slice(2);
  if (p === '' || p === '.') return { ok: false, reason: 'empty path' };
  if (p.startsWith('/')) {
    return { ok: false, reason: 'absolute path — classify() takes repo-relative paths' };
  }
  if (/^[A-Za-z]:/.test(p)) {
    return { ok: false, reason: 'drive-qualified path — classify() takes repo-relative paths' };
  }
  if (p.split('/').includes('..')) {
    return { ok: false, reason: '".." segment — classify() takes repo-relative paths' };
  }
  if (p.endsWith('/')) return { ok: false, reason: 'directory path, not a file' };
  return { ok: true, path: p };
}

function blank(path, form, extra = {}) {
  return {
    path,
    form,
    kind: null,
    specId: null,
    assertionId: null,
    assertionNumber: null,
    slug: null,
    ext: null,
    isSkeleton: false,
    isSpecTest: false,
    guarded: GUARDED_FORMS.has(form),
    cannotVerify: CANNOT_VERIFY_FORMS.has(form),
    reason: null,
    ...extra,
  };
}

/**
 * Which kind a path belongs to, by its position in the tree — for ANY path, source files
 * included. `null` when the path is in no kind's root (tools/, docs/, the repo root, another
 * package). Never returns 'core-dom': that is a Vitest project, not a kind (see test-project.mjs).
 *
 * @param {string} input repo-relative path
 * @returns {'core'|'api'|'web'|'e2e'|null}
 */
export function kindOf(input) {
  const n = normalize(input);
  if (!n.ok) return null;
  for (const kind of KINDS) {
    const root = KIND_ROOT[kind];
    if (n.path === root || n.path.startsWith(`${root}/`)) return kind;
  }
  return null;
}

/** The test directory of a kind, or null for an unknown kind. */
export function dirOfKind(kind) {
  return Object.prototype.hasOwnProperty.call(TEST_DIR, kind) ? TEST_DIR[kind] : null;
}

/**
 * The workspace directory a path lives in (`packages/core`, `apps/web`), or null. It returns the
 * DIRECTORY, never a package name: the name lives in that package's package.json and L-graph is
 * the one reader of it.
 */
export function packageOf(input) {
  const n = normalize(input);
  if (!n.ok) return null;
  const parts = n.path.split('/');
  if (parts.length < 3) return null;
  const dir = `${parts[0]}/${parts[1]}`;
  return WORKSPACE_DIR_RE.test(dir) ? dir : null;
}

/** Accepted test-file suffixes for a kind (a copy, so a caller cannot mutate the table). */
export function testExtensions(kind) {
  return Object.prototype.hasOwnProperty.call(TEST_EXT, kind) ? [...TEST_EXT[kind]] : [];
}

function matchExt(file, kind) {
  for (const ext of TEST_EXT[kind]) if (file.endsWith(ext)) return ext;
  return null;
}

function classifyTestConfig(path) {
  if (TEST_CONFIG_FILES.has(path)) return true;
  const file = path.slice(path.lastIndexOf('/') + 1);
  if (TSCONFIG_RE.test(file)) return true;
  // UNVERIFIED: whether Vitest loads a project-root vite.config.ts for a `projects` entry whose
  // root is that package was NOT measured here. It is guarded in the safe direction — a change
  // to it must be declared — rather than assumed inert.
  if (VITE_CONFIG_RE.test(file)) return true;
  return false;
}

/**
 * The single classification. Pure, synchronous, touches no filesystem: it answers about the SHAPE
 * of a path, not about a file that exists.
 *
 * @param {string} input repo-relative path, e.g. 'packages/core/test/CHQ-007/S2_rejects-empty.test.ts'
 * @returns {{
 *   path: string,
 *   form: 'spec-test'|'e2e-test'|'support'|'skeleton'|'test-config'|'contract'|'unclassified-test'|'not-a-test'|'invalid',
 *   kind: 'core'|'api'|'web'|'e2e'|null,
 *   specId: string|null,          // 'CHQ-007'
 *   assertionId: string|null,     // 'S2'
 *   assertionNumber: number|null, // 2
 *   slug: string|null,
 *   ext: string|null,
 *   isSkeleton: boolean,
 *   isSpecTest: boolean,
 *   guarded: boolean,
 *   cannotVerify: boolean,
 *   reason: string|null           // why it is unclassified/invalid, and what the cure is
 * }}
 */
export function classify(input) {
  const n = normalize(input);
  if (!n.ok) return blank(typeof input === 'string' ? input : String(input), 'invalid', { reason: n.reason });

  const path = n.path;
  const kind = kindOf(path);

  // A dot-prefixed segment is invisible to the tooling — it is the one reason a gate walk skips a
  // path (test-project.mjs walk(), and the gitignored /e2e/.auth/ at .gitignore:28). Classifying
  // such a path as an unclassified TEST would raise a CANNOT VERIFY over a file no runner ever
  // collects, so the skip rule and the classification say the same thing in one place.
  if (path.split('/').some((seg) => seg.startsWith('.'))) {
    return blank(path, 'not-a-test', {
      kind,
      reason: 'a dot-prefixed path segment is invisible to every gate walk',
    });
  }

  if (classifyTestConfig(path)) return blank(path, 'test-config', { kind });

  // Contracts: declared data with no bodies, only when a spec says `contracts: allowed`.
  const contract = /^packages\/core\/src\/contracts\/(CHQ-\d{3})\/[^/]+\.ts$/.exec(path);
  if (contract) {
    return blank(path, 'contract', { kind: 'core', specId: contract[1] });
  }

  const parts = path.split('/');
  const file = parts[parts.length - 1];

  // Is this path inside ANY test jurisdiction? Two kinds of jurisdiction:
  //  - a kind's own test dir, which a runner collects;
  //  - some other workspace's test dir, which NO runner collects — that one is loud, not silent.
  let testKind = null;
  let rel = null;
  for (const k of KINDS) {
    const dir = TEST_DIR[k];
    if (path.startsWith(`${dir}/`)) {
      testKind = k;
      rel = path.slice(dir.length + 1);
      break;
    }
  }
  if (testKind === null) {
    const foreign = /^((?:packages|apps)\/[^/]+)\/test\/(.+)$/.exec(path);
    if (foreign) {
      return blank(path, 'unclassified-test', {
        kind,
        reason:
          `no runner project covers ${foreign[1]}/test — add a Vitest project (vitest.config.ts) ` +
          'and a row to TEST_DIR, or move the file under an existing kind',
      });
    }
    return blank(path, 'not-a-test', { kind });
  }

  const relParts = rel.split('/');

  // support / fixtures at any depth under the test dir.
  if (relParts.length >= 2 && SUPPORT_DIRS.has(relParts[relParts.length - 2])) {
    if (!/\.tsx?$/.test(file)) {
      return blank(path, 'unclassified-test', {
        kind: testKind,
        reason: `a support file must be .ts or .tsx (got ${file})`,
      });
    }
    const spec = relParts.find((seg) => SPEC_DIR_RE.test(seg)) ?? null;
    return blank(path, 'support', {
      kind: testKind,
      specId: spec,
      ext: file.endsWith('.tsx') ? '.tsx' : '.ts',
    });
  }

  // skeleton fixtures: exactly one level deep, so that `skeleton/` cannot grow a tree of
  // spec-less tests nobody red-checks.
  if (relParts[0] === 'skeleton') {
    if (relParts.length !== 2) {
      return blank(path, 'unclassified-test', {
        kind: testKind,
        reason: `skeleton fixtures live one level deep: ${TEST_DIR[testKind]}/skeleton/<name>.test.ts`,
      });
    }
    const ext = matchExt(file, testKind);
    if (ext === null) {
      return blank(path, 'unclassified-test', {
        kind: testKind,
        reason:
          `extension not collected by the ${testKind} project ` +
          `(it collects ${TEST_EXT[testKind].join(', ')})`,
      });
    }
    return blank(path, 'skeleton', { kind: testKind, ext, isSkeleton: true });
  }

  // From here the only legal shape is <spec dir>/<case file>.
  if (relParts.length !== 2) {
    return blank(path, 'unclassified-test', {
      kind: testKind,
      reason:
        relParts.length === 1
          ? `a test file directly under ${TEST_DIR[testKind]}/ is classified by nothing — ` +
            'put it in a CHQ-<nnn> directory, in skeleton/, or in a Support/ directory'
          : `too deep: the only shapes are ${TEST_DIR[testKind]}/CHQ-<nnn>/S<n>_<slug>, ` +
            `${TEST_DIR[testKind]}/skeleton/<name>, and a Support/ or Fixtures/ directory`,
    });
  }

  const [dirName] = relParts;
  if (!SPEC_DIR_RE.test(dirName)) {
    return blank(path, 'unclassified-test', {
      kind: testKind,
      reason: `a spec test directory must be CHQ-<nnn> (got "${dirName}")`,
    });
  }

  const m = CASE_FILE_RE.exec(file);
  if (m === null) {
    return blank(path, 'unclassified-test', {
      kind: testKind,
      specId: dirName,
      reason:
        `a spec test file must be S<n>_<kebab-slug>${TEST_EXT[testKind][0]} ` +
        `(got "${file}"; S<n> carries no leading zero, the slug is lowercase a-z0-9 and hyphens)`,
    });
  }

  const [, num, slug, suffix] = m;
  const ext = `.${suffix}`;
  if (!TEST_EXT[testKind].includes(ext)) {
    return blank(path, 'unclassified-test', {
      kind: testKind,
      specId: dirName,
      reason:
        `the ${testKind} runner does not collect ${ext} ` +
        `(it collects ${TEST_EXT[testKind].join(', ')})`,
    });
  }

  return blank(path, testKind === 'e2e' ? 'e2e-test' : 'spec-test', {
    kind: testKind,
    specId: dirName,
    assertionId: `S${num}`,
    assertionNumber: Number(num),
    slug,
    ext,
    isSpecTest: true,
  });
}

/**
 * A file that HOLDS test cases: a spec test, an e2e test, or a skeleton fixture. Support files,
 * configs and contracts are not test files. Use isSpecTest for the red-check jurisdiction.
 */
export function isTestFile(input) {
  const f = classify(input).form;
  return f === 'spec-test' || f === 'e2e-test' || f === 'skeleton';
}

/** A test that belongs to a spec and must be proven red before implementation. */
export function isSpecTest(input) {
  const f = classify(input).form;
  return f === 'spec-test' || f === 'e2e-test';
}

/** A Vitest spec test (core/api/web) — e2e is Playwright and excluded. */
export function isVitestSpecTest(input) {
  return classify(input).form === 'spec-test';
}

export function isE2eFile(input) {
  return classify(input).form === 'e2e-test';
}

export function isTestSupport(input) {
  return classify(input).form === 'support';
}

/** Guarded, spec-less, never red-checked, never a spec's check:. */
export function isSkeletonFixture(input) {
  return classify(input).form === 'skeleton';
}

export function isTestConfig(input) {
  return classify(input).form === 'test-config';
}

export function isContract(input) {
  return classify(input).form === 'contract';
}

/**
 * A path inside a test jurisdiction that no legal form matches: CANNOT VERIFY for every caller.
 * `classify(p).reason` names the cure.
 */
export function isUnclassifiedTest(input) {
  return classify(input).form === 'unclassified-test';
}
