# TD-0019: the infrastructure is written and nothing has validated, planned or applied it

**Status:** Open · the declared acceptance of CHQ-005 — `terraform validate` and a plan — has not run, because the `terraform` on this machine is v0.12.12 and the account denies the services
**Area:** `infra/`, `infra/bootstrap/` · `docs/specs/BACKLOG.md` (the short path's acceptance rule)
**Raised:** 2026-11-02

## What is unproven

`docs/specs/BACKLOG.md` sets the shape for CHQ-004 to CHQ-006: no spec and no red phase, and **the
acceptance is a command and its artifact** — for infrastructure, `terraform validate` and a plan,
landing in the commit that lands the config. CHQ-004 met that: the image was built and the container
answered. CHQ-005 has not.

Two reasons, both external to the configuration:

- **The binary.** `/usr/local/bin/terraform` is v0.12.12, dated October 2019. The configuration
  declares `required_version = ">= 1.10"` (the S3 backend's `use_lockfile` replaced the DynamoDB
  lock table in that release) and pins `hashicorp/aws ~> 6.71`. v0.12 cannot initialise that
  provider, so `validate` cannot see a schema.
- **The account.** `ecs`, `ecr`, `ec2` and `cloudformation` are denied by the organization's service
  control policies (measured 2026-11-02), so even with the right binary there is nothing to plan
  against that would succeed.

## What IS verified, exactly

`terraform fmt -check -recursive infra/` is clean over all 843 lines. That verdict was established
rather than assumed, by making the command fail twice on a copy of the tree:

- a file with non-canonical indentation ⇒ the file is named on stdout;
- a file that is not valid HCL ⇒ `Error: Invalid expression`, with the line.

So the configuration is **valid HCL2 in canonical form**. It is not evidence of anything else. With
no provider schema, `fmt` cannot know whether `scaling_target` is a real block, whether
`ingress_paths` is a list, or whether `cpu` takes the string `"256"`.

## The specific things a plan or an apply would settle

- **The units of `cpu` and `memory`.** The resource's own documentation example writes
  `cpu = "256"` / `memory = "512"` — ECS task units, a quarter vCPU. The AWS CLI for the same API
  documents `--cpu 2 --memory 4`, meaning two vCPUs and four gigabytes. `infra/variables.tf` uses
  the resource's documented form. If the provider means vCPUs, ECS rejects 256 at apply with an
  immediate error, so the failure mode is loud rather than a 256-vCPU bill — but it is unsettled.
- **Whether `ingress_paths[0].endpoint` carries a scheme.** `infra/api.tf` strips `https?://`
  defensively because CloudFront's `domain_name` takes a host and nothing else. One of those two
  branches is dead code and nobody knows which.
- **Whether the deploy policy is sufficient.** `infra/bootstrap/ci.tf` was written from what the
  workflow does, not from a failing apply. The honest way to find a missing IAM action is to run it
  and read the denial; until then the policy is a prediction.
- **Whether `terraform destroy` is clean.** Express Mode creates roughly ten resources under the
  infrastructure role, none of them in Terraform's state. A community report says the load balancer
  and the ACM certificate survive a destroy; UNVERIFIED here, and it is a bill rather than a bug if
  true.

## Why it is bounded, and what discharges it

It is bounded by being the whole of CHQ-005's claim: nothing in this repository asserts that the
infrastructure works, no `green:` trailer cites it, and the README (CHQ-007) cannot describe a live
URL that does not exist. The ticket is not done, and this entry is the record of that rather than a
caveat attached to a done one.

Discharged in two steps, in this order: `brew install terraform` (a human action — this project
installs nothing), then `terraform fmt -check`, `init` and `validate` on both roots, committed with
their output. The plan and the apply additionally need the service control policies lifted, which is
TD-0020's neighbour and not a thing any code here can fix.
