// Adapted from ng-jk/vscode-sftp (MIT); see THIRD-PARTY-NOTICES.md.
import { Uri, window } from 'vscode';
import logger from '../../logger';
import app from '../../app';
import { reportError } from '../../helper/index';
import { handleCtxFromUri, allHandleCtxFromUri, FileHandlerContext } from '../../fileHandlers/index';
import Command from './command';
import {pendingOperationCheck} from '../../../../logic/sftp/cancellation';

interface BaseCommandOption {
    id: string;
    name?: string;
}

interface CommandOption extends BaseCommandOption {
    handleCommand: (this: Command, ...args: any[]) => unknown | Promise<unknown>;
}

interface FileCommandOption extends BaseCommandOption {
    handleFile: (ctx: FileHandlerContext) => Promise<unknown>;
    getFileTarget: (...args: any[]) => undefined | Uri | Uri[] | Promise<undefined | Uri | Uri[]>;
}

function checkType<T>() {
    return (a: T) => a;
}

export const checkCommand = checkType<CommandOption>();
export const checkFileCommand = checkType<FileCommandOption>();

export function createCommand(commandOption: CommandOption & { name: string }) {
    return class NormalCommand extends Command {
        constructor() {
            super();
            this.id = commandOption.id;
            this.name = commandOption.name;
        }

        protected async doCommandRun(...args: unknown[]): Promise<void> {
            await commandOption.handleCommand.apply(this, args);
        }
    };
}

export function createFileCommand(commandOption: FileCommandOption & { name: string }) {
    return class FileCommand extends Command {
        constructor() {
            super();
            this.id = commandOption.id;
            this.name = commandOption.name;
        }

        protected async doCommandRun(...args: unknown[]): Promise<void> {
            const checkPending = pendingOperationCheck();
            const target = await commandOption.getFileTarget(...args);
            checkPending();
            if (!target) {
                logger.warn(`The "${this.name}" command get canceled because of missing targets.`);
                return;
            }

            const targetList: Uri[] = Array.isArray(target) ? target : [target];
            const pendingTasks = targetList.map(async uri => {
                try {
                    await commandOption.handleFile(handleCtxFromUri(uri));
                } catch (error) {
                    if (error instanceof Error) {
                        reportError(error);
                    } else {
                        reportError(String(error));
                    }
                }
            });

            await Promise.all(pendingTasks);
        }
    };
}

export function createFileMultiCommand(commandOption: FileCommandOption & { name: string }) {
    return class FileCommand extends Command {
        constructor() {
            super();
            this.id = commandOption.id;
            this.name = commandOption.name;
        }

        protected async doCommandRun(...args: unknown[]): Promise<void> {
            const checkPending = pendingOperationCheck();
            const target = await commandOption.getFileTarget(...args);
            checkPending();
            if (!target) {
                logger.warn(`The "${this.name}" command get canceled because of missing targets.`);
                return;
            }

            const targetList: Uri[] = Array.isArray(target) ? target : [target];
            const ownedContexts: FileHandlerContext[] = [];
            const checks: Array<() => void> = [];
            try {
                // Resolve every destination before prompting or starting any transfer.
                for (const uri of targetList) {
                    checks.push(handleCtxFromUri(uri).fileService.cancellationCheck());
                    ownedContexts.push(...allHandleCtxFromUri(uri));
                }
                if (!ownedContexts.length) throw new Error('No legacy profiles are configured for these targets.');
                checks.forEach(check => check());
                const detail = ownedContexts.map(({fileService, config, target}) =>
                    `${fileService.name || config.host} — profile ${fileService.profile || 'base'} (${config.host}:${config.port})\n${target.localFsPath} → ${target.remoteFsPath}`
                ).join('\n\n');
                const answer = await window.showInformationMessage('Upload to all listed profiles?', {
                    modal: true,
                    detail: `Existing remote files will be overwritten; folders are uploaded recursively. Recovery requires a backup.${this.id.includes('forceUpload') ? ' Ignore rules will be bypassed, including credential-file exclusions.' : ' Configured ignore rules remain active.'}\n\n${detail}`,
                }, 'Upload'); // VS Code supplies the modal Cancel button.
                if (answer !== 'Upload') return;
                checks.forEach(check => check());
                const results = await Promise.allSettled(ownedContexts.map(commandOption.handleFile));
                const failure = results.find(result => result.status === 'rejected');
                if (failure && failure.status === 'rejected') throw failure.reason;
            }
            finally { ownedContexts.forEach(ctx => ctx.fileService.dispose()); app.remoteExplorer.refresh(); }
        }
    };
}
