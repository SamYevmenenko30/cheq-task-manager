// What a `.css` import resolves to under Jest, and the whole of it.
//
// MEASURED 2026-11-02, with the `web` project's config as it stood: a component importing
// `./App.module.css` made all ELEVEN suites of apps/web/test fail to COLLECT with
// `SyntaxError: Unexpected token '.'` at `App.module.css:4`, and the run reported
// `Tests: 0 total` — a verdict about the runner's missing CSS pipeline that reads like eleven
// broken components. Jest's own message names three cures and this is the one it recommends
// for a non-JS asset ("you can stub them out with the moduleNameMapper config option").
//
// Vite is what turns a CSS module into real class names; `tsc` types the import from
// `vite/client`'s `CSSModuleClasses`, which is `{ readonly [key: string]: string }`. So the
// shape below is that type's runtime stand-in and nothing more. It is deliberately EMPTY
// rather than an identity proxy: a test that asserted on a class name would then be asserting
// on the stub, and with `noUncheckedIndexedAccess` on, every read of a class is already
// `string | undefined` in the source — which is why `components/class-names.ts` exists and
// why an absent class renders no attribute instead of the word "undefined".
//
// The invariant THIS file carries: it exports no class, so no case can pass because of a
// style. Every CHQ-003 case addresses the tree by role, label or text.

const classes: Record<string, string> = {};

export default classes;
