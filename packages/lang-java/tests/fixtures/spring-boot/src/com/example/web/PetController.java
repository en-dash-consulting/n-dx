package com.example.web;

import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;

// Two class prefixes, one with a trailing slash and one without a leading slash: one slash between prefix and path.
@Controller
@RequestMapping({"/pets/", "animals"})
class PetController {
  @GetMapping("/{petId}")
  String show() { return "pets/show"; }

  // Not a controller: a nested class's mappings are its own, and it has no controller annotation.
  static class Helper {
    @GetMapping("/helper")
    void helper() {}
  }
}
