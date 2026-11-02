# The API: one resource, and roughly ten in the account.
#
# `aws_ecs_express_gateway_service` provisions a Fargate service, an Application Load Balancer with
# an HTTPS listener on 443, a target group, security groups with minimal ingress, an auto-scaling
# target and policy, a CloudWatch log group, a faulty-deployment alarm and an ACM certificate — all
# under `infrastructure_role_arn`, none of them in this state file
# (https://docs.aws.amazon.com/AmazonECS/latest/developerguide/express-service-work.html).
#
# That is the trade, and it is recorded as a trade in CHQ-005.probe-hosting.md rather than sold as
# pure simplification: the alternative shape — a single EC2 instance — puts roughly seven resources
# in this repository plus a shell script and a deploy channel, and those parts are then ours to own.
# Here they are AWS's, which also means a console reader sees resources Terraform will not account
# for, and `terraform destroy` is reported to leave the load balancer and certificate behind
# (UNVERIFIED, TD-0019).
#
# WHAT WE DELIBERATELY SET, because every one of these defaults is wrong for this application:
#   cpu/memory      1 vCPU and 2 GB by default — four times what one Node process needs
#   container_port  80 by default; this image listens on 3000
#   health path     not `/health` by default, and `/health` is the only path CHQ-002 S1 promises
#   task count      1..20 by default; this store is one process's RAM, so 1..1

resource "aws_cloudwatch_log_group" "api" {
  name              = "/aws/ecs/${var.name}-api"
  retention_in_days = var.log_retention_days
}

resource "aws_ecs_express_gateway_service" "api" {
  service_name            = "${var.name}-api"
  execution_role_arn      = var.task_execution_role_arn
  infrastructure_role_arn = var.infrastructure_role_arn

  cpu    = var.api_cpu
  memory = var.api_memory

  health_check_path = var.health_check_path

  # No `task_role_arn`. This API calls no AWS service at all — the store is in memory and the log
  # sink is stdout — so there is no role for the application code to assume. The day it needs one it
  # is a new role in the bootstrap stage, named, rather than permissions quietly added to the
  # execution role (which exists so ECS can pull and log, not so the app can act).

  primary_container {
    image          = "${var.image_repository}:${var.image_tag}"
    container_port = var.container_port

    # `log_stream_prefix` IS REQUIRED, and the documentation says the opposite. The Express Mode
    # defaults page lists `awslogs-stream-prefix: "ecs"` among the values "set by Express Mode",
    # reading as a default one may omit. MEASURED 2026-11-02: the first apply of this resource
    # failed with `1 validation error(s) found. - missing required field,
    # CreateExpressGatewayServiceInput.PrimaryContainer.AwsLogsConfiguration.LogStreamPrefix`.
    # The default applies when the whole block is absent; supplying the block makes every field in
    # it the caller's to fill. "ecs" is the value the documentation names.
    aws_logs_configuration {
      log_group         = aws_cloudwatch_log_group.api.name
      log_stream_prefix = "ecs"
    }

    # The image already defaults PORT and HOST (Dockerfile:72-74), so nothing here repeats them —
    # two places setting one value is one place to forget. NODE_ENV is the exception: it is what
    # tells the runtime this is not a developer's machine.
    environment {
      name  = "NODE_ENV"
      value = "production"
    }
  }

  # ONE TASK, pinned at both ends. The task list lives in one process's memory (CHQ-001's probe
  # decided the store; CHQ-002 S7 fixed the port as asynchronous), so a second task is a second,
  # different task list answering the same URL — the load balancer would alternate between them and
  # a reader would see tasks appear and disappear. Pinning the scaling target makes that structural
  # rather than a configuration anyone can raise.
  #
  # What this does NOT prevent: Express Mode deploys CANARY and the strategy cannot be changed, so
  # during a deploy two revisions briefly serve at once and the store resets. Both facts belong in
  # the README; no platform can promise otherwise for an in-memory store.
  scaling_target {
    min_task_count = 1
    max_task_count = 1

    # BOTH OF THESE ARE WRITTEN DOWN ONLY BECAUSE THE PROVIDER REQUIRES AGREEMENT, not because this
    # service scales. With min and max both pinned to 1 the policy can never fire, so the metric and
    # the target are inert. MEASURED 2026-11-02: omitting them created the service in AWS (five
    # minutes) and then failed the apply with `Provider produced inconsistent result after apply:
    # .scaling_target[0].auto_scaling_target_value: was null, but now cty.NumberIntVal(60)`, and the
    # same for `auto_scaling_metric` / `AVERAGE_CPU`. The API fills its own defaults, the provider
    # planned null, and Terraform refuses a result that disagrees with its plan. The two values here
    # are exactly what the API returned, so the plan now matches what comes back.
    auto_scaling_target_value = 60
    auto_scaling_metric       = "AVERAGE_CPU"
  }

  # So `apply` returns only once the service is actually serving. Without it the workflow would
  # report a successful deploy while the task was still starting, and the smoke check that follows
  # would be racing the thing it is meant to verify.
  wait_for_steady_state = true
}

# The endpoint CloudFront points at. AWS documents the service URL as
# `https://<service-name>.ecs.<region>.on.aws/`, and the resource exposes `ingress_paths[].endpoint`
# — whether that attribute carries the scheme is UNVERIFIED until the first apply, so the scheme is
# stripped defensively here: CloudFront's `domain_name` takes a host and nothing else.
locals {
  api_origin_domain = replace(aws_ecs_express_gateway_service.api.ingress_paths[0].endpoint, "/^https?:\\/\\//", "")
}
