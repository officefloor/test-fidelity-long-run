# Sabotage catalogue

A **sabotage** is a stored unified diff against the reference application that breaks exactly one
aspect of one change request's behaviour (DESIGN.md §6). It is the depth oracle: a generated test
suite is credited for each sabotage it turns red.

Authored once by the experimenter and reused by every run — deterministic on purpose. Generating
defects with an LLM per run would make the instrument non-repeatable, and a measuring instrument
that moves is not one.

## Layout

```
sabotage/cp08/manifest.yaml      # the set for checkpoint 08
sabotage/cp08/001-<slug>.patch   # minimal diff vs the reference app at cp08
```

Patches are `git apply`-able at the reference chain's `cpNN reset` commit, so they are tied to
that chain's source. A different stack needs its own catalogue.

## Rules for a usable sabotage

1. **Applies cleanly** at the pinned commit.
2. **Still builds and serves.** A sabotage that breaks the build is killed by every test and
   measures nothing — it scores the compiler, not the suite.
3. **Changes observable behaviour** reachable through the UI or the audit file (the two assertion
   channels the reference specs use).
4. **Minimal and single-aspect.** One sabotage, one claim about the request. "Breaks everything"
   gives a kill a test can earn by accident.
5. **Targets the request, not the code.** Derive each from a clause of the plain-English request,
   so the kill rate reads as "how much of what the user asked for does this suite hold".

## Calibration — before any agent is scored

Run the **experimenter's** reference spec for the checkpoint against every sabotage in its set.
Each must die. One that survives is either a bad sabotage or a real hole in the reference suite;
either way it cannot grade an agent until resolved. Scoring refuses an uncalibrated set.
