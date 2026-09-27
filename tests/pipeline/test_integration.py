import json
from pathlib import Path
import sys
import tempfile
import unittest
from cicd.data.git import Git
from cicd.data.process import run
from cicd.logic.pipeline import Pipeline


class LocalRepositoryTests(unittest.TestCase):
    def test_real_git_worktrees_and_release_to_bare_remote(self):
        # Isolated local fixtures only; never touches the project's actual remote or AI account.
        with tempfile.TemporaryDirectory() as directory:
            top = Path(directory)
            remote, root = top / "origin.git", top / "project"
            run(["git", "init", "--bare", str(remote)], top)
            root.mkdir()
            run(["git", "init", "-b", "main"], root)
            run(["git", "config", "user.name", "Pipeline Test"], root)
            run(["git", "config", "user.email", "pipeline@example.invalid"], root)
            config = {"version": 1, "remote": "origin", "reviewer": "codex", "commands": {
                group: [["{python}", "-c", "print('fixture check passed')"]]
                for group in ("prepare", "architecture", "unit", "function", "integration", "build")}}
            (root / ".devkit-pipeline.json").write_text(json.dumps(config))
            (root / "data.txt").write_text("before")
            run(["git", "add", "."], root)
            run(["git", "commit", "-m", "baseline"], root)
            run(["git", "remote", "add", "origin", str(remote)], root)
            run(["git", "push", "origin", "main"], root)
            run(["git", "switch", "-c", "developement"], root)
            (root / "data.txt").write_text("after")
            run(["git", "commit", "-am", "candidate"], root)
            def reviewer(worktree, sha, base, provider, output, timeout):
                self.assertEqual((worktree / "data.txt").read_text(), "after")
                return dict(approved=True, candidate=sha, base=base, summary="Fixture reviewer", findings=[])
            pipeline = Pipeline(root, reviewer=reviewer)
            pipeline.init()
            original = pipeline.git.sha("main")
            result = pipeline.test(push=True)
            self.assertTrue(result["passed"], result)
            self.assertEqual(pipeline.git.sha("main"), original)
            with self.assertRaises(ValueError):
                pipeline.publish()
            pipeline.accept_uat(result["candidate"], "Fixture human", "Fixture UI acceptance")
            published = pipeline.publish()
            self.assertTrue(published["passed"])
            self.assertEqual(pipeline.git.remote_ref("origin", "main"), result["candidate"])
            self.assertEqual(pipeline.git.call("branch", "--show-current").strip(), "developement")
            self.assertEqual(pipeline.git.call("status", "--porcelain").strip(), "")
            self.assertEqual(list((pipeline.store.root / "worktrees").iterdir()), [])

    def test_clean_checkout_of_wrong_commit_fails_candidate_guard(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            run(["git", "init", "-b", "main"], root)
            run(["git", "config", "user.name", "Test"], root)
            run(["git", "config", "user.email", "test@example.invalid"], root)
            config = {"version": 1, "remote": "origin", "reviewer": "codex", "commands": {
                group: [["{python}", "-c", "print('fixture')"]]
                for group in ("prepare", "architecture", "unit", "function", "integration", "build")}}
            # This gate changes HEAD but leaves a perfectly clean working tree.
            config["commands"]["unit"] = [["git", "checkout", "--detach", "HEAD~1"]]
            (root / ".devkit-pipeline.json").write_text(json.dumps(config))
            (root / "sample").write_text("old")
            run(["git", "add", "."], root)
            run(["git", "commit", "-m", "base"], root)
            run(["git", "switch", "-c", "developement"], root)
            (root / "sample").write_text("new")
            run(["git", "commit", "-am", "candidate"], root)
            pipeline = Pipeline(root)
            pipeline.init()
            result = pipeline.test()
            self.assertFalse(result["passed"])
            self.assertIn("changed worktree HEAD", result["error"])
            self.assertNotIn("ai_review", result["gates"])

    def test_cli_failure_has_nonzero_and_json(self):
        root = Path(__file__).resolve().parents[2]
        with tempfile.TemporaryDirectory() as directory:
            result = run([sys.executable, str(root / "pipeline.py"), "--root", directory, "status"], root, check=False)
            self.assertEqual(result["code"], 1)
            self.assertFalse(json.loads(result["stderr"])["passed"])
