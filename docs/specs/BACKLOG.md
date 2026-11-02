# Backlog — the assignment, decomposed into specs

One ticket is one spec file, `docs/specs/CHQ-<nnn>.md`, taken through the three
phases of the method (see [process.md](../knowledge/process.md)): harden the spec,
write the tests and prove them red, then code until the runner the spec names
reads green. Tickets are done ONE AT A TIME; this file is the order.

## Two decisions about `## Vision (verbatim)`, declared here rather than assumed

**1. A spec's Vision quotes the requirement sentences THAT TICKET implements, not
the whole assignment.** `spec-gate` rule 7 numbers every sentence of Vision and
demands an AC-map row for each, so a Vision holding all seven pages would demand a
row for the submission instructions, the evaluation criteria and the interview
notes — none of which are behaviour this software can have. Each spec quotes its
own requirement lines, character for character, and the lines no ticket implements
are listed at the bottom of this file so nothing is dropped in silence.

**2. The full assignment document is NOT reproduced in this repository.** The
assignment requires a PUBLIC repository; copying a company's take-home in full
would hand it to the next candidate. Quoting the requirement lines a ticket
implements is ordinary practice and is what the Vision blocks do.

## The tickets

| id | ticket | delivers | depends on |
|---|---|---|---|
| CHQ-001 | Core: the task and its rules | `@cheq/core` — the task shape, title validation, the ASYNC data-access port, time and id as arguments | — |
| CHQ-002 | API: three endpoints, logging, validation | `@cheq/api` — `GET /health`, `GET /tasks`, `POST /tasks`, the custom request-logging middleware, 400 on an invalid body | CHQ-001 |
| CHQ-003 | Web: list, form, states, health | `@cheq/web` — the list, the create form with client-side validation, loading/empty/error states, the health badge, responsive at both widths | CHQ-002 |
| CHQ-004 | Container | a production Dockerfile for the API: slim base, non-root user, `.dockerignore`, a clear start command; multi-stage as the stated bonus | CHQ-002 |
| CHQ-005 | Infrastructure as code | the AWS environment in Terraform or CDK, with nothing created by hand | CHQ-004 |
| CHQ-006 | CI/CD | a workflow on push to `main`: install and test, stop on a failing test, build the image, deploy with no manual step | CHQ-004, CHQ-005 |
| CHQ-007 | README and System Architecture | local setup, how to run the tests and read coverage, how the infrastructure is provisioned and deployment works, the assumptions, and the three System Architecture answers | all |

Not a ticket, because it is not product behaviour: migrating the gate pipeline's
test lanes to Jest. That is a `gate:` change with its own reasoning, and it is
done — the lanes drive Jest (`jest.config.mjs`), and a spec's `verify:` derives
`jest-<kind>`, so the runner a spec names is the runner the lanes drive. It no
longer blocks CHQ-001's test phase.

## Which tickets take the three phases, and which do not

Decided 2026-11-02, after CHQ-001 went through the full cycle. **CHQ-001, CHQ-002 and CHQ-003 take
all three phases. CHQ-004, CHQ-005 and CHQ-006 do not.**

The three phases exist to make one thing impossible: an assertion that was never able to fail. That
is worth three sessions when there is BUSINESS LOGIC behind the assertion — a title rule, a status
code, a rendered state — because such a test can be red for an interesting reason and green for a
different one, and `red-check` proving it red on the base is what separates the two.

A Dockerfile, a Terraform module and a CI workflow have no such reason. A red test over a
Dockerfile asserts that the file is absent; it goes green the moment the file exists, whatever is in
it, so the red phase measures the filesystem and not the work. The honest check for a container is
that the image BUILDS and the container ANSWERS, and for infrastructure that the plan applies — and
those are verdicts read from artifacts, which is the project's actual principle (ADR-0002). The
three phases are one way of serving it, not the principle itself.

So for CHQ-004 to CHQ-006 the shape is:

| | |
|---|---|
| **no spec file, no `S<n>`, no red phase** | there is no assertion a runner can run red on the base, and a ticket with none would be a spec that contracts nothing — which `spec-gate` rule 6 refuses by name |
| **the acceptance is a COMMAND and its artifact** | `docker build` then a request to the running container; `terraform validate` and `plan`; the workflow's own run. Each lands in the commit that lands the config, and the commit message names the command, what it wrote and where |
| **a light where the check is cheap and repeatable** | a lane that can run on every commit becomes a `## Lights` row of the ticket that needs it, with the artifact it reads. A check that needs AWS credentials or a network is not that, and is named as a one-off with its output quoted instead |
| **the README carries the reasoning** | CHQ-007 already owes the hosting choice and the deployment story; this is where the judgement a reviewer will ask about lives, rather than in a spec that pretends to assert it |

What this does NOT relax: the gates. `L-deps`, `L-visible`, `L-generated`, `L-testguard` and the
rest judge those commits exactly as they judge any other, and `ready` still has to print READY
before a push. The short path drops the RED PHASE, which has nothing to measure there — not the
verdict-from-an-artifact rule, which is the whole point of the pipeline.

## Where a wave belongs, and where it does not

A wave is for a fork the vision text does not decide
(`docs/knowledge/physarum.md` in the original project, not a file here; not ported
beyond the narrow shape below). This assignment states THREE such forks itself, in
its own words — these are the author's open questions, not ours:

| fork | the assignment's own words | decided in | how |
|---|---|---|---|
| **A — storage** | "Either a real database (MongoDB or PostgreSQL) or an in-memory/simulated store (e.g., an in-memory array or a JSON file)." | CHQ-001 | **shape probe.** Three independent attempts produce only the PORT's shape — file list and exported signatures, no implementation, a short time box. The reducer reports where they DISAGREE; that disagreement is the answer, because it marks what the choice actually costs. Dug first: this fork propagates into the container, the infrastructure and the pipeline. |
| **B — hosting** | "Default option: an EC2 instance that runs your container … Alternative: if you find a simpler way to host the backend and frontend on AWS (e.g., ECS on Fargate, App Runner, or S3 + CloudFront for the frontend), go for it" | CHQ-005 | **shape probe**, same form. The assignment separately asks that the choice be explained in the README, so a machine-written disagreement record is directly usable as that answer rather than a story told afterwards. |
| **C — where API state lives** | "Put API calls in custom hooks or a state-management layer." | CHQ-003 | **no wave.** The consequence is one directory of one app and no other ticket depends on it; a wave here would cost three sessions to decide something an argument settles. Decided in the spec with the reason recorded, and named in the README. |

What a wave here is NOT: the full Physarum harness. No twins, no null-model table,
no amplification, no protoplasm refs, no transplant rule, no stakeholder session.
Those exist to measure CONVERGENCE, and the one recorded run of the original
measured 0 of 2 — it measured the scaffolder. The signal taken here is the other
one: **disagreement**, which needs N independent attempts and a mechanical diff
and nothing else.

## Requirement lines no ticket implements

Named so that the scoping decision above is checkable rather than convenient:
the submission instructions, the evaluation criteria, the interview note, the
expected-effort line, and the rules about using AI tools. The last of those has one
consequence that IS delivered — the README must say where AI helped and name one
instance where its output had to be corrected — and that lands in CHQ-007.
