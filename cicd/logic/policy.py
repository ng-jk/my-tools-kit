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


def require_ui_ux(report, candidate, base):
    from ..data.reviewer import UX_CRITERIA
    review = report.get("ui_ux_review")
    if not review_passes(review, candidate, base) or report.get("gates", {}).get("ui_ux_review") is not True:
        raise ValueError("Passing UI/UX code review is required for this exact candidate")
    criteria = review.get("criteria")
    if not isinstance(criteria, dict) or set(criteria) != set(UX_CRITERIA):
        raise ValueError("UI/UX review must cover every required criterion")
    for item in criteria.values():
        if not (isinstance(item, dict) and item.get("status") in ("pass", "not_applicable")
                and isinstance(item.get("rationale"), str) and item["rationale"].strip()
                and isinstance(item.get("evidence"), list) and item["evidence"]
                and all(isinstance(e, str) and e.strip() for e in item["evidence"])):
            raise ValueError("UI/UX review criterion failed or lacks source evidence")
    if not isinstance(review.get("limitations"), str) or not review["limitations"].strip():
        raise ValueError("UI/UX review must state its verification limitations")
