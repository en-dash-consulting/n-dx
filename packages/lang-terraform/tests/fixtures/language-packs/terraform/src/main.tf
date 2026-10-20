terraform {
  required_version = ">= 1.6"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.40"
    }
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
    random = ">= 3.1"
  }

  backend "s3" {
    bucket = "orders-state"
    key    = "prod/terraform.tfstate"
  }
}

provider "aws" {
  region = var.region
}

provider "aws" {
  alias  = "west"
  region = "us-west-2"
}

variable "region" {
  type    = string
  default = "us-east-1"
}

variable "engine_version" {
  type = string
}

locals {
  name = "orders-${var.region}"
  tags = { service = local.name }
}

data "aws_vpc" "default" {
  default = true
}

module "db" {
  source = "./modules/db"
  name   = local.name
  vpc_id = data.aws_vpc.default.id
}

module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "~> 5.8"
}

module "rds" {
  source  = "registry.terraform.io/terraform-aws-modules/rds/aws//modules/db_instance"
  version = "6.10.0"
}

module "network" {
  source = "git::https://example.com/network.git?ref=v1.2.0"
}

resource "aws_db_subnet_group" "main" {
  name       = local.name
  subnet_ids = module.vpc.private_subnets
}

resource "aws_db_instance" "orders" {
  identifier           = local.name
  engine               = "postgres"
  engine_version       = var.engine_version
  db_subnet_group_name = aws_db_subnet_group.main.name
  tags                 = local.tags
}

resource "aws_lambda_function" "worker" {
  provider      = aws.west
  function_name = "orders-worker"
  runtime       = "python3.12"
  environment {
    variables = {
      DB_HOST = aws_db_instance.orders.address
      QUEUE   = "${aws_sqs_queue.jobs.url}"
    }
  }
}

resource "aws_sqs_queue" "jobs" {
  count = 1
  name  = "orders-jobs"
}

resource "aws_eks_cluster" "main" {
  name     = "orders"
  version  = "1.30"
  role_arn = aws_iam_role.cluster.arn
}

resource "aws_iam_role" "cluster" {
  name = "orders-eks"
}

output "db_endpoint" {
  value = aws_db_instance.orders.endpoint
}

output "db_module" {
  value = module.db.id
}
