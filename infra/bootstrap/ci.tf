# The identity the CI workflow deploys as. No access key exists anywhere.
#
# GitHub signs a short-lived OIDC token for each workflow run; AWS trusts GitHub as an identity
# provider and exchanges that token for temporary credentials. The only thing the repository holds
# is a role ARN, which is not a secret — so there is nothing to rotate, nothing to leak out of a
# log, and nothing that keeps working after the repository is deleted.

# `thumbprint_list` is deliberately absent. AWS validates GitHub's certificate against its own
# library of trusted root CAs — GitHub is one of the providers named for this — so a thumbprint here
# would be an unused constant that rots the next time GitHub rotates a certificate. Omitting it also
# keeps the `tls` provider out of this repository (confirmed Optional:
# https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/iam_openid_connect_provider).
resource "aws_iam_openid_connect_provider" "github" {
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
}

locals {
  # Empty means the repository does not use immutable subject claims, so the classic prefix applies.
  github_subject_prefix = var.github_subject_prefix != "" ? var.github_subject_prefix : "repo:${var.github_repository}"
}

data "aws_iam_policy_document" "deploy_trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    # BOTH the repository AND the ref, as one `sub` string. Pinning only the repository would let a
    # pull request from a fork — which runs in the base repository's context — assume this role and
    # deploy whatever it contains. Pinning the ref to `refs/heads/main` means only a commit that
    # already reached the default branch can reach AWS.
    #
    # THE PREFIX IS NOT `repo:<owner>/<name>` HERE, and assuming it was cost this project one failed
    # pipeline run. This repository has GitHub's IMMUTABLE SUBJECT CLAIMS switched on, which appends
    # the numeric owner id and repository id to each half of the prefix:
    #
    #   gh api repos/<owner>/<name>/actions/oidc/customization/sub
    #   -> {"use_default":true,"use_immutable_subject":true,
    #       "sub_claim_prefix":"repo:<owner>@<ownerId>/<name>@<repoId>"}
    #
    # so the claim GitHub signs is `<that prefix>:ref:refs/heads/main`, and a trust policy written
    # against the classic form matches nothing. MEASURED 2026-11-02: with the classic prefix the
    # `gates` job passed and `deploy` died in configure-aws-credentials with `Could not assume role
    # with OIDC: Not authorized to perform sts:AssumeRoleWithWebIdentity` — an error that names
    # neither the claim nor the mismatch, which is why the subject has to be read from GitHub rather
    # than inferred.
    #
    # `github_subject_prefix` therefore carries the prefix verbatim, and defaults to the classic
    # form for a repository that has the feature off. The ids are the point of the feature: they
    # survive a rename, so this pin cannot be defeated by renaming the repository or the account
    # into one somebody else has released.
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["${local.github_subject_prefix}:ref:refs/heads/main"]
    }
  }
}

resource "aws_iam_role" "deploy" {
  name               = "${var.name}-deploy"
  description        = "Assumed by GitHub Actions on ${var.github_repository}@main to apply infra/ and push the image. Cannot touch the bootstrap stage."
  assume_role_policy = data.aws_iam_policy_document.deploy_trust.json
}

# WHAT THIS POLICY IS AND IS NOT. It is scoped to the resources this project's names cover wherever
# the service supports resource-level permissions, and it is NOT least privilege: several statements
# below are service-level wildcards because the AWS APIs they cover do not accept a resource ARN on
# the `Create*` call, so there is nothing narrower to write. That is stated rather than hidden, and
# narrowing it is owed (TD-0019).
#
# What it deliberately CANNOT do is the thing that matters: no `iam:CreateRole`, no
# `iam:AttachRolePolicy`, no `iam:PutRolePolicy`. A role that can create roles can create an
# administrator, so CI passes the two roles this stage already made and cannot invent a third. It
# also cannot write this stage's own state or delete the registry.
data "aws_iam_policy_document" "deploy" {
  # Docker login. `GetAuthorizationToken` takes no resource; AWS requires `*` here.
  statement {
    sid       = "EcrLogin"
    effect    = "Allow"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  # Push and pull on this one repository. Enumerated rather than `ecr:*` so the workflow cannot
  # delete the repository or rewrite its lifecycle policy.
  statement {
    sid    = "EcrPushPull"
    effect = "Allow"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:InitiateLayerUpload",
      "ecr:UploadLayerPart",
      "ecr:CompleteLayerUpload",
      "ecr:PutImage",
      "ecr:BatchGetImage",
      "ecr:GetDownloadUrlForLayer",
      "ecr:DescribeImages",
      "ecr:DescribeRepositories",
    ]
    resources = [aws_ecr_repository.api.arn]
  }

  # The application root's state, and only that key. The lock file lives in the same bucket since
  # Terraform 1.10, which is why `DeleteObject` is here: releasing a lock is a delete.
  statement {
    sid       = "TerraformState"
    effect    = "Allow"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = ["${aws_s3_bucket.tfstate.arn}/app/*"]
  }

  statement {
    sid       = "TerraformStateList"
    effect    = "Allow"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.tfstate.arn]
  }

  # The SPA bucket, which the application root creates and the workflow then syncs into. Scoped by
  # name prefix; the state bucket does not match it, so CI cannot reach its own history.
  statement {
    sid       = "WebBucket"
    effect    = "Allow"
    actions   = ["s3:*"]
    resources = ["arn:aws:s3:::${var.name}-web-*", "arn:aws:s3:::${var.name}-web-*/*"]
  }

  # Express Mode. `CreateExpressGatewayService` names no resource — the service does not exist yet —
  # so this cannot be scoped on create, and `ecs:*` is the honest spelling rather than a list of
  # action names that would silently drift as the service gains APIs.
  statement {
    sid       = "EcsExpress"
    effect    = "Allow"
    actions   = ["ecs:*"]
    resources = ["*"]
  }

  # The one IAM permission CI has, and the condition is what makes it safe: each role may be passed
  # only to the service that is supposed to assume it, so a stolen token cannot attach these roles
  # to something else.
  statement {
    sid       = "PassTaskExecutionRole"
    effect    = "Allow"
    actions   = ["iam:PassRole"]
    resources = [aws_iam_role.task_execution.arn]

    # `StringEqualsIfExists`, AND BOTH ECS PRINCIPALS, because UpdateExpressGatewayService refused
    # the classic form and the error cannot tell us why. MEASURED 2026-11-02, deploy role's own
    # credentials, nothing else changed:
    #
    #   AccessDeniedException: User: arn:aws:sts::...:assumed-role/cheq-deploy/cheq-deploy-41469834457
    #   is not authorized to perform: iam:PassRole on resource:
    #   arn:aws:iam::004940046152:role/cheq-task-execution because no identity-based policy allows
    #   the iam:PassRole action
    #
    # That is the message IAM returns when no statement APPLIES — which happens both when the key
    # `iam:PassedToService` is absent (a `StringEquals` condition on an absent key never matches) and
    # when it is present with a value the list does not contain. The two cases are indistinguishable
    # from the outside, and Express Mode is new enough that neither is documented. The local creates
    # ran as an administrator with `iam:PassRole` unconditioned, so they never exercised this.
    #
    # `...IfExists` covers the absent case and both principals cover the present one. Be clear about
    # the cost: if the key is absent the condition is vacuous, and what still constrains this is the
    # RESOURCE — exactly one role ARN, whose only policy is AmazonECSTaskExecutionRolePolicy. What
    # the condition still buys when the key IS set is that the role cannot be handed to ec2, lambda
    # or anything else outside ECS.
    condition {
      test     = "StringEqualsIfExists"
      variable = "iam:PassedToService"
      values   = ["ecs-tasks.amazonaws.com", "ecs.amazonaws.com"]
    }
  }

  statement {
    sid       = "PassInfrastructureRole"
    effect    = "Allow"
    actions   = ["iam:PassRole"]
    resources = [aws_iam_role.infrastructure.arn]

    # Same reasoning as PassTaskExecutionRole above; this role's only policy is
    # AmazonECSInfrastructureRoleforExpressGatewayServices.
    condition {
      test     = "StringEqualsIfExists"
      variable = "iam:PassedToService"
      values   = ["ecs-tasks.amazonaws.com", "ecs.amazonaws.com"]
    }
  }

  # CloudFront's create and invalidate APIs do not take resource ARNs, so `*` is the only form that
  # works. The distribution is the public face of the deployment, and this is the widest grant here.
  statement {
    sid       = "CloudFront"
    effect    = "Allow"
    actions   = ["cloudfront:*"]
    resources = ["*"]
  }

  # The container's log group, created by the application root and scoped to the ECS path.
  statement {
    sid    = "Logs"
    effect = "Allow"
    actions = [
      "logs:CreateLogGroup",
      "logs:DeleteLogGroup",
      "logs:PutRetentionPolicy",
      "logs:TagResource",
      "logs:UntagResource",
      "logs:ListTagsForResource",
    ]
    resources = ["arn:aws:logs:${var.region}:${data.aws_caller_identity.current.account_id}:log-group:/aws/ecs/*"]
  }

  # `logs:DescribeLogGroups` CANNOT BE SCOPED, and scoping it is why the first pipeline run failed.
  # It is a list operation: IAM evaluates it against `arn:aws:logs:<region>:<account>:log-group::log-stream:`
  # — an ARN with no log-group name in it — so a statement that names `log-group:/aws/ecs/*` matches
  # nothing and the call is refused. MEASURED 2026-11-02, with the deploy role's own credentials and
  # nothing else changed:
  #
  #   Error: reading CloudWatch Logs Log Group (/aws/ecs/cheq-api): ... AccessDeniedException: User:
  #   arn:aws:sts::004940046152:assumed-role/cheq-deploy/cheq-deploy-41466707997 is not authorized to
  #   perform: logs:DescribeLogGroups on resource:
  #   arn:aws:logs:eu-north-1:004940046152:log-group::log-stream: because no identity-based policy
  #   allows the logs:DescribeLogGroups action
  #
  # Terraform calls it on every REFRESH of `aws_cloudwatch_log_group`, so this breaks a plan rather
  # than only an apply. `*` is the narrowest resource this action accepts; what it grants is the
  # ability to see that log groups exist and their names, not to read a single log event — reading
  # events is `logs:GetLogEvents` and `logs:FilterLogEvents`, neither of which this role has.
  statement {
    sid       = "LogsDescribe"
    effect    = "Allow"
    actions   = ["logs:DescribeLogGroups"]
    resources = ["*"]
  }

  # Read-only, for the data sources that look up the default VPC and its subnets. Describe calls in
  # EC2 do not accept resource ARNs either, and nothing here can change anything.
  statement {
    sid       = "ReadOnlyLookups"
    effect    = "Allow"
    actions   = ["ec2:Describe*", "elasticloadbalancing:Describe*", "application-autoscaling:Describe*", "acm:Describe*", "acm:ListCertificates"]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "deploy" {
  name   = "${var.name}-deploy"
  role   = aws_iam_role.deploy.id
  policy = data.aws_iam_policy_document.deploy.json
}
