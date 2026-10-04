// Build argument arrays; workspace configuration is never interpolated into a local shell command.
function words(source: string) {
  const result: string[] = []; let value = '', quote = '', escaped = false, started = false;
  for (const char of source) {
    if (escaped) { value += char; escaped = false; started = true; }
    else if (char === '\\' && quote !== "'") { escaped = true; started = true; }
    else if (quote) { if (char === quote) quote = ''; else value += char; }
    else if (char === '"' || char === "'") { quote = char; started = true; }
    else if (/\s/.test(char)) { if (started) result.push(value); value = ''; started = false; }
    else { value += char; started = true; }
  }
  if (quote || escaped) throw new Error('Unclosed quote or escape in sshCustomParams');
  if (started) result.push(value);
  return result;
}
export function sshArguments(config: any) {
  if (config.protocol !== 'sftp') throw new Error('SSH terminal requires an SFTP profile');
  const chain = config.hop ? [config, ...(Array.isArray(config.hop) ? config.hop : [config.hop])] : [config];
  if (chain.some(entry => entry.hostFingerprint)) throw new Error('SSH terminal cannot enforce hostFingerprint pins; use trusted OpenSSH known_hosts for terminal sessions');
  if (chain.length > 1) throw new Error('SSH terminal hop trust is not supported; configure and verify an OpenSSH ProxyJump alias instead');
  const target = chain[chain.length - 1];
  const destination = (entry: any) => {
    if (!entry.host || !entry.username || /[\s\x00-\x1f]/.test(entry.host + entry.username)) throw new Error('Invalid SSH host or username');
    return entry.username + '@' + entry.host;
  };
  const args = ['-t','-p',String(target.port || 22),'-o','StrictHostKeyChecking=yes'];
  if (target.knownHostsPath) args.push('-o','UserKnownHostsFile="' + target.knownHostsPath.replace(/\\/g,'/').replace(/"/g,'\\"') + '"');
  if (config.sshConfigPath) args.push('-F', config.sshConfigPath);
  if (target.privateKeyPath && !target.agent) args.push('-i',target.privateKeyPath);
  if (chain.length > 1) args.push('-J',chain.slice(0,-1).map(entry=>destination(entry)+':'+(entry.port || 22)).join(','));
  const custom = config.sshCustomParams ? words(config.sshCustomParams.replace(/\$\{remotePath\}/g, config.remotePath)) : [];
  while (custom.length && custom[0].startsWith('-')) {
    const option = custom.shift()!;
    if (option === '--') break;
    args.push(option);
    if (/^-[BbcDEeFIiJLlmOopQRSWw]$/.test(option)) {
      if (!custom.length) throw new Error('Missing SSH option argument: ' + option);
      args.push(custom.shift()!);
    }
  }
  args.push('--',destination(target));
  args.push(...custom);
  return args;
}
