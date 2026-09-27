"""JSON terminal adapter. Nonzero status means failure; no GUI dependencies."""
import argparse
import json
import sys
from ..logic.pipeline import Pipeline


def main(argv=None):
    parser = argparse.ArgumentParser(description="Python CI/CD: developement -> test -> deployment -> main")
    parser.add_argument("--root", default=".")
    commands = parser.add_subparsers(dest="command", required=True)
    for name in ("init", "status", "check", "publish"):
        commands.add_parser(name)
    test = commands.add_parser("test")
    test.add_argument("--push", action="store_true")
    uat = commands.add_parser("accept-uat", help="Human interface acceptance only; agents must not invent approval")
    uat.add_argument("--commit", required=True)
    uat.add_argument("--reviewer", required=True)
    uat.add_argument("--note", required=True)
    args = parser.parse_args(argv)
    try:
        pipeline = Pipeline(args.root, progress=lambda message: print(message, file=sys.stderr, flush=True))
        if args.command == "test":
            result = pipeline.test(args.push)
        elif args.command == "accept-uat":
            result = pipeline.accept_uat(args.commit, args.reviewer, args.note)
        else:
            result = getattr(pipeline, args.command)()
        print(json.dumps(result, indent=2))
        return 0 if result.get("passed") is True else 1
    except Exception as exc:
        print(json.dumps({"passed": False, "error": str(exc)}), file=sys.stderr)
        return 1
