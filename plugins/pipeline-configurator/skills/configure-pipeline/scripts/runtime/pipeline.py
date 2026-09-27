#!/usr/bin/env python3
"""Portable pipeline entry point, using only Python standard-library modules."""
from cicd.interface.cli import main

if __name__ == "__main__":
    raise SystemExit(main())
