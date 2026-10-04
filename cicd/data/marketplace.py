"""VSCE/Entra process adapter and read-only public Marketplace verification."""
import hashlib
import gzip
import io
import json
import os
from pathlib import Path
import re
import shutil
from urllib.request import Request, urlopen
from zipfile import ZipFile
from xml.etree import ElementTree
from .process import run

LIMIT = 100 * 1024 * 1024
GALLERY = "https://marketplace.visualstudio.com/_apis/public/gallery"


def inspect_vsix(source):
    """Compare extension payload, excluding the outer container's service-added signatures."""
    raw = source if isinstance(source, bytes) else Path(source).read_bytes()
    if len(raw) > LIMIT:
        raise ValueError("VSIX exceeds the pipeline's 100 MiB verification limit")
    with ZipFile(io.BytesIO(raw)) as archive:
        files = [item for item in archive.infolist() if not item.is_dir()]
        if len({item.filename for item in files}) != len(files) or sum(item.file_size for item in files) > LIMIT:
            raise ValueError("VSIX has duplicate entries or exceeds the unpacked size limit")
        manifest = json.loads(archive.read("extension/package.json"))
        identity = {key: manifest[key] for key in ("publisher", "name", "version")}
        metadata = ElementTree.fromstring(archive.read("extension.vsixmanifest"))
        package_id = metadata.find("{*}Metadata/{*}Identity")
        if package_id is None or any(package_id.get(attribute) != identity[key] for key, attribute in
                                     (("publisher", "Publisher"), ("name", "Id"), ("version", "Version"))):
            raise ValueError("VSIX manifest identity does not match package.json")
        for key in ("publisher", "name"):
            if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9-]*", identity[key]):
                raise ValueError("Invalid VSIX publisher or extension name")
        if not re.fullmatch(r"\d+\.\d+\.\d+", identity["version"]):
            raise ValueError("Publish a stable numeric major.minor.patch version")
        payload = {item.filename: hashlib.sha256(archive.read(item)).hexdigest()
                   for item in files if item.filename.startswith("extension/")}
    return {**identity, "sha256": hashlib.sha256(raw).hexdigest(), "payload": payload}


class Marketplace:
    def __init__(self, root, settings, runner=run, opener=urlopen):
        self.root, self.settings = Path(root), settings
        self.runner, self.opener = runner, opener

    def environment(self):
        search = os.environ.get("PATH", "")
        if os.name == "nt" and not shutil.which("az"):
            for base in (os.environ.get("ProgramFiles"), os.environ.get("ProgramFiles(x86)")):
                if base:
                    directory = Path(base) / "Microsoft SDKs/Azure/CLI2/wbin"
                    if (directory / "az.cmd").is_file():
                        search = str(directory) + os.pathsep + search
                        break
        # Never allow a PAT to override the explicit Entra selection in vsce.
        return {"PATH": search, "AZURE_TENANT_ID": self.settings["tenantId"], "VSCE_PAT": None}

    def vsce(self, arguments):
        executable = self.root / "node_modules/@vscode/vsce/vsce"
        if not executable.is_file():
            raise ValueError("Run npm ci at the repository root to install the locked vsce CLI")
        return self.runner(["node", str(executable), *arguments, "--azure-credential"], self.root,
                           timeout=180, environment=self.environment())

    def check_access(self):
        self.vsce(["verify-pat", self.settings["publisher"]])
        return {"passed": True, "authentication": "Microsoft Entra ID", "publisher": self.settings["publisher"],
                "note": "Publisher access verified; the upload operation additionally requires Contributor or Owner."}

    def upload(self, artifact):
        self.vsce(["publish", "--packagePath", str(artifact)])

    def fetch(self, request):
        with self.opener(request, timeout=30) as response:
            data = response.read(LIMIT + 1)
            encoding = response.headers.get("Content-Encoding", "").lower()
        if len(data) > LIMIT:
            raise ValueError("Marketplace response exceeds the verification size limit")
        if encoding == "gzip":
            with gzip.GzipFile(fileobj=io.BytesIO(data)) as stream:
                data = stream.read(LIMIT + 1)
        elif encoding not in ("", "identity"):
            raise ValueError("Unsupported Marketplace response encoding: " + encoding)
        if len(data) > LIMIT:
            raise ValueError("Decoded Marketplace response exceeds the verification size limit")
        return data

    def remote(self, identity):
        name = identity["publisher"] + "." + identity["name"]
        body = {"filters": [{"criteria": [{"filterType": 7, "value": name}], "pageNumber": 1, "pageSize": 1}], "flags": 1}
        request = Request(GALLERY + "/extensionquery", data=json.dumps(body).encode(), headers={
            "Content-Type": "application/json", "Accept": "application/json;api-version=3.0-preview.1", "User-Agent": "development-tools-kit"})
        result = json.loads(self.fetch(request))
        if "errorCode" in result or not isinstance(result.get("results"), list) or not result["results"]:
            raise ValueError("Marketplace returned an invalid query response")
        extensions = result["results"][0].get("extensions")
        if not isinstance(extensions, list):
            raise ValueError("Marketplace returned an invalid extension list")
        for extension in extensions:
            actual = extension["publisher"]["publisherName"] + "." + extension["extensionName"]
            if actual.lower() != name.lower():
                continue
            for version in extension["versions"]:
                if version["version"] == identity["version"] and version.get("targetPlatform", "universal") == "universal":
                    url = f"{GALLERY}/publishers/{identity['publisher']}/vsextensions/{identity['name']}/{identity['version']}/vspackage"
                    return inspect_vsix(self.fetch(Request(url, headers={"User-Agent": "development-tools-kit"})))
        return None
