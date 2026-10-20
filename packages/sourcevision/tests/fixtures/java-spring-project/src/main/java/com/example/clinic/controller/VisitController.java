package com.example.clinic.controller;

import com.example.clinic.entity.Visit;
import com.example.clinic.service.VisitService;
import java.time.LocalDate;
import java.util.List;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/pets/{petId}/visits")
public class VisitController {
    private final VisitService service;

    public VisitController(VisitService service) {
        this.service = service;
    }

    @GetMapping
    public List<Visit> history(@PathVariable Long petId) {
        return service.history(petId);
    }

    @PostMapping
    public Visit book(@PathVariable Long petId, @RequestParam String description) {
        return service.book(petId, LocalDate.now(), description);
    }
}
