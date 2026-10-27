---
id: "5815a5e0-5d17-42ef-96c3-c517fd6c8894"
type: "change"
title: "Apply alternating section backgrounds and scroll fade-up animations across dashboard views"
slug: "apply-alternating-section-backgrounds"
intent: "Restructure the main dashboard layout (Rex, SourceVision, Hench sections and supporting views) so successive sections alternate between two defined background tones to establish vertical rhythm. Add a scroll-triggered fade-up animation (translateY + opacity transition driven by IntersectionObserver) to section headers and major content blocks, with a graceful no-animation fallback for users with prefers-reduced-motion or browsers lacking IntersectionObserver. Integrate the geometric decoration primitives from the design system task as ambient backgrounds for each section."
acceptanceCriteria:
  - "Adjacent top-level sections in the dashboard render with alternating background tones using the design-token palette"
  - "Section headers and major content blocks fade and translate upward into view on scroll using IntersectionObserver"
  - "Users with prefers-reduced-motion: reduce see content rendered in its final state with no transform/opacity animation"
  - "Each section incorporates at least one decoration from the geometric primitives library (dot grid, arc, thin circle, ruled line, or large numeral) positioned behind content without obscuring readability"
  - "No clip-path blob, gradient splash, organic shape, image, or emoji decoration is introduced anywhere in the redesigned sections"
touches:
  - "3f7f48c7-8681-4dd1-bd4c-59ab7647c87e"
priority: "high"
tags:
  - "web"
  - "ui"
  - "animation"
source: "smart-add"
---
