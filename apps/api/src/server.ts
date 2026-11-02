// The process entry point: the one file that turns the app into a running server.
//
// It is separate from `app.ts` on purpose, and the separation is what makes CHQ-002's eleven
// assertions possible: `buildApp()` returns an app that has never bound a port, so every test
// reaches it through `app.inject()` — in-process, no socket, no port collision between parallel
// runs (docs/specs/CHQ-002.md, and ADR-0002 on what a verdict may be read from). Nothing in this
// file is exercised by those tests, which is why it holds no logic worth asserting: it reads the
// environment, calls `listen`, and arranges to stop.
//
// Everything the app needs is defaulted inside `buildApp` (the log sink to stdout per the spec's
// answered Q1, the in-memory store, the id source, the clock), so this file passes nothing. A
// deployment that needs to swap one of them changes this file and nothing else.

import { buildApp } from './app.ts';

/** `0.0.0.0`, not the default `localhost`: inside a container, a server bound to the loopback
 *  interface is unreachable from outside it, and the health check that proves the container works
 *  would fail for a reason that has nothing to do with the app. */
const HOST = process.env['HOST'] ?? '0.0.0.0';

/** The platform supplies the port — App Runner, ECS and a plain `docker run -p` all do, under this
 *  name. 3000 is the fallback for a bare `node dist/server.js` on a developer's machine. */
const PORT = Number(process.env['PORT'] ?? '3000');

const app = buildApp();

/** SIGTERM is how a container runtime asks for a stop; without this handler the process is killed
 *  after the grace period instead of closing its connections, and an in-flight request is cut. */
const stop = (signal: string): void => {
  app.close().then(
    () => {
      process.exit(0);
    },
    (error: unknown) => {
      process.stderr.write(`${JSON.stringify({ level: 'error', event: 'shutdown_failed', signal, error: String(error) })}\n`);
      process.exit(1);
    },
  );
};

process.on('SIGTERM', () => {
  stop('SIGTERM');
});
process.on('SIGINT', () => {
  stop('SIGINT');
});

app.listen({ host: HOST, port: PORT }).then(
  (address) => {
    process.stdout.write(`${JSON.stringify({ level: 'info', event: 'listening', address })}\n`);
  },
  (error: unknown) => {
    process.stderr.write(`${JSON.stringify({ level: 'error', event: 'listen_failed', error: String(error) })}\n`);
    process.exit(1);
  },
);
