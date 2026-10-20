package com.example.app;

// Single-type import, and a nested type of the same file.
import com.example.model.Customer;
import com.example.model.Customer.Address;
// Shadows com.example.app.Clock in this package.
import com.example.time.Clock;
// Wildcard: Strings is referenced, Unused is not, and Cart loses to com.example.app.Cart.
import com.example.util.*;
import static com.example.util.Numbers.round;
import static com.example.util.Constants.*;
import java.util.List;
import javax.inject.*;
import org.acme.Missing;

public class Checkout {
  private Customer customer;
  private Address address;
  private Clock clock;
  private Cart cart;
  private Receipt receipt;
  private List<Strings> names;
  private com.example.model.Customer again;
  private java.time.Instant at;
  private Line line;

  int total() {
    Status status = Status.OPEN;
    return round(Tax.rate()) + MAX;
  }

  class Line {}
}
