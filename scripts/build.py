"""Build the portable agent plugin using Python only, with deterministic source copies."""
import json
from pathlib import Path
import shutil
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parent.parent
plugin = root / "plugins/pipeline-configurator"
shutil.copy2(root / "LICENSE", plugin / "LICENSE")
runtime = plugin / "skills/configure-pipeline/scripts/runtime"
runtime.mkdir(parents=True, exist_ok=True)
if not runtime.resolve().is_relative_to(plugin.resolve()):
    raise ValueError("Invalid runtime directory")
sources = {Path("pipeline.py"): root / "pipeline.py"}
sources.update({source.relative_to(root): source for source in (root / "cicd").rglob("*.py") if "__pycache__" not in source.parts})
# Sync generated files in place: Windows/OneDrive can hold directory handles open.
# Validate every resolved target and never recursively remove a directory.
for target in runtime.rglob("*"):
    if target.is_file() and target.relative_to(runtime) not in sources:
        if not target.resolve().is_relative_to(runtime.resolve()):
            raise ValueError("Generated file escapes runtime directory")
        target.unlink()
for relative, source in sources.items():
    target = runtime / relative
    if not target.resolve().is_relative_to(runtime.resolve()):
        raise ValueError("Generated file escapes runtime directory")
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, target)
shutil.copy2(root / "skills/configure-pipeline/SKILL.md", plugin / "skills/configure-pipeline/SKILL.md")
version = json.loads((plugin / ".codex-plugin/plugin.json").read_text(encoding="utf-8"))["version"]
output = root / "dist" / f"pipeline-configurator-{version}.zip"
output.parent.mkdir(exist_ok=True)
with ZipFile(output, "w", ZIP_DEFLATED) as archive:
    for file in sorted(plugin.rglob("*")):
        if file.is_file() and "__pycache__" not in file.parts:
            archive.write(file, file.relative_to(plugin).as_posix())
print(f"Built {output}")
