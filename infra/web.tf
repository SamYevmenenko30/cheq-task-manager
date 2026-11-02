# The SPA's bucket. Private — the only thing that may read it is the CloudFront distribution.
#
# There is no bucket website configuration and no public read policy, which is the older way to do
# this and would make the bucket reachable over plain HTTP at its own URL as well. The origin access
# control in `cdn.tf` is the only grant, so the SPA has exactly one public address and it is the one
# with TLS on it.

# The account id makes the name globally unique without a `random` provider or a hand-picked
# suffix, and keeps it inside `${var.name}-web-*` — the prefix the deploy policy scopes to, so the
# workflow can sync this bucket and cannot reach the state bucket.
resource "aws_s3_bucket" "web" {
  bucket = "${var.name}-web-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_public_access_block" "web" {
  bucket = aws_s3_bucket.web.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# `AWS:SourceArn` pinned to this distribution is what makes the grant narrow: the principal is the
# CloudFront service, which is shared by every account, so without the condition any distribution
# anywhere could read this bucket.
data "aws_iam_policy_document" "web" {
  statement {
    sid       = "AllowThisDistributionOnly"
    effect    = "Allow"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.web.arn}/*"]

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.site.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "web" {
  bucket = aws_s3_bucket.web.id
  policy = data.aws_iam_policy_document.web.json
}
