# ONE distribution in front of BOTH halves. This is the part all three attempts of the hosting probe
# reached independently, each from a different compute choice, which is why it is the finding rather
# than a preference (docs/specs/CHQ-005.probe-hosting.md).
#
# The browser sees ONE origin, and that deletes three problems rather than solving them:
#   * no CORS layer in `apps/api` — CHQ-002 deferred it and it stays deferred, with no code to write;
#   * no API base URL baked into the Vite build, which would couple the frontend's build output to a
#     Terraform output and make the SPA un-buildable without AWS;
#   * no mixed content, whatever protocol the backend origin speaks.
#
# The cost is that an API path exists in two places — here and in the SPA's fetch calls — so a
# fourth route needs a fourth behaviour. That is the trade, and it is cheaper than the three above.

data "aws_cloudfront_cache_policy" "optimized" {
  name = "Managed-CachingOptimized"
}

data "aws_cloudfront_cache_policy" "disabled" {
  name = "Managed-CachingDisabled"
}

# Forwards everything the viewer sent EXCEPT `Host`. Not a detail: Express Mode's load balancer
# routes on a host-header listener rule
# (https://docs.aws.amazon.com/AmazonECS/latest/developerguide/express-service-work.html —
# "listener-configurations.rule-type: host-header"), so forwarding the viewer's `Host` would arrive
# at the ALB as a hostname it has no rule for, and every API request would fail at the edge of AWS
# rather than in our code.
data "aws_cloudfront_origin_request_policy" "all_viewer_except_host" {
  name = "Managed-AllViewerExceptHostHeader"
}

resource "aws_cloudfront_origin_access_control" "web" {
  name                              = "${var.name}-web"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_distribution" "site" {
  enabled             = true
  comment             = "${var.name}: the SPA and the API behind one origin"
  default_root_object = "index.html"

  # North America and Europe. The cheapest class that covers where this will be looked at; the
  # free tier covers the traffic either way.
  price_class = "PriceClass_100"

  origin {
    origin_id                = "web"
    domain_name              = aws_s3_bucket.web.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.web.id
  }

  origin {
    origin_id   = "api"
    domain_name = local.api_origin_domain

    # HTTPS all the way to the origin. Express Mode terminates TLS on its own load balancer with a
    # certificate it manages, so this leg needs no certificate of ours and is not plain HTTP — which
    # the probe recorded as the one cost every attempt's shape carried, and this shape does not.
    custom_origin_config {
      origin_protocol_policy = "https-only"
      http_port              = 80
      https_port             = 443
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  # The SPA. Static, hashed assets, so the managed caching policy is what it is for.
  default_cache_behavior {
    target_origin_id       = "web"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    cache_policy_id        = data.aws_cloudfront_cache_policy.optimized.id
    compress               = true
  }

  # CHQ-002 S1. Separate from /tasks because a load balancer's health path and a business path have
  # nothing in common except their origin.
  ordered_cache_behavior {
    path_pattern             = "/health"
    target_origin_id         = "api"
    viewer_protocol_policy   = "redirect-to-https"
    allowed_methods          = ["GET", "HEAD"]
    cached_methods           = ["GET", "HEAD"]
    cache_policy_id          = data.aws_cloudfront_cache_policy.disabled.id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.all_viewer_except_host.id
    compress                 = true
  }

  # CHQ-002 S2, S3, S4, S5. Caching DISABLED, not short: a cached POST response, or a cached list
  # from before the last create, is an application bug nobody can reproduce locally.
  ordered_cache_behavior {
    path_pattern             = "/tasks"
    target_origin_id         = "api"
    viewer_protocol_policy   = "redirect-to-https"
    allowed_methods          = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods           = ["GET", "HEAD"]
    cache_policy_id          = data.aws_cloudfront_cache_policy.disabled.id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.all_viewer_except_host.id
    compress                 = true
  }

  # `/tasks` and `/tasks/*` are two patterns because CloudFront's `/tasks*` would also claim a future
  # SPA route called `/tasksomething`. Present now so a per-task path does not need an infrastructure
  # change the day the API grows one.
  ordered_cache_behavior {
    path_pattern             = "/tasks/*"
    target_origin_id         = "api"
    viewer_protocol_policy   = "redirect-to-https"
    allowed_methods          = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods           = ["GET", "HEAD"]
    cache_policy_id          = data.aws_cloudfront_cache_policy.disabled.id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.all_viewer_except_host.id
    compress                 = true
  }

  # THERE IS DELIBERATELY NO `custom_error_response` HERE, and it is the sharpest thing the probe
  # found. Two of the three attempts mapped 403/404 to /index.html with status 200 so the SPA could
  # own client-side routes. CloudFront configures custom error responses per DISTRIBUTION, not per
  # behaviour — so that mapping rewrites a genuine 404 from the API into an HTML page with status
  # 200, and an API client sees a successful response containing the SPA. The third attempt named the
  # mechanism and left it out.
  #
  # So CHQ-003 either has no client-side routes, or gets a CloudFront Function attached to the SPA
  # behaviour alone. That is CHQ-003's decision and it is written here so it is not rediscovered.

  viewer_certificate {
    # The `*.cloudfront.net` certificate. A custom domain would need ACM in us-east-1 and a domain
    # nobody has bought; the assignment asks for a live URL, not a branded one.
    cloudfront_default_certificate = true
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }
}
