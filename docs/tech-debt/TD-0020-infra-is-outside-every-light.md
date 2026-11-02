# TD-0020: `infra/` is outside every light's walk, so no gate judges the infrastructure at all

**Status:** Open · prevention is in place (`.gitignore`), detection is not: no light walks `infra/`, and `L-visible`'s "nothing is hidden" claim does not extend to it
**Area:** `tools/gates/lights/{visible,lint,orphans,stubkit}.mjs` (their walk roots) · `infra/`
**Raised:** 2026-11-02

## What is unproven

Every light in this repository walks the same three roots, and `infra/` is not one of them:

- `tools/gates/lights/visible.mjs:194` — `JUDGED_ROOTS = ['packages', 'apps', 'e2e']`
- `tools/gates/lights/lint.mjs:166` — `SCANNED_ROOTS = ['packages', 'apps', 'e2e']`
- `tools/gates/lights/orphans.mjs:529` — `walk(root, { roots: ['packages', 'apps', 'e2e'], … })`
- `tools/gates/lights/stubkit.mjs:107` — `SOURCE_ROOTS = ['packages', 'apps']`

(`L-artifacts` walks `tools/gates` and judges a different thing.) So 843 lines of Terraform are
invisible to the gate pipeline: `ready` prints READY with the infrastructure in any state at all.

The sharpest consequence is `L-visible` itself. That light exists so that **no tracked file is
hidden from a gate**, and it makes a numeric claim — tracked files equal walked files — over its
three roots. That claim is true and says nothing about `infra/`, where a `.gitignore` entry could
hide a tracked `.tf` file and no light would count it.

## What prevention is in place

`.gitignore` now refuses the thing that actually goes wrong: `**/.terraform/`, `*.tfstate`,
`*.tfstate.*`, `.terraform.tfstate.lock.info`, `*.tfplan`, `crash*.log` and `*.tfvars`, with
`.terraform.lock.hcl` deliberately NOT ignored — it is the only record of which provider version an
apply used, the role `pnpm-lock.yaml` plays for packages (ADR-0003). Verified with
`git check-ignore`: state and the provider cache are ignored, the lock file and every `.tf` are
trackable.

That is prevention, not detection. Nothing fails if a later commit adds `*.lock.hcl` to the ignore
list, or commits a state file through a path these patterns miss.

## Why a light was not written in this ticket

The cheap and repeatable checks are easy to name — every `.tf` lives under `infra/`, the lock file
is tracked, no `*.tfstate` is tracked, `required_version` is declared and the provider is pinned
with a constraint. That is the shape of `L-type-engines`, which reads one fact out of
`pnpm-lock.yaml`, and it needs no dependency and no network.

What it is not is free. A new standing light has to be registered in `STANDING_LIGHTS`
(`tools/gates/lib/spec-parse.mjs`), which is a `gate:` change, and rule 152 then requires a probe in
`gate-probes.mjs` that fails on the code as it was. That is a second, separable piece of work, and
folding it into the commit that first writes the Terraform would make neither reviewable.

Extending the three walk roots to include `infra/` was the other option and was rejected: it would
make `L-visible` assert visibility for files no light reads, which is half of the point, and it would
drag `.terraform/` and the state files into that light's accounting as paths needing a declared
exception.

## What would discharge it

An `L-infra` light with the five clauses above and a probe per clause. Until it exists, the
infrastructure is judged by a human reading the diff — which is how every repository without such a
light works, and is worth naming here precisely because this one claims better.
