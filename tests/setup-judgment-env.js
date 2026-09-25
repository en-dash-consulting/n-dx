/**
 * Vitest setup: never let a developer's shell opt the test suite into Jev.
 *
 * `resolveJudgmentRoute` treats a non-blank TYPESAFE_API_KEY as the switch
 * that sends classification and finding judgments to TypeSafe. A test that
 * drives the zone pipeline without mocking the client would otherwise make a
 * live request whenever the person running it has the key exported — silently
 * green, silently billed. Tests that need the route set it with `vi.stubEnv`.
 */
delete process.env.TYPESAFE_API_KEY;
