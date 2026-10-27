package com.example.client;

import io.grpc.ManagedChannel;
import io.grpc.ManagedChannelBuilder;
import java.net.URI;
import java.net.http.HttpRequest;
import java.util.List;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.reactive.function.client.WebClient;

// Outbound HTTP, gRPC and environment reads.
public class HttpClients {
  private final RestTemplate restTemplate;
  private final WebClient webClient;
  private final Mailer mailer;

  HttpClients(RestTemplate restTemplate, WebClient webClient, Mailer mailer) {
    this.restTemplate = restTemplate;
    this.webClient = webClient;
    this.mailer = mailer;
  }

  void rest(String url) {
    // A placeholder leading a literal: config, with the key as target.
    restTemplate.getForObject("${orders.url}/orders", String.class);
    this.restTemplate.postForEntity("http://billing/charge", null, String.class);
    // Not a literal: unknown.
    restTemplate.exchange(url, null, null, String.class);
    restTemplate.delete("http://billing/charge/1");
    // The receiver's type is not known, but getForObject is RestTemplate's alone: likely.
    template().getForObject("http://catalog/items", String.class);
    // Shared method names on an unknown receiver are not reported.
    template().put("http://catalog/items", null);
  }

  void reactive(RestClient restClient) {
    webClient.get().uri("/inventory").retrieve();
    restClient.post().uri("${payments.url}").retrieve();
    WebClient.create("http://inventory:8080");
    RestClient.create("http://payments:8080").get().uri("/status").retrieve();
  }

  void jdk() {
    HttpRequest.newBuilder(URI.create("https://api.example.com/v1")).build();
    HttpRequest.newBuilder().uri(URI.create("https://chain.example.com")).GET().build();
  }

  void grpcAndEnv() {
    ManagedChannel orders = ManagedChannelBuilder.forAddress("orders.internal", 9090).usePlaintext().build();
    ManagedChannelBuilder.forTarget("dns:///inventory:443").build();
    String database = System.getenv("DATABASE_URL");
  }

  void unrelated(List<String> list) {
    // Same method names on receivers of other types: nothing.
    list.get(0);
    mailer.send("ops@example.com", "hello");
    mailer.delete("http://not-a-client");
  }

  RestTemplate template() { return restTemplate; }

  interface Mailer {
    void send(String to, String body);
    void delete(String id);
  }
}
