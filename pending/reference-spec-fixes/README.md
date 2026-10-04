# Held: four reference-spec fixes

Four mutations were left out of the catalogue because the experimenter's own spec had nothing
that would catch them (`mutations/README.md` records them as reference-suite holes). Each is a
gap in the fixture rather than a bad mutation.

| checkpoint | the hole | what the fix adds |
| --- | --- | --- |
| cp03 | no project row count asserted | seeds two projects, asserts the count and the second row |
| cp21 | a line's own qty / unit price / amount never asserted | asserts all three, so an amount that ignores quantity is catchable |
| cp26 | the audit channel is never read | asserts `PROJECT_TAGGED` and `PROJECT_UNTAGGED` |
| cp55 | only three owing clients seeded | seeds six, asserts the list caps at five |

## Why this is held rather than applied

These specs are **installed by a replay at every checkpoint from their own onward**, and the
mutations are **read by the driver per checkpoint**. Applying either mid-run shifts the test-id
set partway through — the suite appears to grow for no reason, new assertions read as fixture
defects, and the affected mutation sets get marked uncalibrated.

`apply.py` refuses while a run is in flight for exactly that reason.

## Applying

```sh
.venv/bin/python pending/reference-spec-fixes/apply.py --check   # show, change nothing
.venv/bin/python pending/reference-spec-fixes/apply.py
.venv/bin/python tools/mutate.py validate
```

The mutations' find/replace are resolved against the real source at apply time, not transcribed,
so an anchor that has moved fails loudly rather than silently matching nothing.

Afterwards the four changed sets are `calibrated: false` and need a replay with `--calibrate` —
and the spec changes themselves want one too, since they are new assertions that have never run.

Delete this directory once applied.
