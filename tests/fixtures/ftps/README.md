These self-signed certificates and their shared private key are public, synthetic
localhost test fixtures. They are not production credentials and must never be
used outside tests. The entire tests directory is excluded from release archives.
The second certificate deliberately names an invalid host to test rejection.
