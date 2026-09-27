import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock
from cicd.data.git import Git
from cicd.data.process import CommandError
from cicd.logic.policy import review_passes, require_tested, require_uat
from cicd.data.store import Store
from scripts.architecture import violations


class PolicyTests(unittest.TestCase):
    def test_authentication_retries_three_times(self):
        git = Git.__new__(Git)
        git.attempts = []
        git.call = Mock(return_value={"code": 128, "stdout": "", "stderr": "Authentication failed"})
        with self.assertRaises(CommandError):
            git.network(["fetch", "origin"])
        self.assertEqual(git.call.call_count, 3)
        self.assertEqual(len(git.attempts), 3)

    def test_uncertain_successful_push_is_not_repeated(self):
        git = Git.__new__(Git)
        git.attempts = []
        git.remote_ref = Mock(side_effect=["old", "new"])
        git.ancestor = Mock(return_value=True)
        git.call = Mock(return_value={"code": 128, "stdout": "", "stderr": "Connection lost"})
        git.push("origin", "test", "new")
        git.call.assert_called_once()

    def test_review_fails_closed(self):
        good = dict(approved=True, candidate="a", base="b", summary="Reviewed diff", findings=[])
        self.assertTrue(review_passes(good, "a", "b"))
        for change in ({"approved": False}, {"candidate": "other"}, {"base": "other"}, {"summary": ""},
                       {"findings": [{"severity": "high", "message": "Broken"}]}, {"findings": None}):
            self.assertFalse(review_passes({**good, **change}, "a", "b"))

    def test_test_and_uat_must_match(self):
        gates = dict.fromkeys(("architecture", "unit", "function", "integration", "ai_review", "build"), True)
        report = dict(passed=True, candidate="a", base="b", configuration="c", gates=gates)
        require_tested(report, "a", "b", "c")
        for key in gates:
            with self.assertRaises(ValueError):
                require_tested({**report, "gates": {**gates, key: False}}, "a", "b", "c")
        with self.assertRaises(ValueError):
            require_tested(report, "other", "b", "c")
        with self.assertRaises(ValueError):
            require_uat(dict(approved=True, candidate="a", test_report="old", reviewer="human", note="UI passed"), "a", "new")

    def test_evidence_tampering_and_lock(self):
        with tempfile.TemporaryDirectory() as directory:
            store = Store(directory)
            store.save("test.json", {"passed": False})
            self.assertFalse(store.load("test.json")["passed"])
            path = store.root / "test.json"
            value = json.loads(path.read_text())
            value["payload"]["passed"] = True
            path.write_text(json.dumps(value))
            with self.assertRaises(ValueError):
                store.load("test.json")
            with store.lock():
                with self.assertRaises(ValueError):
                    with store.lock():
                        pass

    def test_architecture_catches_ui_dependencies(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            folder = root / "src/logic"
            folder.mkdir(parents=True)
            (folder / "bad.js").write_text("const ui = require('vscode');")
            self.assertTrue(violations(root))
            (folder / "bad.js").write_text("const io = require('../data/files');")
            self.assertEqual(violations(root), [])
