"""Bounded operator-selected review scope; no free-form repository instructions."""

def security_scope(remote_namespace_trust="default"):
    if remote_namespace_trust == "default":
        return ""
    if remote_namespace_trust != "trusted-server":
        raise ValueError("Unsupported remoteNamespaceTrust")
    return (
        "For FTP/SFTP REMOTE PATH MUTATIONS ONLY, the operator explicitly selects conventional "
        "trusted-server behavior: the configured remote filesystem namespace and parties able to "
        "replace its ancestors are trusted. The operator explicitly rejects mandatory ancestor "
        "mode/owner/jail gates. Lack of confinement against those remote namespace writers is an "
        "accepted, documented protocol limitation, not a promised security property. State this "
        "limitation in the review summary; do not require restoring the rejected policy as a release "
        "condition. Verify the implementation and UI accurately communicate this scope. "
        "This assumption does NOT extend to remote content or filenames used for LOCAL filesystem "
        "writes, shell execution, credentials, backup repositories, TLS, SSH host keys or other "
        "toolkit functions. Reject credential leakage, transport-verification bypass, command injection, "
        "local traversal, unintended behavior within the selected scope, misleading isolation claims "
        "and any other high/critical defect. All actual approval predicates remain fail-closed."
    )
