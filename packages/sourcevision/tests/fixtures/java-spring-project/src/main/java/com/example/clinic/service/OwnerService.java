package com.example.clinic.service;

import com.example.clinic.entity.Owner;
import com.example.clinic.entity.Pet;
import com.example.clinic.repository.OwnerRepository;
import com.example.clinic.repository.PetRepository;
import java.util.List;
import java.util.Optional;
import org.springframework.stereotype.Service;

@Service
public class OwnerService {
    private final OwnerRepository owners;
    private final PetRepository pets;

    public OwnerService(OwnerRepository owners, PetRepository pets) {
        this.owners = owners;
        this.pets = pets;
    }

    public List<Owner> search(String prefix) {
        return owners.findByNameStartingWith(prefix);
    }

    public Optional<Owner> find(Long id) {
        return owners.findById(id);
    }

    public Owner register(Owner owner, Pet firstPet) {
        owner.addPet(firstPet);
        pets.save(firstPet);
        return owners.save(owner);
    }
}
