# cheq-task-manager

A task-management REST API and a React single-page app, built spec-first: every assertion was
written as a failing test and proven red before the code that satisfies it existed.

**Live URL: <https://d38quc42vrn64x.cloudfront.net>** — the SPA at `/`, the API at `/health` and
`/tasks` behind the same origin. Deployed 2026-11-02 to `eu-north-1`; see
[Deployment](#deployment) for how it is built and what is still unverified.

| | |
|---|---|
| API | Fastify 5 · `GET /health`, `GET /tasks`, `POST /tasks` |
| Frontend | React 19 + Vite 8 · task list, create form, loading/empty/error states, health badge |
| Core | `@cheq/core` — the task model and the title rule, with no DOM, no `node:*` and no clock |
| Storage | in-memory behind an async port (see [Assumptions](#assumptions-and-what-is-not-finished)) |
| Tests | 96 cases across three Jest projects · backend coverage 100% statements / 96.15% branches |
| Container | two-stage, `node:22-alpine`, one bundled file, non-root, 166 MB |
| Infrastructure | Terraform: ECS Express Mode + S3 + CloudFront behind one origin |
| Pipeline | GitHub Actions on push to `main`: gates → image → apply → smoke-test |

---

## Setup

Node 22 and pnpm 9.15.0 (both pinned — `.nvmrc` and `packageManager`). With corepack enabled, pnpm
comes from the repository rather than from your machine:

```bash
corepack enable
pnpm install --frozen-lockfile
```

### Run it locally

Two processes. The API first:

```bash
pnpm dev:api
```

It listens on `http://localhost:3000` and logs one JSON line per request to stdout. Then the SPA:

```bash
pnpm dev:web
```

Open **http://localhost:5173**. The SPA calls `/tasks` and `/health` with **relative** paths and
Vite's dev server proxies them to the API (`apps/web/vite.config.ts`). That is deliberate: in
production one CloudFront distribution serves both halves, so no API origin is ever baked into the
build. There is no `.env` to fill in and no API base URL to configure, by design.

> On macOS Vite binds the IPv6 loopback only (`[::1]:5173`), so `curl http://127.0.0.1:5173` is
> refused while `http://localhost:5173` works. The API binds `0.0.0.0` and answers on both.

### Run the tests

```bash
pnpm ready
```

That is the check of record and what CI runs: type verdicts for all three packages, the lint lane,
all three test projects, sixteen static lights, and `red-check`. It reads each child's machine
record rather than its exit code and prints `READY` only when every blocking step passed.

Narrower, while working:

```bash
pnpm test:core    # 46 cases — the rules, over pure values
pnpm test:api     # 29 cases — the HTTP contract, through app.inject()
pnpm test:web     # 21 cases — the components, through Testing Library
```

### Coverage

```bash
NODE_OPTIONS=--experimental-vm-modules pnpm exec jest --selectProjects core api --coverage
```

The assignment's floor is backend-only, so the command names the `core` and `api` projects. Current
figures, with the threshold of 80 enforced by `jest.config.mjs`:

| | statements | branches | functions | lines |
|---|---|---|---|---|
| **all backend files** | **100%** | **96.15%** | **100%** | **100%** |

An HTML report lands in `coverage/lcov-report/index.html` when you add `--coverageReporters=html`.

Two files are deliberately outside the denominator, and `jest.config.mjs` states the reason beside
each: `packages/core/src/testing/**` is test plumbing rather than product, and
`apps/api/src/server.ts` is the process entry — every API test reaches the app through
`app.inject()` and binds no port, so it can only ever read 0%. Its evidence is the container smoke
test below rather than a unit test. The one remaining uncovered branch in product code is noted in
[what is not finished](#assumptions-and-what-is-not-finished).

---

## Architecture

```
packages/core     the task, the title rule, the data-access PORT          no deps, no DOM, no clock
   ▲        ▲
   │        └──────── apps/web    React — renders core state, no rules of its own
   └─ apps/api       Fastify — maps HTTP onto core calls, no rules of its own
```

**The rule lives in exactly one place.** `createTask` in `@cheq/core` decides whether a title is
acceptable and trims it; `apps/api` chooses only the status code and the envelope, and `apps/web`
imports the same `acceptTitle` for its client-side validation. A regex in a handler or a second
`trim() === ''` in the form would be a second rule that can disagree with the first while nothing
notices — so there isn't one. The 400 on an empty title and the trimmed title in the response are
the same rule reaching the wire.

**The core cannot reach the outside world, and that is enforced rather than intended.**
`packages/core/package.json` has `"dependencies": {}`, its `tsconfig` has `lib: ["ES2023"]` and
`types: []`, and pnpm's isolated linker means it has no `node_modules` at all — so `document` is a
type error, `node:fs` does not resolve, and an undeclared import cannot be written. Time, ids and
storage arrive as arguments. A static check (`L-core-purity`) asserts all three levels on every run,
including a token scan for `Date.now(` and `Math.random(`.

**Storage is an async port.** `TaskStore` returns Promises exactly as a database driver would, and
the in-memory adapter lives in `apps/api`. Swapping it for Postgres is one new adapter and one line
in `buildApp`; no core code and no test of the rules would change — the unit tests mock the port,
not the store.

**The SPA and the API share one origin.** CloudFront serves the SPA from S3 as its default
behaviour and routes `/health`, `/tasks` and `/tasks/*` to the API as ordered behaviours with
caching disabled. That removes three problems rather than solving them: no CORS layer, no API base
URL in the build, and no mixed content. The cost is that an API path exists in two places — the
distribution and the SPA's fetch calls — so a fourth route needs a fourth behaviour.

### Why ECS Express Mode

The assignment offers EC2 as the default and invites a simpler alternative. The first choice was
**App Runner** — until the check that it is **closed to new customers** since 2026-04-30 ("AWS App
Runner is no longer open to new customers", [AWS
docs](https://docs.aws.amazon.com/apprunner/latest/dg/apprunner-availability-change.html)). This
account was created after that date, so App Runner cannot be used here at all.

AWS's named successor, **ECS Express Mode**, is what the infrastructure uses. One Terraform resource
provisions a Fargate service, an Application Load Balancer with HTTPS, a target group, security
groups, auto-scaling and a certificate; the SPA needs CloudFront anyway, so the API becomes
same-origin for the cost of one extra origin block. The EC2 alternative would have needed roughly
seven resources of its own plus a shell script inside Terraform and an SSM deploy channel.

The trade, stated rather than hidden: that one resource creates about ten resources in the account
and **none of them is in Terraform's state**, so a console reader sees resources this repository
cannot account for. The full comparison, including what was given up, is in
[`docs/specs/CHQ-005.probe-hosting.md`](docs/specs/CHQ-005.probe-hosting.md).

---

## Container

```bash
docker build -t cheq-api:local .
docker run --rm -p 3000:3000 cheq-api:local
```

Two stages. The runtime stage carries **one file** — no `node_modules`, no package manager, no
lockfile — because `@cheq/core` exports TypeScript source and every project is `noEmit`, so `tsc`
cannot emit a runnable artefact (`error TS5096`) and Node cannot load `./app.ts`. esbuild follows
every import, inlines Fastify and the core, and emits one CommonJS file. `node` is PID 1 via the
exec-form `CMD`, so it receives SIGTERM and closes its connections instead of being killed after the
grace period. It runs as `USER node`.

Measured: image 166 MB; the container answers `200` on `/health`, `201` on a valid create with the
title trimmed, `400` on a blank one, and logs one structured line per request with `level: "warn"`
on the 400.

---

## Deployment

Terraform, in **two stages**, and the split is what keeps CI's credentials narrow.

**`infra/bootstrap/`** — applied once, by hand, and out of CI's reach: the GitHub OIDC provider, the
deploy role, the ECR repository, the two roles the task runs under, and the S3 bucket holding the
application stage's state. Because the roles live here, the deploy policy needs `iam:PassRole` on
two known ARNs and no `iam:CreateRole` at all. A role that can create roles can create an
administrator.

**`infra/`** — applied by CI on every push: the Express Mode service, the SPA bucket and the
CloudFront distribution. `image_tag` is the only per-deploy input, so the diff of a deploy is one
line.

```bash
TF=terraform   # 1.17.1 or newer

$TF -chdir=infra/bootstrap init
$TF -chdir=infra/bootstrap apply -var="github_repository=OWNER/REPO" -var="state_bucket_name=UNIQUE"

$TF -chdir=infra init -backend-config="bucket=UNIQUE"
$TF -chdir=infra apply -var="image_tag=$(git rev-parse HEAD)" …   # CI does this part
```

### The pipeline

`.github/workflows/deploy.yml`, on push to `main`, in two jobs:

1. **gates** — `pnpm install --frozen-lockfile`, then `node tools/gates/ready.mjs`. The run
   artefacts (every JUnit XML, the runner's JSON, the type logs, each `run.json`) are uploaded
   whether it passes or fails. Needs `fetch-depth: 0`, because `red-check` resolves a commit range
   and builds a worktree from it.
2. **deploy** — only after the gates pass, only on `main`, and only once
   `AWS_DEPLOY_ROLE_ARN` is set as a repository variable. Credentials come from GitHub's OIDC token
   exchanged for a short-lived role session; the trust policy pins both the repository and
   `refs/heads/main`, so a fork's pull request cannot assume it. **No long-lived AWS keys exist
   anywhere.** The job builds and pushes the image tagged with the commit sha, applies `infra/`,
   builds and syncs the SPA, invalidates the edge, and finally `curl -f`s the live URL and asserts
   `"status":"ok"` in the body — the verdict comes from the deployment, not from the exit code of an
   apply.

Measured: the gates job is green in CI at **49 s** total, with `ready` itself at 33 s
([run 41430333205](https://github.com/SamYevmenenko30/cheq-task-manager/actions)).

### The deployment, and what it took

**It is live: <https://d38quc42vrn64x.cloudfront.net>** — the SPA at `/`, the API at `/health`,
`/tasks` and `/tasks/*`, one origin, HTTPS, and therefore no CORS layer and no API base URL baked
into the build. Region `eu-north-1`; the Express Mode service's own endpoint is
`https://ch-59b1a899f30943549f0d6e577b695265.ecs.eu-north-1.on.aws`, which is what CloudFront's API
behaviours point at.

Verified against the live URL rather than against an exit code — `GET /health` returned
`{"status":"ok","uptime":435.4}`, `POST /tasks` with `"  через CloudFront  "` came back as
`"через CloudFront"` (so the trim is the deployed code's, not the test's), a blank title returned
`400 {"message":"title must be a non-empty string"}`, and the SPA renders with its health badge green
and the list populated, including a task added through the form in a browser.

The blocker, for most of this work, was the **region**. The account is a member of an organization
whose SCP `AdvancedModeRegionRestrictionSecurityControlPolicy` denies everything when
`aws:RequestedRegion` is not in `[eu-north-1, unspecified, us-east-1, us-west-2]`, and denies all but
an allow-list inside `us-east-1` and `us-west-2`. Both roots defaulted to `eu-central-1`, named by no
carve-out, so every call was refused — with the words "service control policy" rather than "wrong
region", which is what made it read as a service problem. `eu-north-1` is the one region that policy
leaves untouched. An earlier revision of this README concluded that nothing able to serve an HTTP
response could be created in this account; that was wrong, it generalised from four sampled regions,
and the correction is in [docs/specs/CHQ-005.probe-hosting.md](docs/specs/CHQ-005.probe-hosting.md).

**A fourth thing only a pipeline run could find: the OIDC subject is not what the docs imply.**
This repository has GitHub's *immutable subject claims* enabled, so the `sub` claim it signs is
`repo:<owner>@<ownerId>/<name>@<repoId>:ref:refs/heads/main` rather than
`repo:<owner>/<name>:ref:refs/heads/main`. A trust policy written against the classic form matches
nothing, and the failure says only `Could not assume role with OIDC: Not authorized to perform
sts:AssumeRoleWithWebIdentity` — naming neither the claim nor the mismatch. The prefix has to be
read from GitHub rather than inferred:

```bash
gh api repos/<owner>/<name>/actions/oidc/customization/sub --jq .sub_claim_prefix
```

and passed to the bootstrap stage as `-var="github_subject_prefix=<that value>"`. It defaults to the
classic form, so a repository with the feature off needs nothing. The numeric ids are the point of
the feature: they survive a rename, so the pin cannot be defeated by renaming the repository or the
account into one somebody else has released.

**Three things only an apply could find**, each now a comment beside the value it fixed rather than a
line someone will later delete as redundant:

1. `AwsLogsConfiguration.LogStreamPrefix` is **required**, although the Express Mode defaults page
   lists `awslogs-stream-prefix: "ecs"` among values "set by Express Mode". The default applies when
   the block is absent; supplying the block makes every field in it the caller's.
2. **Two of the three service-linked roles are not created automatically.** The same page lists all
   three as "configured by Express Mode automatically". On a fresh account `AWSServiceRoleForECS`
   did appear by itself; `AWSServiceRoleForElasticLoadBalancing` and
   `AWSServiceRoleForApplicationAutoScaling_ECSService` did not. Both are now declared in
   `infra/bootstrap/iam.tf`, because the assignment asks for infrastructure in code and a CLI call
   made by hand is not that. The ECS one is deliberately left to ECS.
3. The provider **planned `null`** for `scaling_target.auto_scaling_target_value` and
   `auto_scaling_metric` while the API fills in `60` and `AVERAGE_CPU`, so the first create succeeded
   in AWS and then failed the apply with "Provider produced inconsistent result after apply". Both
   are written out now. With min and max pinned to 1 they are inert — they exist so the plan agrees
   with what comes back.

**Two of TD-0019's open questions are settled by the apply.** `ingress_paths[0].endpoint` DOES carry
a scheme (`https://ch-…on.aws`), so the stripping branch in `infra/api.tf` is the live one and the
other is dead code. And `cpu = "256"` / `memory = "512"` are ECS task units, not vCPUs and gigabytes:
the service created and runs one task on a quarter vCPU.

**What is still not verified.** The applies above ran with an administrator's credentials, not with
the CI deploy role, so `infra/bootstrap/ci.tf`'s policy remains a prediction until a pipeline run
exercises it. `terraform destroy` has never run, and Express Mode creates roughly ten resources under
the infrastructure role that Terraform's state does not track — a community report says the load
balancer and the certificate survive a destroy. Both stay in
[TD-0019](docs/tech-debt/TD-0019-the-infrastructure-is-written-and-nothing-has-run-it.md).

**One standing hazard.** The same organization carries `BudgetsSpendLimitDenyNewWorkloads`, which AWS
attaches when forecast spend nears the budget limit and which blocks creation of chargeable
resources. It is not blocking today. If an apply that worked starts failing with an explicit deny and
nothing here changed, read that policy first — and fix the budget, not the policy, because the
Budgets service reattaches what it manages.

**The store is one process's memory.** Every deploy and every task replacement empties the task list.
That is CHQ-001's recorded decision, not an oversight, and the scaling target is pinned to 1..1 so a
second task can never serve a different list.
---

## Assumptions, and what is not finished

Stated plainly, because every one of them is something a reviewer would otherwise have to find.

**Storage is in memory, per process.** The assignment allows it; the consequence is that the task
list does not survive a restart or a deploy. Express Mode deploys canary and the strategy cannot be
changed, so during a deploy two revisions briefly serve and a reader can see two different lists.
The service is pinned to exactly one task (`scaling_target` 1..1) so that this is structural rather
than configured. No platform can promise otherwise for an in-memory store.

**No retry on the list.** The health badge re-reads `/health` every 30 s and recovers by itself; the
task list fetches once, and after a failure it keeps showing the error until the page is reloaded or
a task is created. The spec does not require a retry and there is no "try again" button — this is
the gap I would close first.

**The responsive layout has no automated test.** The assignment's "works at both desktop and mobile
widths" is a pixel fact, and the Playwright lane has never run on this machine (no browser binaries
installed), so that assertion is written in the spec, marked CANNOT VERIFY, and judged by eye at
1280×800 and 375×812. It carries no `green:` claim. See
[TD-0001](docs/tech-debt/TD-0001-browser-lane-unverified.md).

**One product branch is uncovered**: a `POST /tasks` body that is not an object at all
(`titleOf`'s `undefined` arm). A test for it cannot be added now — the pipeline requires a new spec
test to be proven red on the base, and this behaviour already works, so the case would be green and
the gate refuses it. That is the method working as intended, and the honest consequence is that such
a gap closes during a ticket's test phase or not at all.

**The coverage floor is not enforced by any lane.** It is declared in `jest.config.mjs` and passes,
but `ready` does not ask for it; the figure above comes from running the command by hand
([TD-0013](docs/tech-debt/TD-0013-coverage-floor-is-declared-but-unenforced.md)).

**`infra/` and `.github/` are outside every static check.** The lights walk `packages/`, `apps/` and
`e2e/`, so `ready` is equally green whatever the Terraform or the workflow says — including a
workflow that stopped running `ready`
([TD-0020](docs/tech-debt/TD-0020-infra-is-outside-every-light.md)).

**`vite preview` is not a faithful stand-in for production.** It serves unknown paths as the SPA
shell with status 200; CloudFront deliberately carries no such fallback, so it returns S3's 403/404.
The API paths behave identically in both.

Twenty-two further items — each measured, each with what would discharge it — are in
[`docs/tech-debt/`](docs/tech-debt/README.md).

---

## System Architecture

### Scalability — 10× traffic tomorrow

The bottleneck is not the Node process; it is the **in-memory store**, and it is a correctness
bottleneck rather than a throughput one. Today the service is pinned to one task precisely because a
second task would serve a different list. So the first change is not a scaling change at all:

1. **Move the store behind the port that already exists.** `TaskStore` is async and the rules are
   written against it, so this is one new adapter in `apps/api` — RDS Postgres (or DynamoDB, since
   the access pattern is a single-table list and a put) — plus one line in `buildApp`. No core code
   and no rule test changes. Until this lands, nothing below is safe.
2. **Then unpin the autoscaler.** `scaling_target` becomes `min 2, max 10`, and Express Mode's
   existing target-tracking policy on CPU does the rest; at 10× I would switch the metric to
   `ALBRequestCountPerTarget`, which tracks the actual load shape better than CPU for an I/O-bound
   service. Two tasks minimum also removes the single-AZ failure the current shape has.
3. **Cache `GET /tasks` at the edge for a few seconds.** The behaviour is `CachingDisabled` today
   because a stale list after a create is an application bug nobody can reproduce locally; with a
   real store I would give it a 5–10 s TTL and invalidate on write, which at 10× absorbs most reads
   before they reach Fargate at all.
4. **Add a connection pool and a statement timeout** in the adapter, and a health check that does
   *not* touch the database — `/health` deliberately touches no store today, exactly so a load
   balancer cannot take a healthy instance out of rotation for a reason it cannot fix.

What I would **not** do first: raise `cpu`/`memory`. One Node process holding a list is not CPU-bound,
and vertical scaling would hide the real limit for a week.

### Observability — monitoring, error tracking, log aggregation

The logging half is already built and is the foundation the rest sits on. Every request produces
**one JSON line** on stdout with `time`, `level`, `requestId`, `method`, `path`, `statusCode` and
`durationMs`, and **never the request body** — that last property is asserted by a test
(`S10_the-request-body-is-never-logged`), because "we don't log PII" is a claim worth falsifying.
The level is derived from the outcome, so a 4xx is `warn` and a 5xx would be `error`.

- **Aggregation.** Express Mode already ships the container's stdout to a CloudWatch log group. The
  lines are JSON, so no grok pattern is needed: a metric filter on `level="error"` and a
  CloudWatch Logs Insights query grouping by `statusCode` work on day one. For anything longer-lived
  I would subscribe the log group to Firehose → S3 and query with Athena, which costs a fraction of
  CloudWatch retention.
- **Correlation.** `requestId` is generated per request and is already in every line. The next step
  is to accept an inbound `x-request-id` when present and echo it in the response, so a client's bug
  report names the exact request — a change in one middleware.
- **Monitoring.** Express Mode creates a faulty-deployment alarm by itself. I would add three
  alarms on the load balancer's own metrics: `HTTPCode_Target_5XX_Count` over a short window,
  `TargetResponseTime` p99, and `UnHealthyHostCount`. A synthetic canary calling `GET /health`
  every minute from outside AWS is what catches "the edge is broken but the service is fine" —
  precisely the failure the same-origin CloudFront arrangement makes possible.
- **Error tracking.** Structured logs tell you an error happened; they do not give you a stack with
  the user's context. I would add Sentry in `apps/web` (the SPA currently shows the user an error
  state and tells nobody) and in `apps/api`, tagged with `requestId` so a frontend report joins the
  backend line. This is the one piece that needs a new dependency, which is why it is not here yet:
  the pipeline refuses a dependency that arrives without a declaration and a vendor digest.
- **What I would measure first**, before any of it: `GET /tasks` latency split by cache hit and
  miss. The edge behaviours are the part of this design most likely to be wrong in a way the tests
  cannot see.

### AI utilization

I used Claude Code throughout, as the pair that writes the first draft and runs the measurements,
with the method in this repository as the thing that keeps it honest: a spec is written and signed,
tests are written from the spec and **proven red** before any implementation exists, and every
verdict is read from an artifact on disk rather than from a process's exit code. That last rule
exists because AI output is confident whether or not it is correct, and an exit code is the easiest
thing in the world to misread.

It was most useful for breadth — the Terraform, the Dockerfile, the workflow and the gate scripts
are far more thorough than I would have written by hand in the time — and least useful anywhere a
claim needed to be *checked* rather than produced.

**One instance where I had to correct it.** The infrastructure was going to be ECR plus **App
Runner**, and two sessions of work assumed it. When I had three independent attempts produce the
shape separately and compare them, one of them reported that AWS closed App Runner to new customers
on 2026-04-30. I did not take that on faith — I read AWS's own documentation, which says it
plainly — and the whole plan was dead: this account was created after that date. Two of the three
attempts knew; one confidently proposed the service that cannot be created. Had I asked one AI for
an answer and taken it, I would have shipped infrastructure that cannot be applied, and found out at
`terraform apply` the night before the interview. The disagreement record is in
[`docs/specs/CHQ-005.probe-hosting.md`](docs/specs/CHQ-005.probe-hosting.md), including the sharper
finding: two of the three shapes mapped CloudFront's `403/404` to `/index.html` with status 200 for
SPA routing, which — because that mapping is per distribution and not per behaviour — would have
turned a genuine API `404` into an HTML page with status `200`. The third named the mechanism. That
is why there is no `custom_error_response` in `infra/cdn.tf`.

Smaller corrections of the same kind, each now a written-down debt rather than a surprise: a test
that reported green while asserting nothing, a gate that could not name why anything was red, a
coverage figure measured over test plumbing instead of the product, and a gate rule that demanded a
test file for an assertion whose runner can never execute — which made one spec literally unfixable
until the rule was narrowed.

---

## Repository map

```
packages/core        the rules and the port — engine-free, dependency-free
apps/api             Fastify adapter + the in-memory store
apps/web             React SPA (components, hooks, CSS Modules)
infra/               Terraform: bootstrap (identity, registry, state) + the running stack
.github/workflows/   the pipeline
docs/specs/          one spec per ticket; the vision text verbatim, then its assertions
docs/decisions/      ADRs — the boundaries and why they are where they are
docs/tech-debt/      22 entries: what is measured, what is not, and what would discharge it
tools/gates/         the checks: ready, red-check, spec-gate, test-guard, the lights, the probes
```

`docs/specs/BACKLOG.md` is the ticket list and says which tickets took the full three-phase flow and
which took the short path, with the reason.
