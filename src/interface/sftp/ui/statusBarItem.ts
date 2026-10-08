// Adapted from ng-jk/vscode-sftp (MIT); see THIRD-PARTY-NOTICES.md.
import * as vscode from 'vscode';

const spinners = {
  dots: {
    interval: 80,
    frames: ['$(sync~spin)'],
  },
};

enum Status {
  ok = 1,
  warn,
  error,
}

export default class StatusBarItem {
  static Status = Status;

  private _name: (() => string) | string;
  private tooltip: string;
  private statusBarItem: vscode.StatusBarItem;
  private spinnerTimer: any = null;
  private activeOperations = 0;
  private resetTimer: any = null;
  private curFrameOfSpinner: number = 0;
  private text: string;
  private status: Status = Status.ok;
  private spinner: {
    interval: number;
    frames: string[];
  };

  constructor(name: (() => string) | string, tooltip: string, command: string) {
    this._name = name;
    this.tooltip = tooltip;
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
    this.statusBarItem.command = command;
    this.spinner = spinners.dots;
    this.reset = this.reset.bind(this);
    this.reset();
  }

  private get name() {
    return typeof this._name === 'function' ? this._name() : this._name;
  }

  updateStatus(status: Status) {
    this.status = status;
    this._render();
  }

  getText() {
    return this.statusBarItem.text;
  }

  show() {
    this.statusBarItem.show();
  }

  isSpinning() {
    return this.spinnerTimer !== null;
  }

  startSpinner() {
    this.activeOperations++;
    if (this.spinnerTimer) {
      this._render();
      return;
    }

    const totalFrame = this.spinner.frames.length;
    this.spinnerTimer = setInterval(() => {
      this.curFrameOfSpinner = (this.curFrameOfSpinner + 1) % totalFrame;
      this._render();
    }, this.spinner.interval);
    this._render();
  }

  stopSpinner() {
    this.activeOperations=Math.max(0,this.activeOperations-1);
    if(this.activeOperations){this._render();return;}
    clearInterval(this.spinnerTimer);
    this.spinnerTimer = null;
    this.curFrameOfSpinner = 0;
    this._render();
  }

  showMsg(text: string, hideAfterTimeout?: number): void;
  showMsg(text: string, tooltip: string, hideAfterTimeout?: number): void;
  showMsg(text: string, tooltip?: string | number, hideAfterTimeout?: number): void {
    if (typeof tooltip === 'number') {
      hideAfterTimeout = tooltip;
      tooltip = text;
    }

    if (this.resetTimer) {
      clearTimeout(this.resetTimer);
      this.resetTimer = null;
    }

    this.text = text;
    this.statusBarItem.tooltip = tooltip;
    this._render();
    if (hideAfterTimeout) {
      this.resetTimer = setTimeout(this.reset, hideAfterTimeout);
    }
  }

  private _render() {
    if (this.isSpinning()) {
      this.statusBarItem.text = this.spinner.frames[this.curFrameOfSpinner] + ' ' + this.activeOperations + ' operation(s) running: ' + this.text;
    } else if (this.name === this.text) {
      switch (this.status) {
        case Status.ok:
          this.statusBarItem.text = this.text;
          break;
        case Status.warn:
          this.statusBarItem.text = `$(alert) ${this.text}`;
          break;
        case Status.error:
          this.statusBarItem.text = `$(issue-opened) ${this.text}`;
          break;
        default:
          this.statusBarItem.text = this.text;
      }
    } else {
      this.statusBarItem.text = this.text;
    }
  }

  reset() {
    this.text = this.name;
    this.statusBarItem.tooltip = this.tooltip;
    this._render();
  }

  dispose() {
    clearInterval(this.spinnerTimer);
    clearTimeout(this.resetTimer);
    this.statusBarItem.dispose();
  }
}
