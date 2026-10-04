# Third-party notices

The integrated SFTP implementation is adapted from [ng-jk/vscode-sftp](https://github.com/ng-jk/vscode-sftp), revision `ef4d3ca3e6fd2c0c24e05079d3dcf6093d633ce8` (SFTP plus 1.16.3). Credit belongs to ng-jk (NG JUN KAI), Natizyskunk (Natan FOURIÉ), liximomo, and the preceding contributors. The complete upstream license is retained in `vendor/sftp/LICENSE` and included in the extension package.

The maintained fork is in `src/data/sftp`, `src/logic/sftp`, and `src/interface/sftp`. `vendor/sftp/provenance.json` maps original files to their imported locations. The imported source was refactored to separate host callbacks, protocol/filesystem adapters, and transfer logic; command IDs and the remote URI scheme were namespaced to avoid collisions with standalone SFTP extensions.

Bundled runtime dependencies retain their respective licenses. Packaging generates `build/sftp/THIRD-PARTY-LICENSES.txt` from the actual bundled dependency graph and includes it in the VSIX. The toolkit's MIT license does not replace dependency licenses. Database Client remains a reference checkout and is not bundled.
