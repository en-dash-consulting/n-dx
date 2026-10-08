package com.example.clinic.entity;

import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.ManyToOne;
import java.time.LocalDate;

@Entity
public class Visit {
    @Id
    private Long id;
    private LocalDate date;
    private String description;

    @ManyToOne
    private Pet pet;

    public Long getId() { return id; }
    public LocalDate getDate() { return date; }
    public String getDescription() { return description; }
    public Pet getPet() { return pet; }

    public static Visit of(Pet pet, LocalDate date, String description) {
        Visit visit = new Visit();
        visit.pet = pet;
        visit.date = date;
        visit.description = description;
        return visit;
    }
}
