package com.example.clinic.controller;

import com.example.clinic.entity.Owner;
import com.example.clinic.service.OwnerService;
import java.util.List;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/owners")
public class OwnerController {
    private final OwnerService service;

    public OwnerController(OwnerService service) {
        this.service = service;
    }

    @GetMapping
    public List<Owner> search(@RequestParam String name) {
        return service.search(name);
    }

    @GetMapping("/{id}")
    public ResponseEntity<Owner> show(@PathVariable Long id) {
        return service.find(id).map(ResponseEntity::ok).orElse(ResponseEntity.notFound().build());
    }
}
