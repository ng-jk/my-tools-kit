"""Check enforced dependencies of the three product and pipeline layers."""
import ast
from pathlib import Path
import re


def violations(root):
    errors = []
    for layer in ("data", "logic", "interface"):
        for file in (root / "src" / layer).rglob("*"):
            if file.suffix not in (".js", ".ts"):
                continue
            source = file.read_text(encoding="utf-8")
            dependencies = re.findall(r"require\(['\"]([^'\"]+)['\"]\)", source)
            dependencies += re.findall(r"(?:from\s+|import\s+)['\"]([^'\"]+)['\"]", source)
            for dependency in dependencies:
                resolved = (file.parent / dependency).resolve() if dependency.startswith(".") else None
                forbidden = [root / "src" / "interface", root / "lib"] if layer == "logic" else [root / "src" / "logic", root / "src" / "interface", root / "lib"] if layer == "data" else []
                if any(resolved and resolved.is_relative_to(path.resolve()) for path in forbidden):
                    errors.append(f"{file.relative_to(root)}: forbidden dependency {dependency}")
                if layer != "interface" and dependency == "vscode":
                    errors.append(f"{file.relative_to(root)}: VS Code belongs in interface")
                if layer == "logic" and dependency.removeprefix("node:") in ("fs", "fs/promises", "http", "https", "child_process", "worker_threads", "fs-extra"):
                    errors.append(f"{file.relative_to(root)}: I/O belongs in data adapters")
        for file in (root / "cicd" / layer).glob("*.py"):
            tree = ast.parse(file.read_text(encoding="utf-8"))
            for node in ast.walk(tree):
                if isinstance(node, ast.ImportFrom):
                    dependency = node.module or ""
                elif isinstance(node, ast.Import):
                    dependency = " ".join(alias.name for alias in node.names)
                else:
                    continue
                forbidden = ("interface",) if layer == "logic" else ("logic", "interface") if layer == "data" else ()
                if any(part in dependency.split(".") for part in forbidden):
                    errors.append(f"{file.relative_to(root)}: forbidden dependency {dependency}")
    return errors


if __name__ == "__main__":
    root = Path(__file__).resolve().parent.parent
    errors = violations(root)
    print("\n".join(errors) if errors else "Data/logic/interface dependency checks passed")
    raise SystemExit(bool(errors))
