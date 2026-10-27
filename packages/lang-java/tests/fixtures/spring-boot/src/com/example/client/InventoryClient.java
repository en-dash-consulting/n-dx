package com.example.client;

import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.GetMapping;

// A Feign client with a url: one outbound fact, and no routes (an interface is not a controller).
@FeignClient(name = "inventory", url = "${inventory.url}")
public interface InventoryClient {
  @GetMapping("/items")
  String items();

  // Without a url, the client name is the target, as a config key.
  @FeignClient("catalog")
  interface CatalogClient {
    @GetMapping("/products")
    String products();
  }
}
