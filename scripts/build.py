"""Build the portable agent plugin using Python only, with deterministic source copies."""
import json
from pathlib import Path
import shutil
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parent.parent
plugin = root / "plugins/pipeline-configurator"
runtime = plugin / "skills/configure-pipeline/scripts/runtime"
runtime.mkdir(parents=True, exist_ok=True)
if not runtime.resolve().is_relative_to(plugin.resolve()):
    raise ValueError("Invalid runtime directory")
shutil.rmtree(runtime)
runtime.mkdir(parents=True)
shutil.copy2(root / "pipeline.py", runtime / "pipeline.py")
shutil.copytree(root / "cicd", runtime / "cicd", ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
shutil.copy2(root / "skills/configure-pipeline/SKILL.md", plugin / "skills/configure-pipeline/SKILL.md")
version = json.loads((plugin / ".codex-plugin/plugin.json").read_text(encoding="utf-8"))["version"]
output = root / "dist" / f"pipeline-configurator-{version}.zip"
output.parent.mkdir(exist_ok=True)
with ZipFile(output, "w", ZIP_DEFLATED) as archive:
    for file in sorted(plugin.rglob("*")):
        if file.is_file() and "__pycache__" not in file.parts:
            archive.write(file, file.relative_to(plugin).as_posix())
print(f"Built {output}")
