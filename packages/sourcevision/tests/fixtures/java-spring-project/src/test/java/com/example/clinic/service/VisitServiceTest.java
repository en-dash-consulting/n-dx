package com.example.clinic.service;

import static org.junit.jupiter.api.Assertions.assertEquals;

import com.example.clinic.entity.Visit;
import java.time.LocalDate;
import org.junit.jupiter.api.Test;

class VisitServiceTest {
    @Test
    void visitKeepsItsDescription() {
        Visit visit = Visit.of(null, LocalDate.of(2026, 1, 1), "checkup");
        assertEquals("checkup", visit.getDescription());
    }
}
