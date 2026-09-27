"""Conservative branch operations with fast-forward and checked-out-branch guards."""
from pathlib import Path
from .process import run, CommandError


class Git:
    def __init__(self, root):
        self.root = Path(root).resolve()
        actual = self.call("rev-parse", "--show-toplevel").strip()
        if Path(actual).resolve() != self.root:
            raise ValueError("Run the pipeline at the repository root, not a nested directory.")
        self.common = Path(self.call("rev-parse", "--path-format=absolute", "--git-common-dir").strip())
        self.attempts = []

    def call(self, *args, check=True):
        result = run(["git", "-c", "safe.directory=" + str(self.root), *args], self.root, timeout=120, check=check)
        return result["stdout"] if check else result

    def sha(self, ref):
        return self.call("rev-parse", "--verify", "--end-of-options", ref + "^{commit}").strip()

    def ref(self, branch):
        result = self.call("rev-parse", "--verify", "--quiet", "refs/heads/" + branch, check=False)
        if result["code"] == 1:
            return None
        if result["code"]:
            raise CommandError(result["stderr"])
        return result["stdout"].strip()

    def clean(self):
        if self.call("status", "--porcelain", "--untracked-files=normal").strip():
            raise ValueError("Commit or stash working changes before a release-gated operation.")

    def verify_candidate(self, worktree, candidate):
        checkout = Git(worktree)
        if checkout.sha("HEAD") != candidate:
            raise ValueError("A gate changed worktree HEAD; results do not belong to the candidate")
        if checkout.call("status", "--porcelain", "--untracked-files=no").strip():
            raise ValueError("A gate modified tracked source; commit generated changes and retest")

    def ancestor(self, older, newer):
        result = self.call("merge-base", "--is-ancestor", older, newer, check=False)
        if result["code"] not in (0, 1):
            raise CommandError(result["stderr"])
        return result["code"] == 0

    def ensure_update(self, branch, candidate):
        old = self.ref(branch)
        if old == candidate:
            return
        if old and not self.ancestor(old, candidate):
            raise ValueError(f"{branch} has diverged; merge its changes into developement and retest. No force update is allowed.")
        if "branch refs/heads/" + branch + "\n" in self.call("worktree", "list", "--porcelain"):
            raise ValueError(f"{branch} is checked out in a worktree. Switch that worktree before promotion.")

    def update(self, branch, candidate):
        self.ensure_update(branch, candidate)
        old = self.ref(branch)
        if old == candidate:
            return
        self.call("update-ref", "refs/heads/" + branch, candidate, old or "0" * 40)

    def remote_ref(self, remote, branch):
        result = self.network(["ls-remote", "--exit-code", remote, "refs/heads/" + branch], missing=True)
        return result["stdout"].split()[0] if result["stdout"].strip() else None

    def network(self, args, missing=False):
        for attempt in range(1, 4):
            result = self.call(*args, check=False)
            self.attempts.append({"operation": args, "attempt": attempt, **result})
            if result["code"] == 0 or missing and result["code"] == 2:
                return result
            auth_error = any(word in (result["stderr"] + result["stdout"]).lower() for word in (
                "authentication", "permission denied", "could not read username", "repository not found", "access denied", "403"))
            if not auth_error or attempt == 3:
                raise CommandError(result["stderr"] or result["stdout"])

    def fetch(self, remote):
        self.network(["fetch", "--no-tags", remote])

    def push(self, remote, branch, candidate):
        # Never force-push. Check the ref after every uncertain/failed attempt before retrying.
        before = self.remote_ref(remote, branch)
        if before == candidate:
            return
        if before and not self.ancestor(before, candidate):
            raise ValueError(f"Remote {branch} would not fast-forward. Fetch, reconcile, and retest.")
        args = ["push", remote, candidate + ":refs/heads/" + branch]
        for attempt in range(1, 4):
            result = self.call(*args, check=False)
            self.attempts.append({"operation": args, "attempt": attempt, **result})
            after = self.remote_ref(remote, branch)
            if after == candidate:
                return
            if result["code"] == 0:
                raise ValueError("Remote changed after push; inspect its state before continuing.")
            auth_error = any(word in (result["stderr"] + result["stdout"]).lower() for word in (
                "authentication", "permission denied", "could not read username", "repository not found", "access denied", "403"))
            if after != before or not auth_error or attempt == 3:
                raise CommandError(result["stderr"] or result["stdout"])

    def add_worktree(self, target, sha):
        self.call("worktree", "add", "--detach", str(target), sha)

    def remove_worktree(self, target):
        target = Path(target).resolve()
        # Only pipeline-owned detached worktrees under this repository's private state.
        if not target.is_relative_to((self.common / "devkit" / "worktrees").resolve()):
            raise ValueError("Refusing cleanup outside the pipeline worktree directory")
        self.call("worktree", "remove", "--force", str(target))
