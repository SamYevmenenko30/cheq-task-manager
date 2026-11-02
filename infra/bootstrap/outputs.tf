# What the rest of the system needs from this stage. Each of these is copied ONCE, by a human, into
# the place named in the description — which is the price of having a stage that CI cannot rewrite.

output "deploy_role_arn" {
  description = "Set as the repository variable AWS_DEPLOY_ROLE_ARN. Not a secret: it is useless without a GitHub OIDC token for this repository's main branch."
  value       = aws_iam_role.deploy.arn
}

output "ecr_repository_url" {
  description = "The registry the workflow pushes to, and the value of var.image_repository in infra/."
  value       = aws_ecr_repository.api.repository_url
}

output "task_execution_role_arn" {
  description = "The value of var.task_execution_role_arn in infra/."
  value       = aws_iam_role.task_execution.arn
}

output "infrastructure_role_arn" {
  description = "The value of var.infrastructure_role_arn in infra/."
  value       = aws_iam_role.infrastructure.arn
}

output "state_bucket" {
  description = "The bucket in infra/'s backend block. Terraform cannot read a backend from a variable, so this one is typed into infra/main.tf by hand — the single place in this repository where a value is copied rather than referenced."
  value       = aws_s3_bucket.tfstate.bucket
}
