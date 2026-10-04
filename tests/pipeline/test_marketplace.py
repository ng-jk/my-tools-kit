"""Local fixtures only. These tests never contact or mutate the Marketplace."""
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock
from zipfile import ZipFile
from cicd.data.marketplace import Marketplace, inspect_vsix
from cicd.data.store import Store
from cicd.logic.marketplace import MarketplaceRelease


def vsix(body="original"):
    stream = io.BytesIO()
    with ZipFile(stream, "w") as archive:
        archive.writestr("extension/package.json", json.dumps({"publisher": "NGJUNKAI", "name": "test-extension", "version": "0.4.0"}))
        archive.writestr("extension.vsixmanifest", '<PackageManifest><Metadata><Identity Id="test-extension" Publisher="NGJUNKAI" Version="0.4.0"/></Metadata></PackageManifest>')
        archive.writestr("extension/extension.js", body)
    return stream.getvalue()


class MarketplaceTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.store = Store(self.root)
        package = self.root / "candidate.vsix"
        package.write_bytes(vsix())
        self.local = inspect_vsix(package)
        self.report = {"candidate": "a" * 40, "artifacts": [{"name": "dist/tool.vsix", "path": str(package), "sha256": self.local["sha256"]}]}
        self.settings = {"publisher": "NGJUNKAI", "tenantId": "c223792d-7581-42be-b41a-31524edd9422", "artifact": "dist/tool.vsix"}
        self.service = Mock()
        self.release = MarketplaceRelease(self.root, self.settings, self.store, service=self.service, pause=lambda _: None)

    def test_upload_then_confirm_exact_payload_and_retry_without_upload(self):
        self.service.remote.side_effect = [None, self.local]
        self.assertEqual(self.release.publish(self.report)["state"], "verified")
        self.service.remote.side_effect = None
        self.service.remote.return_value = self.local
        self.assertEqual(self.release.publish(self.report)["state"], "verified")
        self.service.upload.assert_called_once_with(self.report["artifacts"][0]["path"])

    def test_uncertain_upload_recovers_when_version_appears(self):
        self.service.remote.side_effect = [None, self.local]
        self.service.upload.side_effect = RuntimeError("connection dropped")
        self.assertEqual(self.release.publish(self.report)["state"], "verified")
        self.service.upload.assert_called_once()

    def test_unconfirmed_attempt_is_not_automatically_uploaded_twice(self):
        self.service.remote.return_value = None
        self.service.upload.side_effect = RuntimeError("timeout")
        for _ in range(2):
            with self.assertRaisesRegex(ValueError, "not yet visible"):
                self.release.publish(self.report)
        self.service.upload.assert_called_once()

    def test_existing_conflicting_version_blocks_upload(self):
        self.service.remote.return_value = inspect_vsix(vsix("different"))
        with self.assertRaisesRegex(ValueError, "different contents"):
            self.release.publish(self.report)
        self.service.upload.assert_not_called()

    def test_missing_remote_never_uploads_during_main_recovery(self):
        self.service.remote.return_value = None
        with self.assertRaisesRegex(ValueError, "recovery cannot upload"):
            self.release.publish(self.report, allow_upload=False)
        self.service.upload.assert_not_called()

    def test_changed_artifact_blocks_before_any_network(self):
        Path(self.report["artifacts"][0]["path"]).write_bytes(vsix("tampered"))
        with self.assertRaisesRegex(ValueError, "hash or publisher"):
            self.release.publish(self.report)
        self.service.remote.assert_not_called()

    def test_vsix_identity_mismatch_rejected(self):
        stream = io.BytesIO()
        with ZipFile(stream, "w") as archive:
            archive.writestr("extension/package.json", json.dumps({"publisher": "NGJUNKAI", "name": "test-extension", "version": "0.4.0"}))
            archive.writestr("extension.vsixmanifest", '<PackageManifest><Metadata><Identity Id="other" Publisher="NGJUNKAI" Version="0.4.0"/></Metadata></PackageManifest>')
        with self.assertRaisesRegex(ValueError, "manifest identity"):
            inspect_vsix(stream.getvalue())

    def test_vsce_adapter_uses_entra_without_pat_or_repackaging(self):
        script = self.root / "node_modules/@vscode/vsce/vsce"
        script.parent.mkdir(parents=True)
        script.write_text("fixture")
        runner = Mock()
        service = Marketplace(self.root, self.settings, runner=runner)
        service.upload(self.report["artifacts"][0]["path"])
        arguments = runner.call_args.args[0]
        self.assertEqual(arguments[-1], "--azure-credential")
        self.assertIn("--packagePath", arguments)
        self.assertNotIn("--pat", arguments)
        self.assertIsNone(runner.call_args.kwargs["environment"]["VSCE_PAT"])
        self.assertEqual(runner.call_args.kwargs["environment"]["AZURE_TENANT_ID"], self.settings["tenantId"])

    def test_public_query_distinguishes_absence_from_invalid_response(self):
        service = Marketplace(self.root, self.settings)
        service.fetch = Mock(return_value=b'{"results":[{"extensions":[]}]}')
        self.assertIsNone(service.remote(self.local))
        service.fetch.return_value = b'{"errorCode":403}'
        with self.assertRaisesRegex(ValueError, "invalid query"):
            service.remote(self.local)

    def test_public_download_verifies_extension_identity_and_payload(self):
        service = Marketplace(self.root, self.settings)
        result = {"results": [{"extensions": [{"publisher": {"publisherName": "NGJUNKAI"}, "extensionName": "test-extension", "versions": [{"version": "0.4.0"}]}]}]}
        service.fetch = Mock(side_effect=[json.dumps(result).encode(), vsix()])
        self.assertEqual(service.remote(self.local)["payload"], self.local["payload"])
