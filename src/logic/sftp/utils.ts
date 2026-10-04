// Adapted from ng-jk/vscode-sftp (MIT); see THIRD-PARTY-NOTICES.md.
export function flatten<T>(items: (T | T[])[]): T[] {
  const accumulater = (result: T[], item: T | T[]): T[] => result.concat(item as T | ConcatArray<T>);
  return items.reduce<T[]>(accumulater, []);
}

export function interpolate(str: string, props: { [x: string]: string }) {
  return str.replace(/\${([^{}]*)}/g, (match, expr) => {
    const value = props[expr];
    return typeof value === 'string' || typeof value === 'number' ? value : match;
  });
}
