export function watchPolicy(config: any, yes = false) {
  const watcher = config.watcher || {};
  const enabled = watcher.files !== false;
  const autoUpload = enabled && !!watcher.autoUpload;
  const autoDelete = enabled && !!watcher.autoDelete;
  if (!config.uploadOnSave && !autoUpload && !autoDelete) throw new Error('Enable uploadOnSave or watcher.autoUpload/autoDelete first');
  if (autoDelete && !yes) throw new Error('watcher.autoDelete requires --yes');
  return { files: enabled ? watcher.files : false, autoUpload, autoDelete, uploadOnSave: !!config.uploadOnSave };
}
