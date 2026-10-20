package com.example.clinic.repository;

import com.example.clinic.entity.Pet;
import com.example.clinic.entity.PetType;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface PetRepository extends JpaRepository<Pet, Long> {
    List<Pet> findByType(PetType type);
}
