import * as Joi from 'joi';
const nullable = (schema: any) => schema.optional().allow(null);

const configScheme = {
  name: Joi.string(),

  context: Joi.string(),
  protocol: Joi.any().valid('sftp', 'ftp', 'local'),

  host: Joi.string().required(),
  port: Joi.number().integer(),
  connectTimeout: Joi.number().integer(),
  username: Joi.string().required(),
  password: nullable(Joi.string()),

  agent: nullable(Joi.string()),
  privateKeyPath: nullable(Joi.string()),
  passphrase: nullable(Joi.string().allow(true)),
  interactiveAuth: Joi.alternatives([
    Joi.boolean(),
    Joi.array()
      .items(Joi.string()),
  ]).optional(),
  algorithms: Joi.any(),
  sshConfigPath: Joi.string(),
  sshCustomParams: Joi.string(),

  secure: Joi.any().valid(true, false, 'control', 'implicit'),
  secureOptions: nullable(Joi.object()),
  passive: Joi.boolean(),

  remotePath: Joi.string().required(),
  uploadOnSave: Joi.boolean(),
  useTempFile: Joi.boolean(),
  openSsh: Joi.boolean(),
  downloadOnOpen: Joi.boolean().allow('confirm'),

  ignore: Joi.array()
    .min(0)
    .items(Joi.string()),
  ignoreFile: Joi.string(),

  mirror: Joi.object().keys({
    enabled: Joi.boolean(),
    // `path` is required only when mirroring is turned on.
    path: Joi.string().when('enabled', { is: true, then: Joi.required() }),
  }),

  watcher: {
    files: Joi.string().allow(false, null),
    autoUpload: Joi.boolean(),
    autoDelete: Joi.boolean(),
  },
  concurrency: Joi.number().integer(),

  syncOption: {
    delete: Joi.boolean(),
    skipCreate: Joi.boolean(),
    ignoreExisting: Joi.boolean(),
    update: Joi.boolean(),
  },
  remoteTimeOffsetInHours: Joi.number(),

  remoteExplorer: {
    filesExclude: Joi.array()
      .min(0)
      .items(Joi.string()),
    order: Joi.number(),
  },
};

const defaultConfig = {
  // common
  // name: undefined,
  remotePath: './',
  uploadOnSave: false,
  useTempFile: false,
  openSsh: false,
  downloadOnOpen: false,
  ignore: ['.git', '.vscode', '.env', '.env.*', 'node_modules'],
  // ignoreFile: undefined,
  // watcher: {
  //   files: false,
  //   autoUpload: false,
  //   autoDelete: false,
  // },
  concurrency: 4,
  // limitOpenFilesOnRemote: false

  mirror: {
    enabled: false,
  },

  protocol: 'sftp',

  // server common
  // host,
  // port,
  // username,
  // password,
  connectTimeout: 10 * 1000,

  // sftp
  // agent,
  // privateKeyPath,
  // passphrase,
  interactiveAuth: false,
  // algorithms,

  // ftp
  secure: false,
  // secureOptions,
  // passive: false,
  remoteTimeOffsetInHours: 0,

  remoteExplorer: {
    order: 0,
  },
};

export function mergedDefault(config: any) {
  return {
    ...defaultConfig,
    ...Object.fromEntries(Object.entries(config).filter(([,value]) => value !== undefined)),
  };
}
export function initialConfig() {
  return {name:'My Server', host:'localhost', protocol:'sftp', port:22, username:'username', remotePath:'/project',
    uploadOnSave:false, useTempFile:false, openSsh:false, ignore:[...defaultConfig.ignore]};
}
export function contextNames(value: any): string[] {
  if (!value || Array.isArray(value) || !Object.prototype.hasOwnProperty.call(value, 'contexts')) return [];
  if (!value.contexts || typeof value.contexts !== 'object' || Array.isArray(value.contexts) || !Object.keys(value.contexts).length)
    throw new Error('contexts must contain at least one named configuration');
  const names = Object.keys(value.contexts);
  for (const name of names) {
    const config = value.contexts[name];
    if (!name.trim() || !config || typeof config !== 'object' || Array.isArray(config)) throw new Error('Each context must be a named configuration object');
  }
  if (Object.keys(value).some(key => !['contexts', 'activeContext', '$schema'].includes(key)))
    throw new Error('Put all connection settings inside each context; shared connection settings are not supported');
  return names;
}
export function selectContext(value: any, name: string) {
  if (!contextNames(value).includes(name)) throw new Error('Unknown context: ' + name);
  return {...value, activeContext:name};
}
export function initialContexts() {
  return {activeContext:'development', contexts:{development:{...initialConfig(), context:'.'}}};
}
export function normalizeConfigurations(value: any, environment: {[key:string]:string|undefined}, selectedContext?: string) {
  const names = contextNames(value);
  if (names.length) {
    const name = selectedContext || value.activeContext;
    if (!names.includes(name)) throw new Error('Choose an existing activeContext or pass --context NAME');
    // Expand only the selected context: inactive contexts need no credentials.
    value = {...value.contexts[name], name};
  } else if (selectedContext) {
    const choices = (Array.isArray(value) ? value : [value]).filter(c => c.name === selectedContext || c.context === selectedContext);
    if (choices.length !== 1) throw new Error('Choose exactly one configuration with --context NAME');
    value = choices[0];
  }
  function expand(item: any): any {
    if(typeof item==='string') return item.replace(/\$\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g,(_,key)=>{
      if(environment[key]===undefined)throw new Error('Missing environment variable: '+key);
      return environment[key];
    });
    if(Array.isArray(item))return item.map(expand);
    if(item && typeof item==='object')return Object.fromEntries(Object.entries(item).map(([key,nested])=>[key,expand(nested)]));
    return item;
  }
  return (Array.isArray(value)?value:[value]).map(config=>mergedDefault(expand(config)));
}

export function validateConfig(config: any) {
  const { error } = Joi.validate(config, configScheme, {
    allowUnknown: true,
    convert: false,
    language: {
      object: {
        child: '!!prop "{{!child}}" fails because {{reason}}',
      },
    },
  });
  return error;
}
