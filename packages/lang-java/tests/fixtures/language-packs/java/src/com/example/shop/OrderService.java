package com.example.shop;

import java.util.List;
import java.util.Map;
import java.util.function.*;
import static java.util.stream.Collectors.toList;
import static java.lang.Math.*;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

@Service
public class OrderService extends BaseService<Order> implements Auditable, java.io.Serializable {

  @Autowired
  private OrderRepository repository;

  private final Map<String, List<Order>> byCustomer = new java.util.HashMap<>();

  public OrderService(OrderRepository repository, Clock... clocks) {
    this.repository = repository;
  }

  public List<Order> open(@NonNull String customer) throws NotFoundException {
    logger.info("loading open orders");
    List<Order> found = repository.findByStatus(Status.OPEN);
    return found.stream().filter(o -> o.isFor(customer)).collect(toList());
  }

  public <T extends Comparable<T>> T largest(List<? extends T> items, Function<T, String> label) {
    log(label.apply(items.get(0)), "fixed");
    return max(items);
  }

  String banner() {
    return """
        Orders
          "quoted" text
        """;
  }

  void nested(Order order) {
    helper(inner("deep", other("x")), "y");
    Runnable r = () -> System.out.println("tick");
    log("""
        in a call
        """);
    Object o = new Inner();
    r.run();
  }

  class Inner {
    int count;

    Inner() {}
  }

  static class Holder<T> {
    T value;

    T get() {
      return value;
    }
  }
}
