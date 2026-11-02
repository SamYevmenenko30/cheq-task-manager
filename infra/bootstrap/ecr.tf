# The registry the image is pushed to.
#
# It is in the bootstrap stage because of ORDER: the workflow pushes an image and then applies
# `infra/`, which creates a service referencing that image by tag. A registry created by the same
# apply that consumes it cannot hold anything on the first run.
#
# `image_tag_mutability = "IMMUTABLE"` is the point worth defending. Every deploy tags with the
# commit sha, so a tag is a fact about one commit; making tags immutable means a sha can never be
# re-pointed at different bytes, which is what makes "the image running in production is this
# commit" a claim anyone can check rather than a convention everyone follows. It also rules out
# `:latest` as a deploy input, deliberately.

resource "aws_ecr_repository" "api" {
  name                 = "${var.name}-api"
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }
}

# Without this, every deploy adds a layer set nobody deletes and the bill grows with the commit
# count. Ten is enough to roll back by hand a few times and small enough to stay free-tier sized.
resource "aws_ecr_lifecycle_policy" "api" {
  repository = aws_ecr_repository.api.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Keep the ten most recent images; a rollback target older than that is a git checkout and a rebuild, not a registry lookup."
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = 10
        }
        action = { type = "expire" }
      }
    ]
  })
}
