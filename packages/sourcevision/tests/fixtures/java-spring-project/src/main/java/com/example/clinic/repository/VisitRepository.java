package com.example.clinic.repository;

import com.example.clinic.entity.Visit;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface VisitRepository extends JpaRepository<Visit, Long> {
    List<Visit> findByPetId(Long petId);
}
