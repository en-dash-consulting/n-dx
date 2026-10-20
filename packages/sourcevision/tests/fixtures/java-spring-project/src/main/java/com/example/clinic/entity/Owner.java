package com.example.clinic.entity;

import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.OneToMany;
import java.util.ArrayList;
import java.util.List;

@Entity
public class Owner {
    @Id
    private Long id;
    private String name;

    @OneToMany(mappedBy = "owner")
    private List<Pet> pets = new ArrayList<>();

    public Long getId() { return id; }
    public String getName() { return name; }
    public void setName(String name) { this.name = name; }
    public List<Pet> getPets() { return pets; }

    public void addPet(Pet pet) {
        pets.add(pet);
        pet.setOwner(this);
    }
}
