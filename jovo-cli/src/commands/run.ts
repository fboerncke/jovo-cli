import Command, { flags } from '@oclif/command';
import boxen, { BorderStyle as BoxenBorderStyle, Options as BoxenOptions } from 'boxen';
import chalk from 'chalk';
import { ChildProcess } from 'child_process';
import spawn from 'cross-spawn';
import { accessSync } from 'fs-extra';
import { getProject, InputFlags, JovoCliError, JOVO_WEBHOOK_URL } from 'jovo-cli-core';
import * as JovoWebhookConnector from 'jovo-webhook-connector';
import _ from 'lodash';
import open from 'open';
import * as path from 'path';
import resolveBin from 'resolve-bin';
import {
  addBaseCliOptions,
  getPackageVersionsNpm,
  platforms,
  setUpdateMessageDisplayed,
  shouldDisplayUpdateMessage,
} from '../utils';

export class Run extends Command {
  static description = 'Runs a local development server (webhook).';

  static examples = ['jovo run --watch', 'jovo run --port 8008'];

  static flags: InputFlags = {
    'port': flags.string({
      char: 'p',
      description: 'Port to local development webhook.',
    }),
    'inspect': flags.string({
      char: 'i',
      description: 'Debugging port.',
    }),
    'stage': flags.string({
      description: 'Takes configuration from specified stage.',
    }),
    'watch': flags.boolean({
      char: 'w',
      description: 'Uses nodemon to watch files. Restarts immediately on file change.',
    }),
    'webhook-only': flags.boolean({
      description: 'Starts the Jovo Webhook proxy without executing the code.',
    }),
    'tsc': flags.boolean({
      description: 'Compile TypeScript first before execution.',
    }),
    'disable-jovo-debugger': flags.boolean({
      description: 'Disables Jovo Debugger (web version).',
    }),
    'model-test': flags.boolean({
      description: 'Activates the language model test.',
    }),
    'timeout': flags.integer({
      description: 'Sets timeout in milliseconds.',
    }),
    'record': flags.string({
      char: 'r',
      description:
        'Can be used to record requests and responses of your Jovo app for testing purposes.',
    }),
  };

  static args = [{ name: 'webhookFile', required: false, default: 'index.js' }];

  async run() {
    platforms.addCliOptions('run', Run.flags);
    addBaseCliOptions(Run.flags);
    this.log(' ');

    const { args, flags } = this.parse(Run);

    if (!platforms.validateCliOptions('run', flags)) {
      return;
    }

    this.log(`\n jovo run: ${Run.description}`);
    this.log(chalk.grey('   >> Learn more: https://jovo.tech/docs/cli/run\n'));

    const project = getProject();
    await project.init();

    const port = Number(flags.port!) || 3000;
    const timeout = flags.timeout || 5000;
    const stage = project.getStage(flags.stage!);

    // Update message should be displayed in case old packages get used
    if (shouldDisplayUpdateMessage(24)) {
      const packageVersions = await getPackageVersionsNpm(/^jovo\-/);
      const outOfDatePackages: string[] = [];
      if (Object.keys(packageVersions).length > 0) {
        for (const packageName of Object.keys(packageVersions)) {
          if (packageVersions[packageName].local !== packageVersions[packageName].npm) {
            outOfDatePackages.push(packageName);
          }
        }
      }

      if (outOfDatePackages.length > 0) {
        const outputText: string[] = [];
        outputText.push('Updates available for the following Jovo packages:');
        for (const packageName of outOfDatePackages) {
          const text = `  - ${packageName}: ${packageVersions[packageName].local} ${chalk.grey(
            `-> ${packageVersions[packageName].npm}`,
          )}`;
          outputText.push(text);
        }

        outputText.push('\nUse "jovo update" to get the newest versions.');

        const boxOptions: BoxenOptions = {
          padding: 1,
          margin: 1,
          borderColor: 'yellow',
          borderStyle: BoxenBorderStyle.Round,
        };

        this.log(boxen(outputText.join('\n'), boxOptions));
        setUpdateMessageDisplayed();
      }
    }

    try {
      project.getConfig(stage);
    } catch (err) {
      throw new JovoCliError(err.message, 'jovo-cli');
    }

    if (flags['webhook-only']) {
      return jovoWebhook({ port, timeout }, stage);
    }

    // ToDo: Refactor!
    let srcDir = project.jovoConfigReader!.getConfigParameter('src', stage) as string;
    // ToDo: _.endsWith would check if path.sep ends with srcDir?
    if (srcDir && !_.endsWith(path.sep, srcDir)) {
      srcDir += path.sep;
    }

    // Check always in the current folder
    const checkFolders: string[] = ['./'];

    // Check if the src folder got overwritten
    if (srcDir) {
      checkFolders.push(srcDir);
    }

    if (flags.tsc) {
      this.log('Compiling TypeScript...');
      await project.compileTypeScriptProject(srcDir);
      this.log('TypeScript Compiling finished.');
    }

    if (await project.isTypeScriptProject()) {
      // If it is a typescript project look in "dist" folder
      checkFolders.push('./dist/src/');
      checkFolders.push('./dist/');

      try {
        accessSync(path.join('./dist/'));
      } catch (e) {
        this.log('Cannot find /dist folder. Start compiling TypeScript...');
        await project.compileTypeScriptProject(srcDir);
        this.log('TypeScript Compiling finished.');
        this.log(' ');
      }
    } else {
      // In regular projects in "src" folder
      checkFolders.push('./src/');
    }

    let projectFolder: string | undefined;
    for (const folderPath of checkFolders) {
      try {
        accessSync(path.join(folderPath, args.webhookFile));
        projectFolder = folderPath;
      } catch (err) {
        // Folder does not exist.
      }
    }

    if (!projectFolder) {
      this.error('Could not find a project to run.');
    }

    const parameters = [
      args.webhookFile,
      '--ignore',
      'db/*',
      '--ignore',
      'test/*',
      '--webhook',
      '--jovo-webhook',
    ];

    if (flags.record) {
      parameters.push('--record', flags.record);
    }

    if (flags.inspect) {
      parameters.unshift(`--inspect=${flags.inspect}`);
    }

    // Add project path to parameters, if source path is not project path.
    if (srcDir && srcDir.length > 0) {
      parameters.push('--projectDir', process.cwd());
    }

    if (stage) {
      parameters.push('--stage', stage);
    }

    if (flags['disable-jovo-debugger']) {
      parameters.push('--disable-jovo-debugger');
    }

    if (flags['model-test']) {
      parameters.push('--model-test');
    }

    if (flags.port) {
      parameters.push('--port', flags.port);
    }
    parameters.push('--color');

    // Pass all parameters through to project process that gets set after "--"
    // Example: "jovo run -- --log-level 5"
    // ToDo: Refactor!
    let addActive = false;
    for (const parameter of process.argv) {
      if (addActive) {
        parameters.push(parameter);
      } else if (parameter === '--') {
        addActive = true;
      }
    }

    const command = flags.watch ? resolveBin.sync('nodemon') : 'node';
    const ls = spawn(command, parameters, {
      windowsVerbatimArguments: true,
      cwd: projectFolder,
    });

    jovoWebhook({ port, timeout }, stage, ls);

    ls.on('close', (code) => {
      if (code !== 0) {
        process.exit(-1);
      }
    });

    // Output everything the child process prints.
    ls.stdout!.pipe(process.stdout);
    ls.stderr!.pipe(process.stderr);

    // Ensure our child process is terminated upon exit. This is needed in the situation
    // where we're on Linux and are the child of another process (grandchild processes are orphaned in Linux).
    process.on('exit', () => {
      ls.kill();
    });
  }
}

/**
 * Initializes connection to the Jovo Webhook
 * @param {*} options
 * @param {string} stage
 */
function jovoWebhook(options: object, stage: string, childProcess?: ChildProcess) {
  const project = getProject();
  let id;

  try {
    id = project.getOrCreateJovoWebhookId();
  } catch (err) {
    console.log('Warning: Please initialize your project: $ jovo3 init');
    return;
  }

  try {
    if (!project.jovoConfigReader!.getConfigParameter('endpoint', stage)) {
      // throw new Error('Warning: You haven\'t defined an endpoint in your app.json yet.');
    }

    if (
      _.startsWith(project.jovoConfigReader!.getConfigParameter('endpoint', stage) as string, 'arn')
    ) {
      throw new JovoCliError(
        "Warning: Your endpoint is a lambda endpoint. Lambda isn't supported with jovo webhook.",
        'jovo-cli',
      );
    }
  } catch (err) {
    if (_.startsWith(err.message, 'Warning:')) {
      console.log(err.message);
    }
  }

  // Open socket redirect from server to localhost
  JovoWebhookConnector.open(id, JOVO_WEBHOOK_URL, { post: options });

  const debuggerUrl = `${JOVO_WEBHOOK_URL}/${id}`;
  if (Boolean(process.stdout.isTTY)) {
    if (process.stdin.setRawMode) {
      setTimeout(() => {
        console.log('\nTo open Jovo Debugger in your browser, enter .\n');
      }, 2500);

      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.setEncoding('utf8');
      let inputText = '';
      process.stdin.on('data', async (keyRaw) => {
        const key = keyRaw.toString();
        if (key === '.') {
          // When dot gets pressed open try to open the debugger in browser
          try {
            await open(debuggerUrl);
          } catch (e) {
            console.log(
              '\nCould not open browser. Please open debugger manually by visiting this url:',
            );
            console.log(debuggerUrl);
          }
          inputText = '';
        } else {
          // When anything else got pressed, record it and send it on enter into the child process
          if (key.charCodeAt(0) === 13) {
            // send to child process and print in terminal
            if (childProcess) {
              childProcess.stdin!.write(inputText + '\n');
            }
            process.stdout.write('\n');
            inputText = '';
          } else if (key.charCodeAt(0) === 3) {
            // Ctrl+C has been pressed, kill process.
            process.exit();
          } else {
            // record it and write into terminal
            inputText += key;
            process.stdout.write(key);
          }
        }
      });
    } else {
      setTimeout(() => {
        console.log(`\nTo open Jovo Debugger open this url in your browser:\n${debuggerUrl}\n`);
      }, 2500);
    }
  }
}
