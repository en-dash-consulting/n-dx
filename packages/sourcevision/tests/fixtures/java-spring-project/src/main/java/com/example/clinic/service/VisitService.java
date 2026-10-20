package com.example.clinic.service;

import com.example.clinic.entity.Pet;
import com.example.clinic.entity.Visit;
import com.example.clinic.repository.PetRepository;
import com.example.clinic.repository.VisitRepository;
import java.time.LocalDate;
import java.util.List;
import org.springframework.stereotype.Service;

@Service
public class VisitService {
    private final VisitRepository visits;
    private final PetRepository pets;

    public VisitService(VisitRepository visits, PetRepository pets) {
        this.visits = visits;
        this.pets = pets;
    }

    public List<Visit> history(Long petId) {
        return visits.findByPetId(petId);
    }

    public Visit book(Long petId, LocalDate date, String description) {
        Pet pet = pets.findById(petId).orElseThrow();
        return visits.save(Visit.of(pet, date, description));
    }
}
