variable "region" {
  description = "The AWS region everything is created in. One region: there is no multi-region story here and pretending otherwise would be a shape nobody asked for."
  type        = string
  default     = "eu-central-1"
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
