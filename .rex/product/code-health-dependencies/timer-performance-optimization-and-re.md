---
id: "10c4bdde-3d18-42f7-9718-3cba99d8f6b1"
type: "capability"
title: "Timer Performance Optimization and Re-render Reduction"
slug: "timer-performance-optimization-and-re"
statement: "The dashboard runs its timers through a shared timer service and keeps component re-renders from frequent timer updates to a minimum."
criteria: [{"id":"c1","text":"Components that need periodic timer updates shall subscribe to one shared timer service instead of each running its own timer."},{"id":"c2","text":"The shared timer service shall coordinate timer updates across its subscribing components."},{"id":"c3","text":"When timer updates arrive together, the system shall batch them so that subscribing components re-render once per batch instead of once per update."},{"id":"c4","text":"When a timer update leaves a component's inputs unchanged, the system shall skip that component's re-render through memoization."}]
source: "smart-add"
---
