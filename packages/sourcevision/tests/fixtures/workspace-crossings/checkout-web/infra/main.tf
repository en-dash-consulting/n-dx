resource "aws_sqs_queue" "order_events" {
  name                       = "acme-order-events"
  visibility_timeout_seconds = 30
}
