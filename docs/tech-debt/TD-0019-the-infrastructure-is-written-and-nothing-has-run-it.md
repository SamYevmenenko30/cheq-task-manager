# TD-0019: the infrastructure is written and nothing has validated, planned or applied it

**Status:** Open, NARROWED · ~~the declared acceptance of CHQ-005 — `terraform validate` and a plan — has not run~~ ~~`validate` RAN; `plan` RAN for `infra/bootstrap`; still owed are both APPLIES~~ **BOTH APPLIES RAN on 2026-11-02 in `eu-north-1` and the stack is serving at <https://d38quc42vrn64x.cloudfront.net>.** What is left is narrower and named below: the CI deploy role's policy has never been exercised (the applies used an administrator's credentials), and `terraform destroy` has never run against a resource set Express Mode partly keeps out of state
**Area:** `infra/`, `infra/bootstrap/` · `docs/specs/BACKLOG.md` (the short path's acceptance rule)
**Raised:** 2026-11-02

## What is unproven

`docs/specs/BACKLOG.md` sets the shape for CHQ-004 to CHQ-006: no spec and no red phase, and **the
acceptance is a command and its artifact** — for infrastructure, `terraform validate` and a plan,
landing in the commit that lands the config. CHQ-004 met that: the image was built and the container
answered. CHQ-005 has not.

~~Two reasons, both external to the configuration:~~ **The first is gone.** The binary was the
blocker and is now installed — terraform 1.17.1 via `hashicorp/tap`, and `validate` passed on both
roots the same day. What remains is the second:

- ~~**The binary.** `/usr/local/bin/terraform` is v0.12.12, dated October 2019.~~ RESOLVED
  2026-11-02. Note for anyone reproducing this: the brew copy lives at
  `/usr/local/opt/terraform/bin/terraform` and is NOT on `PATH` — `brew link` refuses, because
  `/usr/local/bin/terraform` is a hand-installed 2019 FILE rather than a symlink, and linking would
  delete it. Every command below was run by full path rather than by removing somebody's binary.
- **The account — and this bullet has been wrong twice, so read the correction first.** The blocker
  was the REGION. The SCP `AdvancedModeRegionRestrictionSecurityControlPolicy` (`p-jxfv0n88`) denies
  everything outside an allow-list in `us-east-1`, nearly everything in `us-west-2`, and — in its
  `RegionFloor` statement — everything at all when `aws:RequestedRegion` is not one of
  `[eu-north-1, unspecified, us-east-1, us-west-2]`. `eu-north-1` matches no partitional statement
  and is inside that exception list, so the policy denies nothing there. Both roots defaulted to
  `eu-central-1`, which is in neither carve-out.

  MEASURED in `eu-north-1` on 2026-11-02: `s3:CreateBucket` and `ecr:CreateRepository` both
  SUCCEEDED (deleted immediately), and `ecs`, `ecr`, `ec2`, `elbv2`, `s3`, `logs` and
  `application-autoscaling` all answer reads. An earlier revision of this bullet said "nothing that
  can serve an HTTP response can be created in this account"; that generalised from four sampled
  regions to the region space, while the policy's own text named the exception. The correction and
  the method are in the CORRECTED section of `docs/specs/CHQ-005.probe-hosting.md`.

  So the account is not the blocker. `terraform plan` RAN against it for `infra/bootstrap` on
  2026-11-02 — **13 to add, 0 to change, 0 to destroy** — which is the plan this entry recorded as
  owed, for that root. What is still owed is both APPLIES, and the application root's own plan,
  which needs the S3 backend the bootstrap apply creates.

## What IS verified, exactly

**As of 2026-11-02, against the real provider schema** — terraform 1.17.1, `hashicorp/aws v6.71.0`
"(signed by HashiCorp)", `init -backend=false` then `validate`, each read from its own exit status
and not through a pipe:

    fmt -check -recursive infra/            exit 0
    init -backend=false  infra/bootstrap    exit 0
    validate             infra/bootstrap    exit 0   Success! The configuration is valid.
    init -backend=false  infra/             exit 0   Installed hashicorp/aws v6.71.0
    validate             infra/             exit 0   Success! The configuration is valid.

`-backend=false` is what lets the application root initialise at all: its backend is partial by
design, and the bucket it would use does not exist yet. It installs the provider and skips the
state, which is exactly the scope of a `validate`.

So every argument NAME exists in the provider, every TYPE matches, and every REFERENCE resolves —
including the whole of `aws_ecs_express_gateway_service`, whose arguments were written from the
provider's documentation source rather than from memory: `primary_container` with its nested
`aws_logs_configuration` and `environment`, `scaling_target`, `health_check_path`,
`wait_for_steady_state`, and the `ingress_paths[0].endpoint` attribute `infra/api.tf` reads.

~~`terraform fmt -check -recursive infra/` is clean over all 843 lines… It is not evidence of
anything else.~~ That earlier, weaker verdict is superseded, and how it was established is worth
keeping: the command was made to FAIL twice on a copy of the tree — a file with non-canonical
indentation names the file, a file that is not valid HCL prints `Error: Invalid expression` with the
line — because a tool's silence is not a verdict until you have seen it speak.

## The specific things a plan or an apply would settle

- **The units of `cpu` and `memory`**, and `validate` does NOT settle this: it checks that the
  argument exists and that a string is a string, never that a value is in range. The resource's own
  documentation example writes `cpu = "256"` / `memory = "512"` — ECS task units, a quarter vCPU —
  while the AWS CLI for the same API documents `--cpu 2 --memory 4`, meaning two vCPUs and four
  gigabytes. `infra/variables.tf` uses the resource's documented form. **SETTLED 2026-11-02 by the
  apply: they are task units.** The service created with `cpu = "256"` / `memory = "512"` and runs
  one task on a quarter vCPU; no error, no 256-vCPU bill.
- ~~**Whether `ingress_paths[0].endpoint` carries a scheme.**~~ **SETTLED 2026-11-02: it does.**
  The created service's endpoint reads `https://ch-59b1a899f30943549f0d6e577b695265.ecs.eu-north-1.on.aws`,
  so the stripping branch in `infra/api.tf` is the live one and the other is dead code. It stays,
  because a defensive strip over a value that already lacks a scheme is a no-op, and the alternative
  is a CloudFront `domain_name` with a scheme in it if AWS ever changes the shape.
- **Whether the deploy policy is sufficient. STILL UNVERIFIED, and the applies did not touch it.**
  Both applies on 2026-11-02 used an administrator's own credentials, not the `cheq-deploy` role CI
  assumes, so `infra/bootstrap/ci.tf`'s policy has still never authorised a single call. The honest
  way to find a missing IAM action is to run it and read the denial; the first pipeline run on
  `main` is that test, and a failure there is expected to be a missing action rather than a missing
  resource.
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
their output. The bootstrap plan is discharged. What remains is `terraform apply` on
`infra/bootstrap`, then `init`, `plan` and `apply` on `infra/`, each committed with its output — and
those need nothing from the organization now that the region is right.

## What the applies added to this entry, 2026-11-02

Three failures, each a documented default that is not one, and each now a comment beside the value
that fixes it rather than a line a later reader deletes as redundant:

1. **`AwsLogsConfiguration.LogStreamPrefix` is required.** The Express Mode defaults page lists
   `awslogs-stream-prefix: "ecs"` among values "set by Express Mode". The first apply answered
   `1 validation error(s) found. - missing required field,
   CreateExpressGatewayServiceInput.PrimaryContainer.AwsLogsConfiguration.LogStreamPrefix`. The
   default applies when the whole block is absent; supplying the block makes every field the
   caller's. (`infra/api.tf`)
2. **Two of the three service-linked roles are not created automatically.** The same page lists all
   three as "configured by Express Mode automatically". The second apply answered
   `InvalidParameterException: Unable to assume the service linked role`, and a listing showed
   `AWSServiceRoleForECS` present — ECS does create its own — while
   `AWSServiceRoleForElasticLoadBalancing` and `AWSServiceRoleForApplicationAutoScaling_ECSService`
   were absent. Both are now declared in `infra/bootstrap/iam.tf`; the ECS one is deliberately left
   to ECS, because a resource racing a service for the same role is a conflict, not a guarantee.
3. **The provider plans `null` for two scaling fields the API fills in.** The third apply CREATED the
   service in AWS (five minutes) and then failed with `Provider produced inconsistent result after
   apply: .scaling_target[0].auto_scaling_target_value: was null, but now cty.NumberIntVal(60)`, and
   the same for `auto_scaling_metric` / `AVERAGE_CPU`. The resource was in state and healthy, so it
   was untainted rather than destroyed and rebuilt; writing both values into the config makes the
   plan agree with the response. With min and max pinned to 1 they are inert.

A fourth thing worth recording because it is a method point rather than a defect: the second apply
was attempted with `-auto-approve` and refused by this session's own guardrail as a "blind apply".
That was the right refusal. Every apply here went `plan -out <file>` then `apply <file>`, so what ran
is what a human could read first — which is also why the resource counts above (13, 2, 3, 2) are
quotable at all.
