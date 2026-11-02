output "site_url" {
  description = "THE live URL — the one the README quotes and the one the deploy's smoke check curls. Both halves answer here: the SPA at /, the API at /health and /tasks."
  value       = "https://${aws_cloudfront_distribution.site.domain_name}"
}

output "api_origin_url" {
  description = "The service's own HTTPS endpoint, past the distribution. For telling an edge problem from an application one: if this answers and site_url does not, the fault is a behaviour or a cache policy, not the container."
  value       = "https://${local.api_origin_domain}"
}

output "cloudfront_distribution_id" {
  description = "What the deploy invalidates after syncing the SPA."
  value       = aws_cloudfront_distribution.site.id
}

output "web_bucket" {
  description = "What the deploy syncs the Vite build into."
  value       = aws_s3_bucket.web.bucket
}

output "api_service_arn" {
  description = "The Express Mode service, for `aws ecs describe-express-gateway-service` when a deploy is stuck."
  value       = aws_ecs_express_gateway_service.api.service_arn
}
