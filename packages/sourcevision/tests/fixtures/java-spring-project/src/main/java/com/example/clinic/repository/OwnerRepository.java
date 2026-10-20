package com.example.clinic.repository;

import com.example.clinic.entity.Owner;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface OwnerRepository extends JpaRepository<Owner, Long> {
    List<Owner> findByNameStartingWith(String prefix);
}
