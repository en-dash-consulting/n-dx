package com.example.shop;

import java.io.Serializable;

public interface Types {

  interface Named extends Serializable, Comparable<Named> {
    String name();
  }

  enum Status implements Named {
    OPEN,
    CLOSED {
      @Override
      public String label() {
        return "closed";
      }
    };

    public String label() {
      return name().toLowerCase();
    }
  }

  record Money(long cents, String currency) implements Serializable {
    public Money {
      if (cents < 0) throw new IllegalArgumentException("negative");
    }

    static Money of(long cents) {
      return new Money(cents, "USD");
    }
  }

  @interface Audited {
    String value() default "none";
  }

  @Audited("types")
  @Deprecated
  abstract class Base<T extends Number> {
    abstract T convert(Object source);
  }
}
