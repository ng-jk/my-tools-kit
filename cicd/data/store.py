"""Commit-bound local evidence. Reports are authenticated to detect accidental/manual edits."""
import hashlib
import hmac
import json
import os
from pathlib import Path
import secrets
import shutil
from contextlib import contextmanager


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()


class Store:
    def __init__(self, common):
        self.root = Path(common) / "devkit"
        self.root.mkdir(exist_ok=True)
        self.key_path = self.root / "evidence.key"

    def worktree_path(self):
        parent = self.root / "worktrees"
        parent.mkdir(parents=True, exist_ok=True)
        return parent / secrets.token_hex(16)

    def record_network_attempts(self, attempts):
        if attempts:
            self.save("network-" + secrets.token_hex(16) + ".json", {"attempts": attempts})

    def artifacts(self, worktree, names, stage, sha):
        result = []
        for name in names:
            source = (worktree / name).resolve()
            if not source.is_relative_to(worktree.resolve()) or not source.is_file():
                raise ValueError(f"Missing or invalid build artifact: {name}")
            target = self.root / "artifacts" / stage / sha / name
            if not target.resolve().is_relative_to(self.root.resolve()):
                raise ValueError("Artifact path escapes pipeline state")
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)
            result.append({"name": name, "path": str(target), "sha256": hashlib.sha256(target.read_bytes()).hexdigest()})
        return result

    def verify_artifacts(self, report, names):
        artifacts = report.get("artifacts", [])
        if sorted(item.get("name", "") for item in artifacts) != sorted(names):
            raise ValueError("Test report does not contain the configured artifacts; retest")
        for item in artifacts:
            expected = self.root / "artifacts" / "test" / report["candidate"] / item["name"]
            target = Path(item["path"]).resolve()
            if target != expected.resolve() or not target.is_relative_to(self.root.resolve()) or not target.is_file():
                raise ValueError("Retained test artifact is missing or moved; retest and repeat UAT")
            if hashlib.sha256(target.read_bytes()).hexdigest() != item["sha256"]:
                raise ValueError("Retained test artifact changed; retest and repeat UAT")

    def key(self):
        try:
            fd = os.open(self.key_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        except FileExistsError:
            pass
        else:
            with os.fdopen(fd, "wb") as stream:
                stream.write(secrets.token_bytes(32))
        return self.key_path.read_bytes()

    def save(self, name, payload):
        data = {"payload": payload, "signature": hmac.new(self.key(), canonical(payload), hashlib.sha256).hexdigest()}
        target = self.root / name
        target.parent.mkdir(parents=True, exist_ok=True)
        temporary = target.with_suffix(".tmp")
        temporary.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
        temporary.replace(target)

    def load(self, name):
        path = self.root / name
        if not path.is_file():
            raise ValueError(f"Missing pipeline evidence: {name}")
        data = json.loads(path.read_text(encoding="utf-8"))
        expected = hmac.new(self.key(), canonical(data["payload"]), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(data.get("signature", ""), expected):
            raise ValueError("Pipeline evidence was modified; rerun the gate.")
        return data["payload"]

    def optional(self, name):
        return self.load(name) if (self.root / name).exists() else None

    @contextmanager
    def lock(self):
        file = self.root / "pipeline.lock"
        try:
            fd = os.open(file, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        except FileExistsError as exc:
            raise ValueError(f"Another pipeline operation is running. If it crashed, verify no process is active before removing {file}.") from exc
        try:
            with os.fdopen(fd, "w") as stream:
                stream.write(str(os.getpid()))
            yield
        finally:
            file.unlink(missing_ok=True)
