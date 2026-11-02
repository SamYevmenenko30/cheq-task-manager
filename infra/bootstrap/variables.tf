# eu-north-1 IS NOT A PREFERENCE, it is the one region this account's organization leaves open, and
# the reason is worth keeping next to the value. The SCP
# `AdvancedModeRegionRestrictionSecurityControlPolicy` (p-jxfv0n88) carries three Deny statements:
# two of them are scoped to `us-east-1` and `us-west-2` and deny everything outside a narrow
# allow-list, and the third, `RegionFloor`, denies everything when `aws:RequestedRegion` is NOT in
# [eu-north-1, unspecified, us-east-1, us-west-2]. eu-north-1 is therefore the only region named by
# the carve-out and covered by no partitional statement — nothing in that policy denies there.
# MEASURED 2026-11-02: in eu-north-1 `s3:CreateBucket` and `ecr:CreateRepository` both SUCCEEDED
# (and both resources were deleted), while the same calls in us-east-1 and eu-central-1 were refused
# with an explicit deny. docs/specs/CHQ-005.probe-hosting.md has the full map.
variable "region" {
  description = "The AWS region everything is created in. One region: there is no multi-region story here and pretending otherwise would be a shape nobody asked for."
  type        = string
  default     = "eu-north-1"
}

variable "name" {
  description = "The project prefix every resource name is derived from. It is also what the deploy policy scopes to, so changing it changes what CI may touch."
  type        = string
  default     = "cheq"
}

variable "github_repository" {
  description = "The repository allowed to assume the deploy role, as `owner/name`. The trust policy pins this AND the branch, so a workflow on a fork or a pull request cannot assume it."
  type        = string
}

variable "state_bucket_name" {
  description = "The bucket holding the application root's state. A bucket name is globally unique, so it cannot be derived from the project name alone without colliding with somebody else's."
  type        = string
}
