import {realpathSync} from 'fs';
export function nativeRealpath(value: string): string { return realpathSync.native(value); }
