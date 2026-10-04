// Upload overrides never broaden permissions on a local download destination.
export function transferPermissions(config: {filePerm?:number;dirPerm?:number}, upload: boolean) {
  return upload ? {filePerm:config.filePerm,dirPerm:config.dirPerm} : {filePerm:undefined,dirPerm:undefined};
}
