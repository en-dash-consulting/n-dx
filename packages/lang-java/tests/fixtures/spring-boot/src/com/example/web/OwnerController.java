package com.example.web;

import org.springframework.web.bind.annotation.*;

// Routes: a class prefix, every mapping annotation, arrays, methods, and two paths that are not literals.
@RestController
@RequestMapping("/api")
public class OwnerController {
  static final String PATH = "/constant";

  @GetMapping("/owners")
  public String list() { return ""; }

  // No path: the route is the prefix itself.
  @PostMapping
  public void create() {}

  @PutMapping(value = "/owners/{id}")
  public void replace() {}

  @DeleteMapping(path = "owners/{id}")
  public void remove() {}

  @PatchMapping(path = {"/owners/{id}", "/people/{id}"}, produces = "application/json")
  public void patch() {}

  @RequestMapping(value = "/legacy", method = RequestMethod.GET)
  public String legacy() { return ""; }

  @RequestMapping(path = {"/bulk"}, method = {RequestMethod.PUT, POST})
  public void bulk() {}

  // No method: the route accepts any.
  @RequestMapping("/any")
  public void any() {}

  @GetMapping(PATH)
  public void constant() {}

  @GetMapping(value = {"/kept", PATH + "/dropped"})
  public void partly() {}

  // A parameter annotation is not a mapping of the method.
  public void helper(@PathVariable String id) {
    new Runnable() {
      @GetMapping("/anonymous")
      public void run() {}
    };
  }
}
