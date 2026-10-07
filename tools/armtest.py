"""Drive all four §4.4 arms with a stub agent: turn sequence, areas, enforcement, record shape,
and — because the stub records the confine dict it is handed — the sentinels per turn."""
import os, sys, shutil, types, json
sys.path.insert(0, "."); sys.path.insert(0, "tools")
import reference as refmod
from fidelity import conditions as cond, sandbox as sb, capture

S = sys.argv[1]; WORK = f"{S}/work"; OUT = f"{S}/out"
shutil.rmtree(WORK, ignore_errors=True); shutil.rmtree(OUT, ignore_errors=True)
os.makedirs(OUT, exist_ok=True); os.makedirs(WORK, exist_ok=True)
N = 12
SPECS_REL = "e2e/specs"

class AR:
    def __init__(self, text, ok=True):
        self.ok, self.result_text, self.error = ok, text, None
        self.limit_reached = self.retryable = False
        self.cost_usd, self.num_turns = 0.01, 3
        self.duration_ms = self.duration_api_ms = 100
        self.input_tokens = self.output_tokens = 10
        self.cache_read_tokens = self.cache_creation_tokens = 0
        self.model, self.session_id, self.stop_reason = "stub", "s", None

CALLS = []
class StubAgent:
    def run_agent(self, prompt, cwd, model, timeout, capture_path, confine):
        head = prompt.strip().splitlines()[0][:52]
        CALLS.append({"cwd": cwd, "head": head,
                      "sentinels": list((confine or {}).get("sentinels", []))})
        open(capture_path, "w").write('{"stub": true}\n')
        specs = os.path.join(cwd, SPECS_REL)
        if "REVIEWING a draft" in prompt:
            # a reviewer that disobeys: it edits. The arm must revert and report it.
            os.makedirs(specs, exist_ok=True)
            open(os.path.join(specs, "sneaky.spec.ts"), "w").write("// reviewer wrote this\n")
            return AR("1. Nothing asserts the archived case.")
        if "may ask up to" in prompt:
            os.makedirs(specs, exist_ok=True)
            open(os.path.join(specs, "early.spec.ts"), "w").write("// asked-turn draft\n")
            return AR("Q: Should an archived client stay out of the default list?\nQ: (none)")
        if "You are the person who asked" in prompt and "THE QUESTIONS" in prompt:
            return AR("A1: Yes — archived clients stay out. The archive-confirm-dialog "
                      "should appear first.")
        if "You are the person who asked" in prompt:
            return AR("You would not catch an archived client reappearing. "
                      "Also expect(x).toBe(3) on the count.")
        # any authoring/revising/reconciling turn writes a spec
        os.makedirs(specs, exist_ok=True)
        tag = ("reconcile" if "Two people were given" else "author")
        open(os.path.join(specs, "written.spec.ts"), "w").write(f"// {head}\n")
        return AR("done")

args = types.SimpleNamespace(code_view="previous", model="stub", condition=None, mode="agent")
cfg = {"erosion_harness": os.path.expanduser("~/ui-long-degradation-test"),
       "model": "stub", "agent_timeout": 60, "limits": {},
       "conditions": {"clarify_oracle": {"question_budget": 3}}}
landlock = types.SimpleNamespace(abi_version=lambda: 1)

app = f"{WORK}/cp{N:02d}-view"; refmod.materialise(N - 1, app)
gate = f"{WORK}/cp{N:02d}"; refmod.materialise(N, gate)

def fresh_suite():
    repo = f"{WORK}/suite"
    shutil.rmtree(repo, ignore_errors=True)
    sb.init_suite_repo(repo, "agent/armtest/x/chain1")
    open(os.path.join(repo, "prior.spec.ts"), "w").write("// prior\n")
    sb.commit_suite(repo, "prior")
    return repo

FAILED = []
def check(label, got, want):
    ok = got == want
    if not ok: FAILED.append(label)
    print(f"  {'PASS' if ok else 'FAIL'}  {label}: {got!r}" + ("" if ok else f" != {want!r}"))

for arm in ("blind-ai-review", "clarify-oracle", "prompter-proxy-review", "write-twice"):
    CALLS.clear()
    args.condition = arm
    suite_repo = fresh_suite()
    sandbox = f"{WORK}/cp{N:02d}-sandbox"
    def rebuild(sandbox=sandbox, suite_repo=suite_repo):
        sb.build_sandbox(sandbox=sandbox, app_tree=app, suite_repo=suite_repo,
                         specs_rel=SPECS_REL)
    rebuild()
    ctx = cond.Ctx(n=N, cp_id=f"cp{N}_x", request="Let me archive a client.",
                   contract={"available_testids": ["clients-table"], "new_testids": []},
                   fields=["new_testids", "available_testids"], args=args, cfg=cfg,
                   agent=StubAgent(), landlock=landlock, out_dir=OUT, work=WORK,
                   suite_repo=suite_repo, specs_rel=SPECS_REL, app_pristine=app,
                   sandbox_dir=sandbox, rebuild=rebuild, materialise=refmod.materialise,
                   spec_files_now=["prior.spec.ts"], total_tests=1,
                   log=lambda m: None, gate_tree=gate)
    print(f"\n=== {arm} ===")
    res = cond.ARMS[arm](ctx)
    names = [t["turn"] for t in res["turns"]]
    print(f"  turns: {names}")
    final = res.get("sandbox", ctx.sandbox_dir)
    ex = res["exchanges"]

    if arm == "blind-ai-review":
        check("turn sequence", names, ["author", "review", "revise"])
        check("reviewer's edit reverted+reported", ex["reviewer_edited"], ["sneaky.spec.ts"])
        check("sneaky file gone", os.path.exists(f"{final}/{SPECS_REL}/sneaky.spec.ts"), False)
        check("critique recorded", ex["critique"].startswith("1. Nothing asserts"), True)
    if arm == "clarify-oracle":
        check("turn sequence", names, ["questions", "oracle", "author"])
        check("budget spent", ex["budget_spent"], 1)
        check("'(none)' not counted as a question", len(ex["questions"]), 1)
        check("question turn's draft reverted", ex["asker_edited"], ["early.spec.ts"])
        check("oracle leak CAUGHT (unpublished anchor)",
              any("archive-confirm-dialog" in h for h in ex["leak_hits"]), True)
        from fidelity.conditions import proxy_leak_scan
        check("a PUBLISHED anchor is not a leak",
              proxy_leak_scan("clients-table shows none.",
                              {"available_testids": ["clients-table"]}), [])
    if arm == "prompter-proxy-review":
        check("turn sequence", names, ["author", "prompter", "revise"])
        check("proxy leak CAUGHT", any("assertion" in h for h in ex["leak_hits"]), True)
        parea = f"{WORK}/cp{N:02d}-prompter"
        check("proxy area has cpN app", os.path.isdir(f"{parea}/src/main/java"), True)
        check("proxy area has NO .git", os.path.isdir(f"{parea}/.git"), False)
        check("proxy area has NO reference specs",
              os.path.exists(f"{parea}/e2e/specs"), False)
        check("proxy got the whole draft suite to read",
              sorted(os.listdir(f"{parea}/draft-suite")),
              ["prior.spec.ts", "written.spec.ts"])
    if arm == "write-twice":
        check("turn sequence", names, ["author-a", "author-b", "reconcile"])
        check("graded sandbox is A", final.endswith("-sandbox-a"), True)
        check("B's draft outside specs_rel",
              os.path.exists(f"{final}/second-draft/written.spec.ts"), True)
        check("B's draft NOT in the graded specs",
              os.path.exists(f"{final}/{SPECS_REL}/second-draft"), False)

    # the sentinel assertion: no turn may be handed its own area, and every turn must be
    # told about cpN's grading tree
    for c in CALLS:
        if os.path.abspath(c["cwd"]) == os.path.abspath(gate):
            continue
        if any(os.path.abspath(s) == os.path.abspath(c["cwd"]) for s in c["sentinels"]):
            FAILED.append(f"{arm}: a turn was handed its own area as a sentinel")
    cpn_withheld = all(any(os.path.abspath(s) == os.path.abspath(gate) for s in c["sentinels"])
                       for c in CALLS)
    check("cpN grading tree withheld from every turn", cpn_withheld, True)
    # the proxy's own area holds cpN, so the AUTHOR turns must have it withheld
    author_calls = [c for c in CALLS if "-prompter" not in c["cwd"] and "-oracle" not in c["cwd"]]
    parea = os.path.abspath(f"{WORK}/cp{N:02d}-prompter")
    if arm == "prompter-proxy-review":
        later = author_calls[-1]
        check("proxy area withheld from the revising author",
              any(os.path.abspath(s) == parea for s in later["sentinels"]), True)
    if arm == "write-twice":
        b = os.path.abspath(f"{WORK}/cp{N:02d}-sandbox-b")
        rec = [c for c in CALLS if c["head"].startswith("Two people")]
        check("B's sandbox withheld from the reconciler",
              any(os.path.abspath(s) == b for s in rec[0]["sentinels"]) if rec else False, True)
    # copy_back takes only the graded specs
    moved = sb.copy_back(sandbox=final, suite_repo=suite_repo, specs_rel=SPECS_REL)
    check("copy_back result", moved["present"], ["prior.spec.ts", "written.spec.ts"])

print("\n" + ("ALL PASS" if not FAILED else f"FAILURES: {FAILED}"))
sys.exit(1 if FAILED else 0)
