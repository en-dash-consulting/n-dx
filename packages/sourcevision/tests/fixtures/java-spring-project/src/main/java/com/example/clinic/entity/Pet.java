package com.example.clinic.entity;

import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.ManyToOne;
import java.time.LocalDate;

@Entity
public class Pet {
    @Id
    private Long id;
    private String name;
    private LocalDate birthDate;
    private PetType type;

    @ManyToOne
    private Owner owner;

    public Long getId() { return id; }
    public String getName() { return name; }
    public PetType getType() { return type; }
    public Owner getOwner() { return owner; }
    public void setOwner(Owner owner) { this.owner = owner; }
}
