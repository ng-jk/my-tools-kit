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


class UiUxPromotionTests(PromotionTests):
    def ai_mode(self):
        from cicd.data.reviewer import UX_CRITERIA
        self.pipeline.config["interfaceReview"] = "ai-ux"
        self.report["configuration"] = digest(self.pipeline.config)
        self.report["gates"]["ui_ux_review"] = True
        self.report["ui_ux_review"] = {"approved":True,"candidate":"candidate","base":"base",
            "summary":"Fixture source review", "findings":[], "limitations":"No rendered UI or human testing",
            "criteria":{name:{"status":"pass","evidence":["media/index.html:10"],"rationale":"Fixture inspected"} for name in UX_CRITERIA}}
        self.store.save("test-candidate.json",self.report)

    def test_ai_mode_publishes_without_human_record(self):
        self.ai_mode()
        self.pipeline._gates=Mock(return_value=self.report)
        self.assertTrue(self.pipeline.publish()["passed"])
        self.assertIsNone(self.store.optional("uat-candidate.json"))
        self.assertEqual(self.refs["main"],"candidate")

    def test_ai_mode_rejects_legacy_acceptance_command(self):
        self.ai_mode()
        with self.assertRaisesRegex(ValueError,"automated UI/UX"):
            self.pipeline.accept_uat("candidate","Fake human","No testing")

    def test_missing_failed_stale_or_unsupported_ux_blocks_publish(self):
        import copy
        self.ai_mode();good=copy.deepcopy(self.report)
        for change in ("missing","failure","stale","evidence","coverage","limitations"):
            report=copy.deepcopy(good)
            if change=="missing":report.pop("ui_ux_review")
            if change=="failure":report["ui_ux_review"]["criteria"]["task_flow"]["status"]="fail"
            if change=="stale":report["ui_ux_review"]["candidate"]="old"
            if change=="evidence":report["ui_ux_review"]["criteria"]["task_flow"]["evidence"]=[]
            if change=="coverage":report["ui_ux_review"]["criteria"].pop("accessibility")
            if change=="limitations":report["ui_ux_review"].pop("limitations")
            self.store.save("test-candidate.json",report)
            with self.subTest(change=change),self.assertRaises(ValueError):self.pipeline.publish()
            self.git.push.assert_not_called()

    def test_release_stops_after_failed_test(self):
        self.pipeline.test=Mock(return_value={"passed":False})
        self.pipeline.publish=Mock()
        self.assertFalse(self.pipeline.release()["passed"])
        self.pipeline.publish.assert_not_called()

    def test_release_pins_successful_test_candidate(self):
        self.pipeline.test=Mock(return_value={"passed":True,"candidate":"candidate"})
        self.pipeline.publish=Mock(return_value={"passed":True})
        self.assertTrue(self.pipeline.release()["passed"])
        self.pipeline.test.assert_called_once_with(push=True)
        self.pipeline.publish.assert_called_once_with(expected_candidate="candidate")

    def test_gate_runs_separate_review_and_records_failures(self):
        from unittest.mock import patch
        self.ai_mode()
        good=self.report["ui_ux_review"]
        self.pipeline.runner=Mock()
        self.pipeline.reviewer=Mock(return_value={"approved":True,"candidate":"candidate","base":"base","summary":"Technical fixture","findings":[]})
        self.pipeline.ux_reviewer=Mock(return_value=good)
        with patch("cicd.logic.pipeline.read",return_value=self.pipeline.config):
            result=self.pipeline._gates("candidate","base","test")
        self.assertTrue(result["passed"])
        self.pipeline.ux_reviewer.assert_called_once()
        self.assertTrue(result["gates"]["ui_ux_review"])
        self.pipeline.ux_reviewer=Mock(side_effect=RuntimeError("Review unavailable"))
        with patch("cicd.logic.pipeline.read",return_value=self.pipeline.config):
            result=self.pipeline._gates("candidate","base","test")
        self.assertFalse(result["passed"])
        self.assertIn("Review unavailable",result["error"])
        self.assertNotIn("artifacts",result)


class SecurityPromotionTests(PromotionTests):
    def test_missing_security_evidence_blocks_upload_and_main(self):
        self.uat()
        self.pipeline.config["securityReview"]=True
        self.report["configuration"]=digest(self.pipeline.config)
        self.store.save("test-candidate.json",self.report)
        self.uat()
        self.pipeline._gates=Mock(return_value=self.report)
        self.pipeline.marketplace=Mock()
        with self.assertRaisesRegex(ValueError,"security approval"):self.pipeline.publish()
        self.pipeline.marketplace.publish.assert_not_called()
        self.assertEqual(self.refs["main"],"base")

    def test_security_evidence_binds_candidate_and_artifact_hashes(self):
        import copy
        self.pipeline.config["securityReview"]=True
        tested={"artifacts":[{"name":"package.vsix","sha256":"expected"}]}
        valid={"candidate":"candidate","base":"base","gates":{"security_scan":True,"security_review":True},
            "security_scan":{"passed":True,"artifacts":tested["artifacts"]},
            "security_review":{"candidate":"candidate","base":"base","approved":True,"summary":"Fixture inspection","findings":[]}}
        self.pipeline._require_security(valid,tested,"candidate","base")
        for change in ("stale","rejected","artifact","missing"):
            report=copy.deepcopy(valid)
            if change=="stale":report["security_review"]["candidate"]="old"
            if change=="rejected":report["security_review"]["approved"]=False
            if change=="artifact":report["security_scan"]["artifacts"][0]["sha256"]="other"
            if change=="missing":report.pop("security_review")
            with self.subTest(change=change),self.assertRaises(ValueError):self.pipeline._require_security(report,tested,"candidate","base")

    def test_final_security_gate_fails_closed_and_precedes_artifact_retention(self):
        from unittest.mock import patch
        self.pipeline.config["securityReview"]=True
        self.pipeline.runner=Mock()
        self.pipeline.reviewer=Mock(return_value={"approved":True,"candidate":"candidate","base":"base","summary":"Technical fixture","findings":[]})
        self.pipeline.security_reviewer=Mock(side_effect=RuntimeError("Security reviewer unavailable"))
        with patch("cicd.logic.pipeline.read",return_value=self.pipeline.config):
            result=self.pipeline._gates("candidate","base","deployment")
        self.assertFalse(result["passed"]);self.assertIn("Security reviewer unavailable",result["error"])
        self.assertNotIn("artifacts",result)
        self.pipeline.security_reviewer.assert_called_once()
