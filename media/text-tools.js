'use strict';
const api = acquireVsCodeApi(), $ = id => document.getElementById(id);
let currentTab = 'compare', busy = false, undo = [], changedFiles = [], jsonBefore = '';
function notice(text, error = false) { $('status').textContent = text; $('status').classList.toggle('error', error); }
function setBusy(value) {
  busy = value;
  for (const control of document.querySelectorAll('button,input,textarea,select')) control.disabled = value;
  $('json-undo').disabled = value || undo.length === 0;
}
function send(message) { if (busy) return; setBusy(true); notice('Working…'); api.postMessage(message); }
function tab(name) {
  currentTab = name;
  for (const button of document.querySelectorAll('[data-tab]')) button.classList.toggle('active', button.dataset.tab === name);
  for (const section of document.querySelectorAll('.tool')) section.classList.toggle('hidden', section.id !== name);
}
function count(side) {
  const value = $(side === 'json' ? 'json-input' : side).value;
  $(side + '-count').textContent = `${value.length.toLocaleString()} characters · ${(value ? value.split(/\r\n|\r|\n/).length : 0).toLocaleString()} lines`;
}
function setText(side, text, name) {
  $(side === 'json' ? 'json-input' : side).value = text;
  if (side !== 'json' && name) $(side + '-name').textContent = name;
  count(side);
}
function compare() { send({ type: 'compare', left: $('left').value, right: $('right').value, leftName: $('left-name').textContent, rightName: $('right-name').textContent, options: { json: $('normalize-json').checked, lineEndings: $('line-endings').checked, trimWhitespace: $('trim').checked, ignoreCase: $('ignore-case').checked } }); }
function revisions() { return { left: $('git-left').value.trim(), right: $('git-right').value.trim() }; }
function renderChanges() {
  $('change-list').replaceChildren(); const query = $('file-filter').value.toLowerCase();
  let visible = 0;
  for (let i = 0; i < changedFiles.length; i++) {
    const file = changedFiles[i], label = file.leftPath && file.rightPath && file.leftPath !== file.rightPath ? `${file.leftPath} → ${file.rightPath}` : file.rightPath || file.leftPath;
    if (!label.toLowerCase().includes(query)) continue;
    const button = document.createElement('button'); button.className = 'changed-file'; button.title = 'Open comparison';
    const badge = document.createElement('span'); badge.className = 'badge' + (file.status === 'D' ? ' deleted' : ''); badge.textContent = file.status;
    const text = document.createElement('span'); text.className = 'changed-path'; text.textContent = label;
    const arrow = document.createElement('span'); arrow.className = 'change-arrow'; arrow.textContent = '↗';
    button.append(badge, text, arrow); button.onclick = () => send({ type: 'gitFile', index: i }); $('change-list').append(button); visible++;
  }
  $('change-count').textContent = `${visible} of ${changedFiles.length} files`;
  if (!visible) { const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = changedFiles.length ? 'No files match this filter.' : 'No changed files in this comparison.'; $('change-list').append(empty); }
}
for (const button of document.querySelectorAll('[data-tab]')) button.onclick = () => tab(button.dataset.tab);
for (const button of document.querySelectorAll('[data-paste]')) button.onclick = () => send({ type: 'clipboard', side: button.dataset.paste });
for (const button of document.querySelectorAll('[data-load]')) button.onclick = () => send({ type: 'load', side: button.dataset.load });
for (const side of ['left', 'right', 'json']) $(side === 'json' ? 'json-input' : side).addEventListener('input', () => count(side));
$('compare-button').onclick = compare;
$('files').onclick = () => send({ type: 'files' });
$('swap').onclick = () => { const text = $('left').value, name = $('left-name').textContent; setText('left', $('right').value, $('right-name').textContent); setText('right', text, name); };
$('clear').onclick = () => { setText('left', '', 'Left text'); setText('right', '', 'Right text'); notice('Both inputs cleared.'); };
$('wrap').onchange = () => { for (const id of ['left', 'right']) { $(id).wrap = $('wrap').checked ? 'soft' : 'off'; $(id).classList.toggle('no-wrap', !$('wrap').checked); } };
for (const button of document.querySelectorAll('[data-format]')) button.onclick = () => {
  jsonBefore = $('json-input').value;
  send({ type: 'format', text: jsonBefore, action: button.dataset.format, indent: $('indent').value === 'tab' ? 'tab' : Number($('indent').value) });
};
$('json-undo').onclick = () => { if (undo.length) setText('json', undo.pop()); $('json-undo').disabled = !undo.length; notice('Previous JSON restored.'); };
$('json-copy').onclick = () => send({ type: 'copy', text: $('json-input').value });
$('json-editor').onclick = () => send({ type: 'openJson', text: $('json-input').value });
$('json-save').onclick = () => send({ type: 'saveJson', text: $('json-input').value });
for (const side of ['left', 'right']) $('json-to-' + side).onclick = () => { setText(side, $('json-input').value, 'JSON'); tab('compare'); };
$('repository').onclick = () => send({ type: 'repository' });
$('changes').onclick = () => { changedFiles = []; renderChanges(); send({ type: 'changes', ...revisions() }); };
$('file-filter').oninput = renderChanges;
for (const id of ['git-left', 'git-right']) $(id).oninput = () => { changedFiles = []; $('change-list').replaceChildren(); $('change-count').textContent = 'Revisions changed — refresh the list'; };
for (const button of document.querySelectorAll('[data-path]')) button.onclick = () => send({ type: 'choosePath', side: button.dataset.path, revision: $('git-' + button.dataset.path).value.trim() });
$('git-paths').onclick = () => send({ type: 'gitPaths', ...revisions(), leftPath: $('left-path').value.trim(), rightPath: $('right-path').value.trim() });
document.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !busy) {
    event.preventDefault();
    if (currentTab === 'compare') compare();
    else if (currentTab === 'json') document.querySelector('[data-format="format"]').click();
    else $('changes').click();
  }
});
window.addEventListener('message', event => {
  const message = event.data;
  if (message.type === 'init') { tab(message.mode); if (message.seed) setText('json', message.seed); }
  else if (message.type === 'idle') setBusy(false);
  else if (message.type === 'error') notice(message.text, true);
  else if (message.type === 'notice') notice(message.text);
  else if (message.type === 'loaded') { if (message.side === 'json') { undo.push($('json-input').value); if (undo.length > 5) undo.shift(); } setText(message.side, message.text, message.name); notice('Loaded ' + message.name + '.'); }
  else if (message.type === 'formatted') {
    if (message.action !== 'validate' && message.text !== jsonBefore) { undo.push(jsonBefore); if (undo.length > 5) undo.shift(); }
    setText('json', message.text); notice(message.action === 'validate' ? 'Valid JSON.' : 'JSON ' + (message.action === 'minify' ? 'minified' : 'formatted') + '. Values and number precision preserved.');
  } else if (message.type === 'repository') {
    $('repo-name').textContent = message.root; changedFiles = []; renderChanges();
    $('commits').replaceChildren(); $('targets').replaceChildren();
    for (const item of [{ sha: 'HEAD', subject: 'Latest commit' }, ...message.commits]) {
      for (const id of ['commits', 'targets']) { const option = document.createElement('option'); option.value = item.sha; option.label = item.subject; $(id).append(option); }
    }
    for (const value of ['INDEX', 'WORKTREE']) { const option = document.createElement('option'); option.value = value; $('targets').append(option); }
    notice('Repository selected. Choose revisions or use HEAD → WORKTREE for local changes.');
  } else if (message.type === 'changes') { changedFiles = message.files; renderChanges(); notice(changedFiles.length ? 'Select a file to open its diff.' : 'No changes between these revisions.'); }
  else if (message.type === 'path') $(message.side + '-path').value = message.path;
});
api.postMessage({ type: 'ready' });
