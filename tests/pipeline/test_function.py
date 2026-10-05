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

    def test_changed_package_blocks_uat_and_publication(self):
        self.pipeline.config["artifacts"] = ["package.zip"]
        (self.root / "package.zip").write_bytes(b"tested")
        artifacts = self.store.artifacts(self.root, ["package.zip"], "test", "candidate")
        self.report.update(configuration=digest(self.pipeline.config), artifacts=artifacts)
        self.store.save("test-candidate.json", self.report)
        self.uat()
        Path(artifacts[0]["path"]).write_bytes(b"changed")
        with self.assertRaisesRegex(ValueError, "changed"):
            self.uat()
        with self.assertRaisesRegex(ValueError, "changed"):
            self.pipeline.publish()
        self.git.push.assert_not_called()

    def test_marketplace_failure_never_advances_main(self):
        self.uat()
        self.pipeline._gates = Mock(return_value=self.report)
        self.pipeline.marketplace = Mock()
        self.pipeline.marketplace.publish.side_effect = ValueError("upload pending")
        with self.assertRaisesRegex(ValueError, "upload pending"):
            self.pipeline.publish()
        self.assertEqual(self.refs["main"], "base")
        self.git.push.assert_called_once_with("origin", "deployment", "candidate")

    def test_marketplace_success_happens_before_main_push(self):
        self.uat()
        self.pipeline._gates = Mock(return_value=self.report)
        self.pipeline.marketplace = Mock()
        def publish(report):
            self.assertEqual(self.refs["main"], "base")
            self.git.push.assert_called_once_with("origin", "deployment", "candidate")
            return {"state": "verified"}
        self.pipeline.marketplace.publish.side_effect = publish
        result = self.pipeline.publish()
        self.assertEqual(result["marketplace"]["state"], "verified")
        self.assertEqual(self.refs["main"], "candidate")

    def test_successful_remote_main_push_recovers_without_reupload(self):
        self.uat()
        self.refs["deployment"] = "candidate"
        self.git.remote_ref.side_effect = lambda remote, branch: "candidate"
        self.store.save("deployment-candidate.json", self.report)
        self.pipeline.marketplace = Mock()
        self.pipeline.marketplace.publish.return_value = {"state": "verified"}
        self.assertTrue(self.pipeline.publish()["recovered"])
        self.pipeline.marketplace.publish.assert_called_once_with(self.report, allow_upload=False)
        self.assertEqual(self.refs["main"], "candidate")
        self.git.push.assert_not_called()

    def test_branch_change_during_upload_blocks_main(self):
        self.uat()
        self.pipeline._gates = Mock(return_value=self.report)
        self.pipeline.marketplace = Mock()
        def publish(report):
            self.refs["developement"] = "new"
            return {"state": "verified"}
        self.pipeline.marketplace.publish.side_effect = publish
        with self.assertRaisesRegex(ValueError, "Branch changed during Marketplace"):
            self.pipeline.publish()
        self.assertEqual(self.refs["main"], "base")

    def enable_auto_publish(self):
        self.pipeline.config['autoPublishAfterUat'] = True
        self.report['configuration'] = digest(self.pipeline.config)
        self.store.save('test-candidate.json', self.report)

    def test_uat_automatically_publishes_verified_package_before_main(self):
        self.enable_auto_publish()
        self.pipeline._gates = Mock(return_value=self.report)
        self.pipeline.marketplace = Mock()
        def upload(report):
            self.assertTrue(self.store.load('uat-candidate.json')['approved'])
            self.assertEqual(self.refs['main'], 'base')
            return {'state': 'verified'}
        self.pipeline.marketplace.publish.side_effect = upload
        result = self.pipeline.accept_uat('candidate', 'Fixture human', 'Actual fixture acceptance')
        self.assertTrue(result['passed'])
        self.assertEqual(result['publication']['marketplace']['state'], 'verified')
        self.assertEqual(self.refs['main'], 'candidate')
        self.pipeline.marketplace.publish.assert_called_once_with(self.report)

    def test_auto_publish_failed_deployment_preserves_uat_and_stops_main(self):
        self.enable_auto_publish()
        self.pipeline._gates = Mock(return_value={'passed': False, 'error': 'Review unavailable'})
        self.pipeline.marketplace = Mock()
        result = self.pipeline.accept_uat('candidate', 'Fixture human', 'Actual fixture acceptance')
        self.assertFalse(result['passed'])
        self.assertTrue(self.store.load('uat-candidate.json')['approved'])
        self.assertEqual(self.refs['main'], 'base')
        self.pipeline.marketplace.publish.assert_not_called()

    def test_auto_publish_cannot_bypass_missing_test_review(self):
        self.enable_auto_publish()
        self.report['passed'] = False
        self.report['gates']['ai_review'] = False
        self.store.save('test-candidate.json', self.report)
        self.pipeline.publish = Mock()
        with self.assertRaises(ValueError):
            self.pipeline.accept_uat('candidate', 'Fixture human', 'Acceptance')
        self.pipeline.publish.assert_not_called()
        self.assertIsNone(self.store.optional('uat-candidate.json'))

    def test_automatic_publication_rejects_a_different_candidate(self):
        with self.assertRaisesRegex(ValueError, 'Candidate changed'):
            self.pipeline.publish(expected_candidate='previously-approved')
        self.git.push.assert_not_called()

    def test_auto_publish_configuration_requires_boolean(self):
        from cicd.data.config import read
        self.config['autoPublishAfterUat'] = 'false'
        (self.root / '.devkit-pipeline.json').write_text(json.dumps(self.config))
        with self.assertRaisesRegex(ValueError, 'must be a boolean'):
            read(self.root)
