import { Command, Plugin, Topic } from '@oclif/config';
import { DefaultEvents, Emitter, JovoCli, ConfigHooks, JovoCliPlugin } from '@jovotech/cli-core';

export class Collector extends Plugin {
  get topics(): Topic[] {
    return [];
  }
  hooks = {};
  commands: Command.Plugin[] = [];

  async install(commandId: string): Promise<void> {
    const emitter = new Emitter<DefaultEvents>();

    await this.loadPlugins(commandId, emitter);
  }

  /**
   * Loads plugins from project and installs respective commands and hooks.
   * @param argCmd - The current command id passed from process.argv.
   * @param project - The instantiated project.
   * @param emitter - The Event Emitter.
   */
  async loadPlugins(commandId: string, emitter: Emitter<DefaultEvents>): Promise<void> {
    try {
      const jovo: JovoCli = JovoCli.getInstance();
      const plugins: JovoCliPlugin[] = jovo.loadPlugins();

      for (const plugin of plugins) {
        plugin.install(emitter);
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        this.commands.push(...plugin.getCommands());
      }

      // Load hooks from project configuration.
      if (jovo.isInProjectDirectory()) {
        const hooks: ConfigHooks = jovo.$project!.$config.getParameter('hooks') as ConfigHooks;
        if (hooks) {
          for (const [eventKey, events] of Object.entries(hooks)) {
            for (const event of events) {
              // eslint-disable-next-line @typescript-eslint/ban-ts-comment
              // @ts-ignore
              emitter.on(eventKey, event);
            }
          }
        }
      }

      if (!this.commands.length) {
        return;
      }

      // Run install middleware for currently executed command.
      const currentCommand: Command.Plugin | undefined = this.commands.find(
        (command) => command.id === commandId,
      );

      if (currentCommand) {
        const { id: command, flags, args } = currentCommand;
        await emitter.run('install', {
          command,
          flags,
          args,
        });
      }
    } catch (error) {
      console.log(`There was a problem:\n${error}`);
      process.exit();
    }
  }
}
