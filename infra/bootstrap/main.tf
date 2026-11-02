# The bootstrap stage: everything that must exist BEFORE the first automated deploy, and
# everything privileged enough that CI should not be able to rewrite it.
#
# WHY THERE ARE TWO STAGES. The application root (`infra/`) is applied by the CI workflow, which
# authenticates as an IAM role. That role cannot create the identity it authenticates with, and the
# registry has to hold an image before a service can reference one. A single root would have to
# create its own caller — so the identity, the registry, the two roles the service runs under, and
# the bucket that holds the application root's state live here instead, applied ONCE by a human.
#
# The narrowness of the CI role is bought here: because this stage owns the IAM roles, the deploy
# policy needs `iam:PassRole` on two known ARNs and no `iam:CreateRole` at all.
#
# STATE. This stage keeps LOCAL state and it is gitignored, like every other `.tfstate` in this
# repository. Nothing here is secret, but state is not a source of truth worth committing: if it is
# lost, each of these resources is recoverable with `terraform import`, and that is the documented
# recovery rather than a file in git. The application root does use a remote backend — the bucket
# this stage creates.

terraform {
  # 1.10 is the floor because `infra/`'s S3 backend uses `use_lockfile`, which replaced the
  # DynamoDB lock table in that release. Keeping both stages on one floor means one version to
  # install rather than two to reason about.
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.71"
    }
  }
}

provider "aws" {
  region = var.region

  # Every resource this stage creates carries these, so a stray resource in the console can be
  # traced back to the code that made it — which is the whole claim of "nothing created by hand".
  default_tags {
    tags = {
      Project   = var.name
      ManagedBy = "terraform"
      Stage     = "bootstrap"
    }
  }
}

data "aws_caller_identity" "current" {}
