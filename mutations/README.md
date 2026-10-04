# Mutation catalogue

A **mutation** is a stored unified diff against the reference application that breaks exactly one
aspect of one change request's behaviour (DESIGN.md §6). It is the depth oracle: a generated suite
is credited for each mutation it turns red.

> A **mutative checkpoint** is a different thing — `checkpoints.yaml`'s term for a change request
> that revises earlier behaviour. "Mutation", "mutant" and "kill rate" here are mutation testing
> in the usual sense.

Authored once by the experimenter and reused by every run. Deterministic on purpose: generating
defects with an LLM per run would make the instrument non-repeatable, and a measuring instrument
that moves is not one.

## Layout

```
mutations/cp08/manifest.yaml      the set for checkpoint 08
mutations/cp08/001-<slug>.patch   minimal diff vs the reference app at cp08
```

Patches apply to the application as `tools/reference.py materialise --checkpoint N` builds it, so
they are tied to the reference chain's source. A different stack needs its own catalogue — that is
the main cost of adding one.

**Mutation zero is not in here.** The application at N-1 is the whole-feature mutation and comes
free from the patch chain (DESIGN.md §5). This catalogue is only for depth: the aspects of a
request that survive the feature being present but wrong.

## Rules for a usable mutation

1. **Applies cleanly** at the materialised checkpoint.
2. **Still builds and serves.** One that breaks the build is killed by every test and measures
   nothing — it scores the compiler, not the suite.
3. **Changes observable behaviour** through the UI or the audit file — the two channels the
   contract declares (DESIGN.md §3).
4. **Minimal and single-aspect.** "Breaks everything" gives a kill a test can earn by accident.
5. **Derived from a clause of the English request**, so kill rate reads as "how much of what the
   user asked for does this suite hold" rather than "how much of this codebase does it touch".

## Calibration — before any agent is graded

Run the **experimenter's** reference spec for the checkpoint against every mutation in its set.
Each must die. One that survives is either a bad mutation or a real hole in the reference suite;
either way it cannot grade an agent until resolved. Grading refuses an uncalibrated set.

## Checkpoints with no code

cp40 and cp50 changed no code in the reference chain (DESIGN.md §2), so they have no behaviour to
mutate and get no set. They are excluded from the mutation oracle, not scored zero.
