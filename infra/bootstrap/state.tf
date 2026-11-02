# The bucket the application root keeps its state in.
#
# Versioning is on because Terraform state is the only record of what exists; a bad apply that
# writes a truncated state is recoverable from a previous version and is not recoverable otherwise.
# There is no DynamoDB lock table: since Terraform 1.10 the S3 backend locks with a lock FILE in the
# same bucket (`use_lockfile`), so the second table that every older guide tells you to create is
# one resource this repository does not need — and `dynamodb` is not in this account's allow list.

resource "aws_s3_bucket" "tfstate" {
  bucket = var.state_bucket_name
}

resource "aws_s3_bucket_versioning" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
