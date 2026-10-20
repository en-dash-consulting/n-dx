terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0"
    }
  }
}

resource "aws_security_group" "db" {
  name   = "${var.name}-db"
  vpc_id = var.vpc_id
}

resource "aws_rds_cluster" "this" {
  cluster_identifier     = var.name
  engine                 = "aurora-postgresql"
  engine_version         = "16.2"
  vpc_security_group_ids = [aws_security_group.db.id]
}

output "id" {
  value = aws_rds_cluster.this.id
}
