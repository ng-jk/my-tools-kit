"""Read and validate the portable pipeline configuration."""
import json
from pathlib import Path

GATES = ("architecture", "unit", "function", "integration", "build")


def read(root):
    value = json.loads((Path(root) / ".devkit-pipeline.json").read_text(encoding="utf-8"))
    if value.get("version") != 1 or value.get("remote") != "origin":
        raise ValueError("Pipeline version 1 and the configured origin remote are required")
    for name in (*GATES, "prepare"):
        commands = value.get("commands", {}).get(name)
        if not isinstance(commands, list) or not commands:
            raise ValueError(f"Missing required command group: {name}")
        for command in commands:
            if not isinstance(command, list) or not command or not all(isinstance(arg, str) and arg for arg in command):
                raise ValueError(f"{name} commands must be nonempty argument arrays, never shell strings")
    if value.get("reviewer") not in ("codex", "claude"):
        raise ValueError("reviewer must be codex or claude")
    artifacts = value.get("artifacts", [])
    if not isinstance(artifacts, list) or any(not isinstance(item, str) or not item or Path(item).is_absolute() or ".." in Path(item).parts for item in artifacts):
        raise ValueError("artifacts must be relative file paths inside the project")
    if not isinstance(value.get("timeout", 900), int) or not 1 <= value.get("timeout", 900) <= 7200:
        raise ValueError("timeout must be between 1 and 7200 seconds")
    return value
