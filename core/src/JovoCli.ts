import { existsSync } from 'fs';
import _get from 'lodash.get';
import { dirname, join as joinPaths } from 'path';
import { URL } from 'url';
import {
  Config,
  JovoCliError,
  JovoCliPlugin,
  JovoUserConfig,
  JOVO_WEBHOOK_URL,
  Log,
  PluginType,
  Project,
} from '.';

export class JovoCli {
  private static instance?: JovoCli;
  private plugins: JovoCliPlugin[] = [];

  readonly $userConfig: JovoUserConfig;

  $projectPath: string;
  $project?: Project;

  constructor() {
    this.$projectPath = process.cwd();
    this.$userConfig = new JovoUserConfig();

    if (this.isInProjectDirectory()) {
      Log.verbose(`Found Jovo project in ${this.$projectPath}`);
      this.$project = Project.getInstance(this.$projectPath);
    }
  }

  static getInstance(): JovoCli {
    if (!this.instance) {
      this.instance = new JovoCli();
    }

    return this.instance;
  }

  /**
   * Initializes a new project at the provided path.
   * @param path - Project path.
   */
  initializeProject(path: string): void {
    this.$projectPath = path;

    if (this.isInProjectDirectory()) {
      this.$project = Project.getInstance(this.$projectPath);
    } else {
      throw new JovoCliError({
        message: `Project could not be instantiated for ${this.$projectPath}`,
      });
    }
  }

  /**
   * Checks whether current working directory is a Jovo project.
   */
  isInProjectDirectory(): boolean {
    const packageJsonPath: string = joinPaths(this.$projectPath, 'package.json');
    if (!existsSync(packageJsonPath)) {
      return false;
    }

    const packageJson = require(packageJsonPath);
    if (!_get(packageJson, 'dependencies["@jovotech/framework"]')) {
      return false;
    }

    return existsSync(joinPaths(this.$projectPath, Config.getFileName()));
  }

  collectCommandPlugins(): JovoCliPlugin[] {
    Log.verbose('Loading global CLI plugins');
    const globalPlugins: JovoCliPlugin[] = [];
    const plugins: string[] = (this.$userConfig.getParameter('cli.plugins') as string[]) || [];
    const globalNpmFolder: string = dirname(process.env.JOVO_CLI_EXEC_PATH!);

    for (const pluginId of plugins) {
      // Load plugin from global 'node_modules/'.
      const pluginPaths: string[] = [
        joinPaths(process.env.JOVO_CLI_EXEC_PATH!, 'node_modules', pluginId, 'dist', 'index.js'),
        joinPaths(globalNpmFolder, pluginId, 'dist', 'index.js'),
      ];

      for (const pluginPath of pluginPaths) {
        // If the plugin does not exist, skip it quietly.
        if (!existsSync(pluginPath)) {
          continue;
        }

        Log.verbose(`Loading ${pluginId} from ${pluginPath}`, { indent: 2 });
        const plugin: JovoCliPlugin = new (require(pluginPath).default)();

        globalPlugins.push(plugin);
        break;
      }
    }

    return globalPlugins;
  }

  /**
   * Loads both project plugins and command plugins and returns respective classes
   */
  loadPlugins(): JovoCliPlugin[] {
    this.plugins.push(...this.collectCommandPlugins());

    if (this.$project) {
      this.plugins.push(...this.$project.collectPlugins());
    }

    return this.plugins;
  }

  /**
   * Returns an array of CLI plugin with the provided type.
   * @param type - Type of CLI plugin.
   */
  getPluginsWithType(type: PluginType): JovoCliPlugin[] {
    return this.plugins.filter((plugin) => plugin.$type === type);
  }

  getPlatforms(): string[] {
    return this.getPluginsWithType('platform').map((el: JovoCliPlugin) => el.$id);
  }

  /**
   * Resolves a given endpoint. If the endpoint is ${JOVO_WEBHOOK_URL},
   * it will get resolved to the actual user webhook url.
   * @param endpoint - The endpoint to resolve.
   */
  resolveEndpoint(endpoint: string): string {
    if (endpoint === '${JOVO_WEBHOOK_URL}') {
      return this.getJovoWebhookUrl();
    }
    return endpoint;
  }

  /**
   * Returns the default Jovo Webhook URL.
   */
  getJovoWebhookUrl(): string {
    const { href } = new URL(this.$userConfig.getWebhookUuid(), JOVO_WEBHOOK_URL);
    return href;
  }

  /**
   * Checks, if given directory already exists.
   * @param directory - Directory name.
   */
  hasExistingProject(directory: string): boolean {
    return existsSync(joinPaths(process.cwd(), directory));
  }
}
