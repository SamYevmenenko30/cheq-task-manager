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
  description = "The AWS region. Must match the bootstrap stage's: the registry, the service and the log group all live in one region."
  type        = string
  default     = "eu-north-1"
}

variable "name" {
  description = "The project prefix. It must match the bootstrap stage's, because the deploy policy there scopes to resources named with it."
  type        = string
  default     = "cheq"
}

variable "image_repository" {
  description = "The registry URI without a tag, from the bootstrap stage's ecr_repository_url output."
  type        = string
}

variable "image_tag" {
  description = "The commit sha to run. THE ONLY PER-DEPLOY INPUT: the workflow passes -var image_tag=$GITHUB_SHA, so a deploy is one value changing and the diff of a deploy is one line. The registry is IMMUTABLE, so a tag cannot be re-pointed at other bytes."
  type        = string
}

variable "task_execution_role_arn" {
  description = "From the bootstrap stage. Lets ECS pull the image and write the container's logs."
  type        = string
}

variable "infrastructure_role_arn" {
  description = "From the bootstrap stage. The role ECS assumes to create the load balancer, its certificate, the target group, the security groups and the auto-scaling target — resources this repository therefore does not hold."
  type        = string
}

variable "container_port" {
  description = "The port the container listens on. It must equal the Dockerfile's EXPOSE and its ENV PORT (Dockerfile:71-74); a mismatch is a target group that never reports a healthy target."
  type        = number
  default     = 3000
}

variable "health_check_path" {
  description = "The path the load balancer polls. Set explicitly because the default is not ours — AWS documents it as \"/\" in one place and \"/ping\" in another, and this API answers neither (CHQ-002 S1)."
  type        = string
  default     = "/health"
}

variable "api_cpu" {
  description = "Task CPU. UNITS ARE UNVERIFIED HERE: the Terraform resource's own example writes cpu = \"256\" (ECS task units, a quarter vCPU) while the AWS CLI for the same API takes --cpu 2 meaning two vCPUs. The resource's documented form is used. If the provider means vCPUs, ECS rejects 256 at apply and the error is immediate — the failure mode is loud, not a 256-vCPU bill. Express Mode's own default is 1 vCPU / 2 GB, which is four times what this process needs and about $36/month instead of $9."
  type        = string
  default     = "256"
}

variable "api_memory" {
  description = "Task memory, in the same units as api_cpu and with the same caveat. 512 MiB is the smallest Fargate pairing for a quarter vCPU and is ample for one Node process holding a task list in a Map."
  type        = string
  default     = "512"
}

variable "log_retention_days" {
  description = "How long the container's JSON log lines are kept. Finite on purpose: a log group with no retention keeps every line for ever and bills for it."
  type        = number
  default     = 14
}
