# The two roles an Express Mode service runs under.
#
# They live in the BOOTSTRAP stage, not beside the service that uses them, and that placement is the
# whole reason the CI role can stay narrow: because these exist already, the deploy policy needs
# `iam:PassRole` on two known ARNs and never `iam:CreateRole`. A workflow that could create roles
# could create one with any policy attached, which is the same thing as being an administrator.
#
# Both trust policies and both managed-policy ARNs are taken from AWS's own walkthrough
# (https://docs.aws.amazon.com/AmazonECS/latest/developerguide/express-service-getting-started.html,
# "Step 1: Create IAM Roles"), and the two ARNs were additionally resolved against this account with
# `aws iam get-policy` rather than typed from memory. The lower-case "for" in
# AmazonECSInfrastructureRoleforExpressGatewayServices is AWS's spelling, confirmed by
# `aws iam list-policies`; it is not a typo here.

data "aws_iam_policy_document" "task_execution_trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

# The role Amazon ECS uses to pull the image and write the container's logs. It is NOT the role the
# application code runs as — this API calls no AWS service, so there is no task role at all. When
# the first one is needed it is a new role here, named, rather than extra policy on this one.
resource "aws_iam_role" "task_execution" {
  name               = "${var.name}-task-execution"
  assume_role_policy = data.aws_iam_policy_document.task_execution_trust.json
}

resource "aws_iam_role_policy_attachment" "task_execution" {
  role       = aws_iam_role.task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "infrastructure_trust" {
  statement {
    sid     = "AllowAccessInfrastructureForECSExpressServices"
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ecs.amazonaws.com"]
    }
  }
}

# The role ECS assumes to build the stack around the task: the load balancer and its HTTPS listener,
# the target group, the security groups, the auto-scaling target and the certificate. Those
# resources are therefore NOT in this repository — they are created by ECS under this role, and
# `docs/specs/CHQ-005.probe-hosting.md` records that as the trade this shape makes: one resource
# here, roughly ten in the account, none of them in Terraform's state.
resource "aws_iam_role" "infrastructure" {
  name               = "${var.name}-ecs-infrastructure"
  assume_role_policy = data.aws_iam_policy_document.infrastructure_trust.json
}

resource "aws_iam_role_policy_attachment" "infrastructure" {
  role       = aws_iam_role.infrastructure.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSInfrastructureRoleforExpressGatewayServices"
}
