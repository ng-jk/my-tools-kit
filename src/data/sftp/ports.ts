// Host callbacks injected by the UI or terminal. Importing the engine never loads VS Code.
export const ports: any = {
  settings: () => ({ get: () => undefined }),
  password: async () => { throw new Error('Supply authentication in config, SSH agent, or DEVKIT_SFTP_PASSWORD'); },
  documents: () => [],
  log: () => {},
  status: () => {},
};
export function configurePorts(values: any) { Object.assign(ports, values); }
export const getUserSetting = (...args: any[]) => ports.settings(...args);
export const promptForPassword = (prompt: string) => ports.password(prompt);
export const getOpenTextDocuments = () => ports.documents();
export const state: any = { profile: null };
const cache = new Map();
export const app: any = { state, fsCache: cache, sftpBarItem: {
  showMsg: (...args: any[]) => ports.status(...args), reset: () => ports.status(''),
}};
export const logger: any = Object.fromEntries(['trace','debug','info','warn','error','critical'].map(level => [level, (...args: any[]) => ports.log(level, ...args)]));
export default app;
