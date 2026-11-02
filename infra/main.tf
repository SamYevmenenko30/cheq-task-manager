# The application root: the running stack. Applied by the CI workflow on every push to `main`.
#
# Everything privileged or long-lived is in `infra/bootstrap/` — the identity CI authenticates as,
# the registry, the two roles the task runs under, and the bucket holding this stage's state. What
# is left here is exactly what a deploy changes, which is why CI is allowed to apply it.
#
# THE SHAPE, and why it is this one, is recorded in `docs/specs/CHQ-005.probe-hosting.md`: three
# independent attempts agreed on one CloudFront distribution in front of both halves and disagreed
# about the compute. App Runner — which all three reached for — is closed to new customers, so the
# compute is AWS's named successor, ECS Express Mode.

terraform {
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.71"
    }
  }

  # PARTIAL configuration on purpose. A bucket name is globally unique, so it cannot be derived from
  # the project name, and a backend block cannot read a variable — Terraform resolves the backend
  # before variables exist. The two ways out are to hardcode somebody's bucket name in a committed
  # file or to pass it at init:
  #
  #   terraform init -backend-config="bucket=$(terraform -chdir=bootstrap output -raw state_bucket)"
  #
  # `use_lockfile` replaces the DynamoDB lock table that every pre-1.10 guide tells you to create:
  # the lock is a file in this same bucket, so there is no second resource and no second thing to
  # forget to delete.
  backend "s3" {
    key          = "app/terraform.tfstate"
    use_lockfile = true
  }
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project   = var.name
      ManagedBy = "terraform"
      Stage     = "app"
    }
  }
}

data "aws_caller_identity" "current" {}
