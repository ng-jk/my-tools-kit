import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock
from cicd.logic.pipeline import Pipeline
from cicd.data.store import Store, digest


class PromotionTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.config = {"version": 1, "remote": "origin", "reviewer": "codex", "commands": {
            group: [["fixture"]] for group in ("prepare", "architecture", "unit", "function", "integration", "build")}}
        (self.root / ".devkit-pipeline.json").write_text(json.dumps(self.config))
        self.git = Mock()
        self.git.common = self.root
        self.refs = {"main": "base", "developement": "candidate", "test": "candidate", "deployment": "base"}
        self.git.sha.side_effect = lambda ref: self.refs.get(ref, ref)
        self.git.remote_ref.side_effect = lambda remote, branch: self.refs[branch]
        self.git.update.side_effect = lambda branch, sha: self.refs.update({branch: sha})
        self.git.ancestor.return_value = True
        self.store = Store(self.root)
        self.pipeline = Pipeline(self.root, git=self.git, store=self.store)
        self.report = {"passed": True, "candidate": "candidate", "base": "base", "configuration": digest(self.config),
                       "gates": dict.fromkeys(("architecture", "unit", "function", "integration", "ai_review", "build"), True)}
        self.store.save("test-candidate.json", self.report)

    def uat(self):
        self.pipeline.accept_uat("candidate", "Human tester", "Tested UI")

    def test_missing_uat_prevents_deployment(self):
        with self.assertRaises(ValueError):
            self.pipeline.publish()
        self.git.push.assert_not_called()

    def test_failed_deployment_never_advances_main(self):
        self.uat()
        self.pipeline._gates = Mock(return_value={"passed": False})
        self.assertFalse(self.pipeline.publish()["passed"])
        self.assertEqual(self.refs["main"], "base")
        self.git.push.assert_called_once_with("origin", "deployment", "candidate")

    def test_success_promotes_same_commit(self):
        self.uat()
        self.pipeline._gates = Mock(return_value=self.report)
        self.assertTrue(self.pipeline.publish()["passed"])
        self.assertEqual(self.refs["main"], "candidate")
        self.assertEqual(self.git.push.call_args_list[-1].args, ("origin", "main", "candidate"))

    def test_changed_development_invalidates_uat(self):
        self.uat()
        self.refs["developement"] = "new"
        with self.assertRaises(ValueError):
            self.pipeline.publish()
        self.git.push.assert_not_called()

    def test_retest_invalidates_old_uat(self):
        self.uat()
        self.store.save("test-candidate.json", {**self.report, "created": "different-run"})
        with self.assertRaises(ValueError):
            self.pipeline.publish()
        self.git.push.assert_not_called()

    def test_failed_push_leaves_local_main(self):
        self.uat()
        self.pipeline._gates = Mock(return_value=self.report)
        def push(remote, branch, sha):
            if branch == "main":
                raise RuntimeError("push rejected")
        self.git.push.side_effect = push
        with self.assertRaises(RuntimeError):
            self.pipeline.publish()
        self.assertEqual(self.refs["main"], "base")
