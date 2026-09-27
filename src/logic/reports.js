'use strict';
const escapeXml = text => String(text).replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
function report(run) {
  // Reports exclude bodies, headers, resolved URLs, variables, script logs and raw errors.
  return { passed: run.passed, results: run.results.map((r, index) => ({ index, status: r.status, time: r.time, passed: r.passed, ...(r.error ? { error: 'Request execution failed' } : {}), tests: r.tests.map((t, i) => ({ index: i, passed: t.passed })) })) };
}
function junit(summary) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="API collection" tests="${summary.results.length}" failures="${summary.results.filter(r => !r.passed).length}">` + summary.results.map(r => `<testcase name="Request ${r.index + 1}" time="${(r.time || 0) / 1000}">${r.passed ? '' : '<failure message="' + escapeXml(r.error || 'HTTP or assertion failure') + '"/>'}</testcase>`).join('') + '</testsuite>\n';
}
module.exports = { report, junit };
