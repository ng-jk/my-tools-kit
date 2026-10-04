"""Shared pipeline use cases; UI and terminal both invoke these release decisions."""
from datetime import datetime, timezone
from pathlib import Path
from .policy import BRANCHES, review_passes, require_tested, require_uat
from ..data.config import read, GATES
from ..data.git import Git
from ..data.store import Store, digest
from ..data.process import run
from ..data.reviewer import review
from .marketplace import MarketplaceRelease


class Pipeline:
    def __init__(self, root, git=None, store=None, runner=run, reviewer=review, progress=None, marketplace=None):
        self.root = Path(root).resolve()
        self.git = git or Git(self.root)
        self.store = store or Store(self.git.common)
        self.config = read(self.root)
        self.runner, self.reviewer = runner, reviewer
        self.progress = progress or (lambda message: None)
        self.marketplace = marketplace or (MarketplaceRelease(self.root, self.config["marketplace"], self.store)
                                           if self.config.get("marketplace") else None)

    def status(self):
        return {"passed": True, "branches": {key: self.git.ref(value) for key, value in BRANCHES.items()},
                "reviewer": self.config["reviewer"], "evidence": str(self.store.root),
                "marketplace": self.config.get("marketplace"),
                "flow": "developement -> test -> human interface UAT -> deployment -> configured Marketplace upload -> main"}

    def marketplace_check(self):
        if not self.marketplace:
            raise ValueError("No marketplace configuration is enabled")
        return self.marketplace.check()

    def init(self):
        with self.store.lock():
            base = self.git.sha("main")
            for branch in BRANCHES.values():
                if not self.git.ref(branch):
                    self.git.update(branch, base)
        return self.status()

    def check(self):
        # Development feedback only: cannot create release or UAT evidence.
        gates = {}
        for name in GATES:
            self.progress("Running " + name)
            for command in self.config["commands"][name]:
                self.runner(command, self.root, timeout=self.config.get("timeout", 900))
            gates[name] = True
        return {"passed": True, "release_evidence": False, "gates": gates}

    def _gates(self, sha, base, stage):
        root = self.store.worktree_path()
        report = {"candidate": sha, "base": base, "configuration": digest(self.config), "stage": stage,
                  "created": datetime.now(timezone.utc).isoformat(), "passed": False, "gates": {}}
        self.git.add_worktree(root, sha)
        try:
            if digest(read(root)) != digest(self.config):
                raise ValueError("Working configuration differs from the committed candidate")
            for name in ("prepare", *GATES):
                self.progress(f"{stage}: running {name} for {sha}")
                for command in self.config["commands"][name]:
                    self.git.verify_candidate(root, sha)
                    self.runner(command, root, timeout=self.config.get("timeout", 900))
                    self.git.verify_candidate(root, sha)
                report["gates"][name] = True
            output = self.store.root / f"review-{stage}-{sha}.json"
            self.progress(f"{stage}: running AI review with {self.config['reviewer']}")
            result = self.reviewer(root, sha, base, self.config["reviewer"], output, self.config.get("timeout", 900))
            report["review"] = result
            report["gates"]["ai_review"] = review_passes(result, sha, base)
            if not report["gates"]["ai_review"]:
                raise ValueError("AI review rejected the candidate or returned invalid evidence")
            # Build/tests must not rewrite tracked source in the pinned checkout.
            self.git.verify_candidate(root, sha)
            report["artifacts"] = self.store.artifacts(root, self.config.get("artifacts", []), stage, sha)
            report["passed"] = True
        except Exception as exc:
            report["error"] = str(exc)
        finally:
            self.store.save(f"{stage}-{sha}.json", report)
            self.git.remove_worktree(root)
        return report

    def test(self, push=False):
        with self.store.lock():
            self.git.clean()
            sha, base = self.git.sha("developement"), self.git.sha("main")
            if not self.git.ancestor(base, sha):
                raise ValueError("Merge main into developement before testing")
            self.git.update("test", sha)
            if push:
                self.git.fetch(self.config["remote"])
                self.git.push(self.config["remote"], "test", sha)
            return self._gates(sha, base, "test")

    def accept_uat(self, candidate, reviewer, note):
        with self.store.lock():
            sha = self.git.sha(candidate)
            report = self.store.load(f"test-{sha}.json")
            require_tested(report, sha, self.git.sha("main"), digest(self.config))
            self.store.verify_artifacts(report, self.config.get("artifacts", []))
            if not reviewer.strip() or not note.strip():
                raise ValueError("Human reviewer and interface UAT notes are required")
            evidence = {"approved": True, "candidate": sha, "test_report": digest(report),
                        "reviewer": reviewer, "note": note, "created": datetime.now(timezone.utc).isoformat()}
            self.store.save(f"uat-{sha}.json", evidence)
            return {"passed": True, **evidence}

    def publish(self):
        with self.store.lock():
            self.git.clean()
            self.git.fetch(self.config["remote"])
            sha, base = self.git.sha("test"), self.git.sha("main")
            if self.git.sha("developement") != sha:
                raise ValueError("developement changed since test; test and accept UAT again")
            remote_main = self.git.remote_ref(self.config["remote"], "main")
            report = self.store.load(f"test-{sha}.json")
            tested_base = report["base"]
            if remote_main not in (base, sha) or base not in (tested_base, sha):
                raise ValueError("Local or remote main changed; reconcile and test again")
            require_tested(report, sha, tested_base, digest(self.config))
            self.store.verify_artifacts(report, self.config.get("artifacts", []))
            require_uat(self.store.load(f"uat-{sha}.json"), sha, digest(report))
            if remote_main == sha:
                # Recover a successful remote push followed by a local update failure.
                require_tested(self.store.load(f"deployment-{sha}.json"), sha, tested_base, digest(self.config))
                if self.git.sha("deployment") != sha or self.git.remote_ref(self.config["remote"], "deployment") != sha:
                    raise ValueError("Deployment refs changed; inspect before recovering publication")
                receipt = self.marketplace.publish(report, allow_upload=False) if self.marketplace else None
                self.git.update("main", sha)
                return {"passed": True, "candidate": sha, "recovered": True, "marketplace": receipt}
            if base != tested_base:
                raise ValueError("Local main advanced before publication; reconcile before continuing")
            if not self.git.ancestor(base, sha):
                raise ValueError("Candidate does not contain main")
            self.git.update("deployment", sha)
            self.git.push(self.config["remote"], "deployment", sha)
            deployment = self._gates(sha, base, "deployment")
            if not deployment["passed"]:
                return deployment
            # Recheck refs after slow tests/review. Never promote a different or stale candidate.
            if (self.git.sha("main") != base or self.git.sha("test") != sha
                    or self.git.sha("developement") != sha or self.git.sha("deployment") != sha
                    or self.git.remote_ref(self.config["remote"], "main") != base
                    or self.git.remote_ref(self.config["remote"], "deployment") != sha):
                raise ValueError("Branch changed during deployment checks; inspect and retest")
            # Push first; a rejected push must never advance local main.
            self.git.ensure_update("main", sha)
            self.store.verify_artifacts(report, self.config.get("artifacts", []))
            receipt = None
            if self.marketplace:
                self.progress("Publishing the UAT-approved VSIX through vsce with Microsoft Entra ID")
                receipt = self.marketplace.publish(report)
                if (self.git.sha("developement") != sha or self.git.sha("test") != sha
                        or self.git.sha("deployment") != sha or self.git.sha("main") != base
                        or self.git.remote_ref(self.config["remote"], "main") != base
                        or self.git.remote_ref(self.config["remote"], "deployment") != sha):
                    raise ValueError("Branch changed during Marketplace upload. Publication receipt retained; inspect refs before retrying")
            self.git.push(self.config["remote"], "main", sha)
            self.git.update("main", sha)
            return {"passed": True, "candidate": sha, "promoted": ["deployment", "main"],
                    "marketplace": receipt,
                    "note": "Marketplace version verified and main promoted." if receipt else "Repository publication complete; no external hosting target is configured."}
