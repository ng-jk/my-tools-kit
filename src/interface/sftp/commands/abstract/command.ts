// Adapted from ng-jk/vscode-sftp (MIT); see THIRD-PARTY-NOTICES.md.
import { reportError } from '../../helper/index';
import logger from '../../logger';

export interface ITarget {
	fsPath: string;
}

export interface CommandOption {
	[x: string]: any;
}

export default abstract class Command {
	id: string;
	name!: string;
	private _commandDoneListeners: Array<(...args: any[]) => void>;

	constructor() {
		this._commandDoneListeners = [];
		this.id = '';
	}

	onCommandDone(listener: any) {
		this._commandDoneListeners.push(listener);

		return () => {
			const index = this._commandDoneListeners.indexOf(listener);
			if (index > -1) this._commandDoneListeners.splice(index, 1);
		};
	}

	protected abstract doCommandRun(...args: unknown[]): Promise<void>;

	async run(...args: unknown[]): Promise<void> {
		logger.trace(`run command '${this.name}'`);

		try {
			await this.doCommandRun(...args);
		} catch (error) {
			if (error instanceof Error) {
				reportError(error);
			} else {
				reportError(String(error));
			}
		} finally {
			this.commitCommandDone(...args);
		}
	}

	private commitCommandDone(...args: unknown[]): void {
		this._commandDoneListeners.forEach(listener => listener(...args));
	}
}
