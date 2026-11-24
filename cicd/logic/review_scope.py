"""Bounded operator-selected review scope; no free-form repository instructions."""

def security_scope(remote_namespace_trust="default", ssh_sudo_trust="default"):
    if ssh_sudo_trust not in ("default", "authenticated-server"):
        raise ValueError("Unsupported sshSudoTrust")
    sudo_scope = ""
    if ssh_sudo_trust == "authenticated-server":
        sudo_scope = (
            "For REQUESTED SSH/SFTP SUDO SESSIONS, the operator requests publication of the "
            "implemented conventional authenticated-server trust model after disclosure of the "
            "root-attestation alternative. The authenticated SSH server is trusted to honor the "
            "requested command and report its protocol behavior. This client requests sudo and "
            "checks its launch flow but does not independently certify effective UID against a "
            "server or forced wrapper that reads stdin and fabricates SFTP/acknowledgment traffic. "
            "No root-owned attestation key is required or promised. Do not reject solely because "
            "such a server can forge elevation; verify that documentation states this limitation. "
            "Still reject command injection, leaked credentials, agent forwarding on the transfer "
            "transport, host-key bypass, unintended intermediate-hop elevation, accidental normal "
            "fallback after sudo startup failure, local filesystem escapes, unverified backups and "
            "all other high/critical defects within this contract. Actual review approval predicates "
            "remain fail-closed. "
        )
    if remote_namespace_trust == "default":
        return sudo_scope
    if remote_namespace_trust != "trusted-server":
        raise ValueError("Unsupported remoteNamespaceTrust")
    return sudo_scope + (
        "For FTP/SFTP REMOTE PATH MUTATIONS ONLY, the operator explicitly selects conventional "
        "trusted-server behavior: the configured remote filesystem namespace and parties able to "
        "replace its ancestors are trusted. The operator explicitly rejects mandatory ancestor "
        "mode/owner/jail gates and remote permission readback verification. Conventional FTP "
        "uploads stage beside the destination, use server creation permissions while writing, and "
        "apply requested modes without enforcing readback. Local backups remain verified. Lack of confinement against those remote namespace writers is an "
        "accepted, documented protocol limitation, not a promised security property. State this "
        "limitation in the review summary; do not require restoring the rejected policy as a release "
        "condition. Verify the implementation and UI accurately communicate this scope. "
        "This assumption does NOT extend to remote content or filenames used for LOCAL filesystem "
        "writes, shell execution, credentials, backup repositories, TLS, SSH host keys or other "
        "toolkit functions. Reject credential leakage, transport-verification bypass, command injection, "
        "local traversal, unintended behavior within the selected scope, misleading isolation claims "
        "and any other high/critical defect. All actual approval predicates remain fail-closed."
    )
