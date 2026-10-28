# Remote permission policy

User requirement, 2026-10-28: do not reject uploads because remote ancestors are group/other-writable, owned by a different account, or lack Unix owner/mode facts. Version 0.7.16 intentionally removes that client-side access policy. No setting, warning popup or ownership exception is required.

The authenticated server enforces actual write authorization. This is ordinary trusted-server file transfer behavior, not a claim that remote paths are isolated from other server-side writers. The toolkit does not audit malicious co-writers or guarantee namespace stability against them.

Real-directory, non-following path checks, configured-root boundaries, backups, private staging and chosen new-entry modes remain. Existing directory modes are left unchanged even when a creation dirPerm is configured. New entries still use configurable creation defaults (755), and explicit server errors, missing paths and backup failures remain actionable failures. This policy does not add automatic chmod of existing directories or weaken local credential handling, TLS, SSH host checks or release security reviews.

FTP plaintext staging uses a separate protected namespace, defaulting to the login directory. Configure an existing absolute `ftpStagingPath` in the context/profile when another private directory is needed; it must be on the same filesystem for rename. Its ancestor modes and owners must establish protection from other writers. This does not restrict destination ownership or modes. SFTP uses descriptor-based file protection. A hostile replacement wire regression confirms FTP STOR never targets the shared destination namespace.
