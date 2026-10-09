"""Read-only release package credential checks; findings never contain secret values."""
import hashlib
import re
from pathlib import Path, PurePosixPath
from zipfile import ZipFile

PATTERNS = {
    "private key": rb"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\r\n]+[A-Za-z0-9+/=\r\n]{64,}-----END",
    "GitHub token": rb"\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})\b",
    "OpenAI project key": rb"\bsk-proj-[A-Za-z0-9_-]{40,}\b",
    "AWS access key": rb"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b",
}

def scan_artifacts(artifacts):
    findings, scanned, hashes = [], 0, []
    for artifact in artifacts:
        file=Path(artifact["path"])
        digest=hashlib.sha256(file.read_bytes()).hexdigest()
        if digest != artifact["sha256"]:
            raise ValueError("Release artifact changed before security scan")
        hashes.append({"name":artifact["name"],"sha256":digest})
        with ZipFile(file) as archive:
            for entry in archive.infolist():
                if entry.is_dir():continue
                name=entry.filename.replace("\\","/")
                parts=PurePosixPath(name).parts
                forbidden=any(part in (".git",".azure",".aws",".ssh") or part==".env" or
                    (part.startswith(".env.") and part not in (".env.example",".env.template")) for part in parts)
                if forbidden:findings.append({"file":artifact["name"]+":"+name,"rule":"credential/configuration file"})
                if entry.file_size>100_000_000:raise ValueError("Release entry too large for security inspection")
                data=archive.read(entry);scanned+=1
                for rule,pattern in PATTERNS.items():
                    if re.search(pattern,data):findings.append({"file":artifact["name"]+":"+name,"rule":rule})
    return {"passed":not findings,"files_scanned":scanned,"artifacts":hashes,"findings":findings,
            "limitations":"Known token and private-key patterns and credential-file paths; cannot prove absence of every secret."}
