resource "google_sql_database_instance" "orders" {
  name             = "orders"
  database_version = "POSTGRES_15"
  settings {
    tier = "db-f1-micro"
  }
}

resource "google_cloudfunctions2_function" "export" {
  name = "orders-export"
  build_config {
    runtime     = "nodejs20"
    entry_point = "run"
  }
}

resource "google_container_cluster" "primary" {
  name               = "orders"
  min_master_version = "1.29"
}

resource "google_cloud_run_v2_service" "api" {
  name = "orders-api"
  template {
    containers {
      image = "gcr.io/orders/api:1.4.2"
    }
  }
}
