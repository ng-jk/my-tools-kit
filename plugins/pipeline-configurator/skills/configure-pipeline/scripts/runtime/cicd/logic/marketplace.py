"""Idempotent publication decisions. Upload only once; recover by verifying remote content."""
import time
from ..data.marketplace import Marketplace, inspect_vsix
from ..data.store import digest


class MarketplaceRelease:
    def __init__(self, root, settings, store, service=None, pause=time.sleep):
        self.settings, self.store = settings, store
        self.service = service or Marketplace(root, settings)
        self.pause = pause

    def check(self):
        return self.service.check_access()

    def publish(self, report, allow_upload=True):
        artifact = next((item for item in report["artifacts"] if item["name"] == self.settings["artifact"]), None)
        if not artifact:
            raise ValueError("The approved VSIX is missing from the test report")
        local = inspect_vsix(artifact["path"])
        if local["sha256"] != artifact["sha256"] or local["publisher"] != self.settings["publisher"]:
            raise ValueError("VSIX hash or publisher does not match the approved configuration")
        identity = {key: local[key] for key in ("publisher", "name", "version")}
        key = "marketplace-" + digest(identity) + ".json"
        previous = self.store.optional(key)
        if previous and (previous["candidate"] != report["candidate"] or previous["sha256"] != local["sha256"]):
            raise ValueError("This Marketplace version already has a different publication attempt; bump the version and retest")
        receipt = {**identity, "candidate": report["candidate"], "sha256": local["sha256"], "state": "checking"}

        def verify():
            remote = self.service.remote(identity)
            if remote is None:
                return False
            if any(remote[key].lower() != identity[key].lower() for key in ("publisher", "name", "version")) or remote["payload"] != local["payload"]:
                raise ValueError("Marketplace version exists with different contents; main was not promoted. Bump version and retest")
            receipt["state"] = "verified"
            receipt["url"] = f"https://marketplace.visualstudio.com/items?itemName={identity['publisher']}.{identity['name']}"
            self.store.save(key, receipt)
            return True

        if verify():
            return receipt
        if not previous and allow_upload:
            self.service.check_access()
            receipt["state"] = "upload_attempted"
            self.store.save(key, receipt)  # Durable before any external mutation.
            try:
                self.service.upload(artifact["path"])
            except Exception:
                # Do not persist raw CLI output, which can contain authentication diagnostics.
                receipt["state"] = "uncertain"
                self.store.save(key, receipt)
        elif not previous:
            raise ValueError("Marketplace version is absent; recovery cannot upload after main already advanced")
        # Service validation and indexing can lag. A later publish invocation only verifies;
        # it never blindly repeats an upload whose result was uncertain.
        for attempt in range(6):
            if attempt:
                self.pause(5)
            if verify():
                return receipt
        raise ValueError("Marketplace publication is not yet visible. Main remains unchanged. Rerun publish to verify without reuploading; inspect the publisher portal if it stays pending.")
