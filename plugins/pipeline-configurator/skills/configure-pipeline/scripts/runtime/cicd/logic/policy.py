"""Pure release decisions, independently unit-testable without Git, UI, or an AI service."""
BRANCHES = {"development": "developement", "test": "test", "deployment": "deployment", "main": "main"}


def review_passes(review, candidate, base):
    return (isinstance(review, dict) and review.get("approved") is True
            and review.get("candidate") == candidate and review.get("base") == base
            and isinstance(review.get("summary"), str) and bool(review["summary"].strip())
            and isinstance(review.get("findings"), list)
            and all(isinstance(item, dict) and item.get("severity") in ("low", "medium")
                    and isinstance(item.get("message"), str) for item in review["findings"]))


def require_tested(report, sha, base, configuration):
    if not (report.get("passed") is True and report.get("candidate") == sha
            and report.get("base") == base and report.get("configuration") == configuration
            and all(report.get("gates", {}).get(name) is True for name in
                    ("architecture", "unit", "function", "integration", "ai_review", "build"))):
        raise ValueError("No passing, current test report for this exact commit and configuration. Run test again.")


def require_uat(uat, sha, report_digest):
    if not (uat.get("approved") is True and uat.get("candidate") == sha
            and uat.get("test_report") == report_digest and uat.get("reviewer") and uat.get("note")):
        raise ValueError("Your interface UAT approval is required for this exact tested commit.")
