package com.example.web;

import org.springframework.stereotype.Service;
import org.springframework.web.bind.annotation.GetMapping;

// Not a controller: no routes, whatever its methods carry.
@Service
public class ReportService {
  @GetMapping("/reports")
  public String reports() { return ""; }
}
