"""One agent turn: confinement, the call, and the retry loop (DESIGN.md §4.1, §7).

Confinement is fail-closed. The sentinels are the point: the harness refuses to start the turn
if any of the withheld paths is reachable, rather than discovering afterwards that the agent
could read the answer. For this harness the withheld set is unusual — the agent MAY read
application source (the previous checkpoint's; that is the input) but must not reach:

  * the erosion harness's `acceptance/specs` — the experimenter's own tests, i.e. the answer
  * its `checkpoints.yaml` — every future change request
  * this repo's `mutations/` — the patches it is about to be graded against
  * this repo's `reference/` — the patch chain, which is EVERY future checkpoint's code, and the
    least obvious of the four
  * the run directory — other checkpoints' sandboxes and the run's own capture
"""
from __future__ import annotations

import os
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def confine_config(cfg: dict, sandbox: str, landlock, run_dir: str,
                   extra_sentinels=()) -> dict | None:
    """The Landlock config for the turn, or None to run unconfined.

    Unlike the erosion harness, there is no mirror-based fallback here: hiding the answer IS the
    confinement. So an unavailable Landlock is refused rather than warned about, unless the
    operator explicitly asks for it.
    """
    if os.environ.get("FIDELITY_NO_CONFINE"):
        print("    [warn] FIDELITY_NO_CONFINE set — running the agent UNCONFINED. The withheld "
              "paths are reachable; treat this run as a smoke test, not a measurement.",
              flush=True)
        return None
    if landlock.abi_version() < 1:
        raise RuntimeError(
            "Landlock is unavailable on this host. Agent mode withholds the reference specs, "
            "the future requests, the mutation patches and the reference patch chain by "
            "confinement alone, so an unconfined run measures nothing. Set FIDELITY_NO_CONFINE=1 "
            "to override deliberately.")

    home = os.path.expanduser("~")
    ro = ["/usr", "/opt", "/etc"]
    rw = [os.path.join(home, d) for d in (".m2", ".cache", ".npm", ".config")] + ["/tmp"]
    harness = cfg["erosion_harness"]
    sentinels = [os.path.join(harness, "acceptance", "specs"),
                 os.path.join(harness, "checkpoints.yaml"),
                 os.path.join(ROOT, "mutations"),
                 os.path.join(ROOT, "reference"),
                 os.path.join(ROOT, "contracts"),
                 run_dir]
    # Whatever this particular turn must not reach: cpN's materialised tree (the answer, present
    # in `work/` for grading before the turn ever runs), a prompter-proxy's area (which holds cpN
    # on purpose, §4.5), and under write-twice the other author's sandbox. The allowlist already
    # denies all of `work/` — it grants only the sandbox and the toolchain — so these are the
    # fail-closed CHECK on that, in the spirit of §11.1: reasoning about what should be absent is
    # not the same as verifying what is.
    sentinels += [s for s in extra_sentinels
                  if os.path.abspath(s) != os.path.abspath(sandbox)]
    iso = (cfg.get("isolation") or {}).get("agent_confinement") or {}
    return {"enabled": True,
            "ro": ro + list(iso.get("extra_ro_binds", [])),
            "rw": rw + list(iso.get("extra_rw_binds", [])),
            "sentinels": [s for s in sentinels if os.path.exists(s)]}


def run_turn(*, agent, landlock, cfg: dict, sandbox: str, prompt: str, model: str,
             stream_path: str, run_dir: str, rebuild,
             extra_sentinels=()) -> tuple[object, list[dict]]:
    """Run the turn, retrying a usage-limit or transient failure. The sandbox is REBUILT before
    every attempt (`rebuild()`), so a retry starts from the same clean area rather than on top of
    a half-finished one — a partially-edited suite carried into the next attempt would score as
    the agent's work.

    Returns (AgentResult, attempt log). The log keeps every attempt including the failed ones, so
    the true wall clock and cost of a checkpoint — retries and quota waits included — stay
    recoverable rather than collapsing to the winning attempt."""
    limits = cfg.get("limits") or {}
    attempts = transient = 0
    log: list[dict] = []
    while True:
        rebuild()
        ar = agent.run_agent(prompt, cwd=sandbox, model=model,
                             timeout=cfg.get("agent_timeout", 3600),
                             capture_path=stream_path,
                             confine=confine_config(cfg, sandbox, landlock, run_dir,
                                                    extra_sentinels))
        log.append({"ok": ar.ok, "limit_reached": ar.limit_reached,
                    "retryable": ar.retryable, "cost_usd": ar.cost_usd,
                    "num_turns": ar.num_turns, "duration_ms": ar.duration_ms,
                    "duration_api_ms": ar.duration_api_ms,
                    "error": (ar.error or "")[:500]})
        if not (ar.limit_reached or ar.retryable):
            return ar, log
        attempts += 1
        if attempts > limits.get("max_attempts", 500):
            raise RuntimeError("exceeded max agent retry attempts")
        if ar.retryable:
            transient += 1
            if transient > limits.get("max_transient_attempts", 20):
                raise RuntimeError("too many consecutive transient agent failures")
            wait = min(60 * (2 ** (transient - 1)), limits.get("retry_backoff_max", 900))
        else:
            transient = 0
            wait = limits.get("poll_seconds", 1800)
        print(f"    [retry] {'usage limit' if ar.limit_reached else 'transient'} — "
              f"waiting {wait}s then rebuilding the sandbox", flush=True)
        time.sleep(wait)


def result_block(ar, attempts: list[dict]) -> dict:
    return {
        "ok": ar.ok, "cost_usd": ar.cost_usd,
        "input_tokens": ar.input_tokens, "output_tokens": ar.output_tokens,
        "cache_read_tokens": ar.cache_read_tokens,
        "cache_creation_tokens": ar.cache_creation_tokens,
        "num_turns": ar.num_turns, "duration_ms": ar.duration_ms,
        "duration_api_ms": ar.duration_api_ms, "model": ar.model,
        "session_id": ar.session_id, "stop_reason": ar.stop_reason,
        "result_text": ar.result_text, "error": ar.error,
        "attempts": attempts,
    }
