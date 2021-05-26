import prompt from 'prompts';
import { config } from 'dotenv';
import { ProjectConfigFile } from './utils/Interfaces';

// Load .env variables into process.env
config();

export { flags } from '@oclif/command';
export { prompt };

export * from './Logger';
export * from './JovoCli';
export * from './EventEmitter';
export * from './PluginHook';
export * from './utils';
export * from './PluginCommand';
export * from './Task';
export * from './Project';
export * from './JovoCliPlugin';
export * from './JovoCliError';
export * from './JovoUserConfig';
export * from './Config';

export class ProjectConfig {
  constructor(config: ProjectConfigFile) {
    Object.assign(this, config);
  }
}
