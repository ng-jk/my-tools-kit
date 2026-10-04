// Adapted from ng-jk/vscode-sftp (MIT); see THIRD-PARTY-NOTICES.md.
import GitIgnore from 'ignore';

export default class Ignore {
  static from(pattern: string[] | string) {
    return new Ignore(pattern);
  }

  pattern: string[] | string;
  private ignore: any;

  constructor(pattern: string[] | string) {
    this.ignore = GitIgnore();
    this.pattern = pattern;
    this.ignore.add(pattern);
  }

  ignores(pathname: string): boolean {
    if (!GitIgnore.isPathValid(pathname)) {
      return false;
    }

    return this.ignore.ignores(pathname);
  }
}
