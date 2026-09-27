"""Execute argument arrays without shell interpolation."""
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys


class CommandError(RuntimeError):
    pass


def command(argv):
    result = [sys.executable if part == "{python}" else part for part in argv]
    exe = shutil.which(result[0])
    if not exe:
        raise CommandError(f"Executable not found: {result[0]}")
    # npm.cmd is a Windows shell wrapper. Invoke its JavaScript entrypoint directly.
    if os.name == "nt" and result[0] in ("npm", "npx"):
        script = Path(exe).parent / "node_modules" / "npm" / "bin" / (result[0] + "-cli.js")
        if not script.is_file():
            raise CommandError(f"Cannot locate the Node entrypoint for {result[0]}")
        return [shutil.which("node") or "node", str(script), *result[1:]]
    return [exe, *result[1:]]


def run(argv, cwd, *, timeout=600, stdin=None, check=True):
    env = dict(os.environ, GIT_TERMINAL_PROMPT="0", GIT_OPTIONAL_LOCKS="0", PYTHONDONTWRITEBYTECODE="1")
    with subprocess.Popen(command(argv), cwd=cwd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                          text=True, encoding="utf-8", errors="replace", env=env, start_new_session=os.name != "nt",
                          creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0) as process:
        try:
            stdout, stderr = process.communicate(stdin, timeout=timeout)
        except (subprocess.TimeoutExpired, KeyboardInterrupt) as exc:
            # Stop the command tree before its isolated checkout can be removed.
            if os.name == "nt":
                subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"], capture_output=True,
                               creationflags=subprocess.CREATE_NO_WINDOW, timeout=30)
            else:
                os.killpg(process.pid, signal.SIGKILL)
            process.communicate()
            raise CommandError(f"Command interrupted or timed out after {timeout}s: {argv[0]}") from exc
        result = {"argv": argv, "code": process.returncode, "stdout": stdout, "stderr": stderr}
    if check and result["code"]:
        raise CommandError(f"Command failed ({result['code']}): {argv}\n{stderr or stdout}")
    return result
