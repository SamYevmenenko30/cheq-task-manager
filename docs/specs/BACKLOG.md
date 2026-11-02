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
