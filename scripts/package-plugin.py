"""Package the generated plugin, including both hidden host manifests."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parents[1]
plugin = root / "plugins" / "pipeline-configurator"
output = root / "dist" / "pipeline-configurator-0.1.0.zip"
output.parent.mkdir(exist_ok=True)
with ZipFile(output, "w", ZIP_DEFLATED) as archive:
    for file in sorted(plugin.rglob("*")):
        if file.is_file():
            archive.write(file, file.relative_to(plugin).as_posix())
with ZipFile(output) as archive:
    assert ".codex-plugin/plugin.json" in archive.namelist()
    assert ".claude-plugin/plugin.json" in archive.namelist()
    assert "skills/configure-pipeline/scripts/runtime/pipeline-cli.js" in archive.namelist()
    assert archive.testzip() is None
print(f"Packaged {output}")
