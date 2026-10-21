// Adapted from ng-jk/vscode-sftp (MIT); see THIRD-PARTY-NOTICES.md.
import { Uri, window } from 'vscode';
import logger from '../../logger';
import app from '../../app';
import * as output from '../../ui/output';
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
                // Resolve every destination before starting any transfer.
                for (const uri of targetList) {
                    checks.push(handleCtxFromUri(uri).fileService.cancellationCheck());
                    ownedContexts.push(...allHandleCtxFromUri(uri));
                }
                if (!ownedContexts.length) throw new Error('No legacy profiles are configured for these targets.');
                logger.info('Upload to all profiles: each profile uses its own local source folder. Resolved mappings:');
                for(const {fileService,config,target} of ownedContexts)logger.info(`${fileService.name||config.host} - profile ${fileService.profile||'base'} (${config.host}:${config.port})\n${target.localFsPath} -> ${target.remoteFsPath}`);
                output.show(true);
                if(this.id.includes('forceUpload')){
                    const answer=await window.showInformationMessage('Force Upload to all listed profiles bypasses credential-file exclusions.',{modal:true,detail:'Ignore rules will be bypassed, including credential-file exclusions. Destinations: '+ownedContexts.map(({fileService,config,target})=>`${fileService.name||config.host} - profile ${fileService.profile||'base'} (${config.host}:${config.port})\n${target.localFsPath} -> ${target.remoteFsPath}`).join('\n\n')},'Upload');
                    if(answer!=='Upload')return;
                }
                checks.forEach(check => check());
                // Shared transfer logic serializes overlapping destination trees;
                // independent destinations retain concurrency.
                const results=await Promise.allSettled(ownedContexts.map(ctx=>{
                    checkPending();checks.forEach(check=>check());return commandOption.handleFile(ctx);
                }));
                const failure = results.find(result => result.status === 'rejected');
                if (failure && failure.status === 'rejected') throw failure.reason;
            }
            finally { ownedContexts.forEach(ctx => ctx.fileService.dispose()); app.remoteExplorer.refresh(); }
        }
    };
}
