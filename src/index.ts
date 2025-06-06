import {
  ILabShell,
  JupyterFrontEndPlugin,
  IRouter,
  JupyterFrontEnd
} from '@jupyterlab/application';
import {
  createToolbarFactory,
  IToolbarWidgetRegistry,
  setToolbar,
  showDialog,
  Dialog
} from '@jupyterlab/apputils';
import {
  IDefaultFileBrowser,
  IFileBrowserFactory,
  FileBrowser,
  Uploader
} from '@jupyterlab/filebrowser';
import { IStateDB } from '@jupyterlab/statedb';
import { editIcon } from '@jupyterlab/ui-components';
import { ISettingRegistry } from '@jupyterlab/settingregistry';
import { ITranslator } from '@jupyterlab/translation';
import { CommandRegistry } from '@lumino/commands';
import { Widget } from '@lumino/widgets';
import {
  FilenameSearcher,
  IScore,
  folderIcon
} from '@jupyterlab/ui-components';
import { ReadonlyPartialJSONObject, Token } from '@lumino/coreutils';
import { S3ClientConfig } from '@aws-sdk/client-s3';
import { Drive } from './s3contents';
import { DriveIcon } from './icons';
import { SecretsManager, ISecretsManager } from 'jupyter-secrets-manager';

/**
 * The command IDs used by the filebrowser plugin.
 */
namespace CommandIDs {
  export const openPath = 'filebrowser:open-path';
  export const openSwitchDrive = 'drives:open-switch-drive-dialog';
  export const copyToAnotherBucket = 'drives:copy-to-another-bucket';
  export const toggleBucketSwitching = 'drives:toggle-bucket-switching-ui';
  export const toggleBrowser = 'filebrowser:toggle-main';
  export const rename = 'drives:rename';
}

const FILE_BROWSER_FACTORY = 'DriveBrowser';
const FILE_BROWSER_PLUGIN_ID = 'jupydrive-s3:file-browser-toolbar';

/**
 * The class name added to the  drive filebrowser filterbox node.
 */
const FILTERBOX_CLASS = 'jp-DriveBrowser-filterBox';

/**
 * The class name added to file dialogs.
 */
const FILE_DIALOG_CLASS = 'jp-FileDialog';

/**
 * The class name added for the new drive label in the switch drive dialog.
 */
const SWITCH_DRIVE_TITLE_CLASS = 'jp-new-drive-title';

/**
 * The ID used for saving the drive name to the persistent state databse.
 */
const DRIVE_STATE_ID = 'jupydrive-s3:drive-name-id';

/**
 * A promise that resolves to S3 authentication credentials.
 */
export interface IS3Auth {
  factory: () => Promise<{
    name: string;
    root: string;
    config: S3ClientConfig;
    secretsManager?: ISecretsManager;
    token?: symbol;
  }>;
}

/**
 * A token for a plugin that provides S3 authentication.
 */
export const IS3Auth = new Token<IS3Auth>('jupydrive-s3:auth-file-browser');

/**
 * Authentification file browser ID.
 */
export const AUTH_FILEBROWSER_ID = 'jupydrive-s3:auth-file-browser';

/**
 * The auth/credentials provider for the file browser.
 */
const authFileBrowser: JupyterFrontEndPlugin<IS3Auth> = SecretsManager.sign(
  AUTH_FILEBROWSER_ID,
  token => ({
    id: 'jupydrive-s3:auth-file-browser',
    description: 'The default file browser auth/credentials provider',
    requires: [ISettingRegistry, ISecretsManager],
    provides: IS3Auth,
    activate: (
      app: JupyterFrontEnd,
      settings: ISettingRegistry,
      secretsManager: ISecretsManager
    ): IS3Auth => {
      const secretFields: string[] = ['accessKeyId', 'secretAccessKey'];

      function loadCredentials(setting: ISettingRegistry.ISettings) {
        const bucket = setting.get('bucket').composite as string;
        const root = setting.get('root').composite as string;
        const endpoint = setting.get('endpoint').composite as string;
        const region = setting.get('region').composite as string;

        secretFields.forEach((key: string) => {
          const secretValue = setting.get(key).composite as string;
          // Save secret to secret manager.
          secretsManager.set(
            token,
            AUTH_FILEBROWSER_ID,
            AUTH_FILEBROWSER_ID + '::' + key,
            {
              namespace: AUTH_FILEBROWSER_ID,
              id: AUTH_FILEBROWSER_ID + '::' + key,
              value: secretValue
            }
          );
        });

        return {
          name: bucket,
          root: root,
          config: {
            forcePathStyle: true,
            endpoint: endpoint,
            region: region,
            credentials: {
              accessKeyId: '***',
              secretAccessKey: '***'
            }
          },
          secretsManager: secretsManager,
          token: token
        };
      }

      const attachSecretInput = (key: string) => {
        const input = document.getElementById(
          'jp-SettingsEditor-jupydrive-s3:auth-file-browser_' + key
        ) as HTMLInputElement;
        if (input) {
          input.type = 'password';
          secretsManager.attach(
            token,
            AUTH_FILEBROWSER_ID,
            AUTH_FILEBROWSER_ID + '::' + key,
            input
          );
        } else {
          setTimeout(() => attachSecretInput(key), 300);
        }
      };

      // Watch for DOM changes to make sure secret inputs are attached.
      const observer = new MutationObserver(() => {
        secretFields.forEach((key: string) => attachSecretInput(key));
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true
      });

      const getInitalSettings = async () => {
        // Read the inital credentials settings.
        const setting = await settings.load(authFileBrowser.id);
        const initial = loadCredentials(setting);
        if (initial.name !== '') {
          return initial;
        } else {
          return null;
        }
      };

      // Wait for the application to be restored and for the
      // settings of credentials to be loaded.
      Promise.all([app.restored, settings.load(authFileBrowser.id)]).then(
        ([_, settingCredentials]) => {
          // Listen for the plugin setting changes using Signal.
          settingCredentials.changed.connect(() => {
            const s3Config = loadCredentials(settingCredentials);

            // Connect to drive using new config.
            const S3Drive = new Drive({ ...s3Config, secretsManager, token });
            app.serviceManager.contents.addDrive(S3Drive);
          });
        }
      );

      return {
        factory: async () => {
          return (
            (await getInitalSettings()) ?? {
              name: process.env.JP_S3_BUCKET ?? 'jupyter-drives-test-bucket-1',
              root: process.env.JP_S3_ROOT ?? '',
              config: {
                forcePathStyle: true,
                endpoint:
                  process.env.JP_S3_ENDPOINT ?? 'https://example.com/s3',
                region: process.env.JP_S3_REGION ?? 'eu-west-1',
                credentials: {
                  accessKeyId:
                    process.env.JP_S3_ACCESS_KEY_ID ??
                    'abcdefghijklmnopqrstuvwxyz',
                  secretAccessKey:
                    process.env.JP_S3_SECRET_ACCESS_KEY ??
                    'SECRET123456789abcdefghijklmnopqrstuvwxyz'
                }
              }
            }
          );
        }
      };
    }
  })
);

/**
 * The default file browser factory provider.
 */
const defaultFileBrowser: JupyterFrontEndPlugin<IDefaultFileBrowser> = {
  id: 'jupydrive-s3:default-file-browser',
  description: 'The default file browser factory provider',
  provides: IDefaultFileBrowser,
  requires: [IFileBrowserFactory, IS3Auth, IStateDB, ISettingRegistry],
  optional: [IRouter, JupyterFrontEnd.ITreeResolver, ILabShell],
  activate: async (
    app: JupyterFrontEnd,
    fileBrowserFactory: IFileBrowserFactory,
    s3auth: IS3Auth,
    state: IStateDB,
    settings: ISettingRegistry,
    router: IRouter | null,
    tree: JupyterFrontEnd.ITreeResolver | null,
    labShell: ILabShell | null
  ): Promise<IDefaultFileBrowser> => {
    const { commands } = app;
    const auth = await s3auth.factory();
    // create S3 drive
    const S3Drive = new Drive({
      name: auth.name,
      root: auth.root,
      config: auth.config,
      secretsManager: auth.secretsManager,
      token: auth.token
    });

    app.serviceManager.contents.addDrive(S3Drive);

    // get registered file types
    S3Drive.getRegisteredFileTypes(app);

    // Manually restore and load the default file browser.
    const defaultBrowser = fileBrowserFactory.createFileBrowser(
      'drivebrowser',
      {
        auto: false,
        restore: false,
        driveName: S3Drive.name
      }
    );

    function loadSetting(setting: ISettingRegistry.ISettings): boolean {
      // Read the settings and convert to the correct type
      const bucketSwitching = setting.get('bucketSwitching')
        .composite as boolean;
      return bucketSwitching;
    }

    // Set attributes when adding the browser to the UI
    defaultBrowser.node.setAttribute('role', 'region');
    defaultBrowser.node.setAttribute('aria-label', 'Drive Browser Section');
    defaultBrowser.title.icon = folderIcon;

    // Show the current file browser shortcut in its title.
    const updateBrowserTitle = () => {
      const binding = app.commands.keyBindings.find(
        b => b.command === CommandIDs.toggleBrowser
      );
      if (binding) {
        const ks = binding.keys.map(CommandRegistry.formatKeystroke).join(', ');
        defaultBrowser.title.caption = 'Drive Browser (' + ks + ')';
      } else {
        defaultBrowser.title.caption = 'Drive Browser';
      }
    };
    updateBrowserTitle();
    app.commands.keyBindingChanged.connect(() => {
      updateBrowserTitle();
    });

    // Wait for the application to be restored and for the
    // settings and persistent state database to be loaded
    app.restored
      .then(() =>
        Promise.all([
          state.fetch(DRIVE_STATE_ID),
          settings.load(toolbarFileBrowser.id)
        ])
      )
      .then(([value, setting]) => {
        if (value) {
          const bucket = (value as ReadonlyPartialJSONObject)[
            'bucket'
          ] as string;
          const root = (value as ReadonlyPartialJSONObject)['root'] as string;

          // if values are stored, change bucket name and root
          S3Drive.name = bucket;
          S3Drive.root = root;
          app.serviceManager.contents.addDrive(S3Drive);
        }

        // Listen for the plugin setting changes using Signal.
        setting.changed.connect(loadSetting);

        // adding commands
        Private.addCommands(app, S3Drive, fileBrowserFactory, state, setting);
      });

    void Private.restoreBrowser(
      defaultBrowser,
      commands,
      router,
      tree,
      labShell
    );

    return defaultBrowser;
  }
};

/**
 * File browser toolbar buttons.
 */
const toolbarFileBrowser: JupyterFrontEndPlugin<void> = {
  id: 'jupydrive-s3:file-browser-toolbar',
  description: 'The toolbar for the drives file browser',
  requires: [
    IDefaultFileBrowser,
    IToolbarWidgetRegistry,
    ISettingRegistry,
    ITranslator,
    IFileBrowserFactory
  ],
  autoStart: true,
  activate: async (
    _: JupyterFrontEnd,
    fileBrowser: IDefaultFileBrowser,
    toolbarRegistry: IToolbarWidgetRegistry,
    settingsRegistry: ISettingRegistry,
    translator: ITranslator
  ): Promise<void> => {
    toolbarRegistry.addFactory(
      FILE_BROWSER_FACTORY,
      'uploaderTest',
      (fileBrowser: FileBrowser) =>
        new Uploader({ model: fileBrowser.model, translator })
    );

    toolbarRegistry.addFactory(
      FILE_BROWSER_FACTORY,
      'fileNameSearcherTest',
      (fileBrowser: FileBrowser) => {
        const searcher = FilenameSearcher({
          updateFilter: (
            filterFn: (item: string) => Partial<IScore> | null,
            query?: string
          ) => {
            fileBrowser.model.setFilter(value => {
              return filterFn(value.name.toLowerCase());
            });
          },
          useFuzzyFilter: true,
          placeholder: 'Filter files by names',
          forceRefresh: true
        });
        searcher.addClass(FILTERBOX_CLASS);
        return searcher;
      }
    );

    // connect the filebrowser toolbar to the settings registry for the plugin
    setToolbar(
      fileBrowser,
      createToolbarFactory(
        toolbarRegistry,
        settingsRegistry,
        FILE_BROWSER_FACTORY,
        FILE_BROWSER_PLUGIN_ID,
        translator
      )
    );
  }
};

/**
 * Export the plugins as default.
 */
const plugins: JupyterFrontEndPlugin<any>[] = [
  authFileBrowser,
  defaultFileBrowser,
  toolbarFileBrowser
];

export default plugins;

namespace Private {
  /**
   * Create the node for a switch drive handler.
   */
  const createSwitchDriveNode = (oldDriveName: string): HTMLElement => {
    const body = document.createElement('div');

    const existingLabel = document.createElement('label');
    existingLabel.textContent = 'Current Drive: ' + oldDriveName;

    const bucket = document.createElement('label');
    bucket.textContent = 'Switch to another Drive';
    bucket.className = SWITCH_DRIVE_TITLE_CLASS;
    const bucketName = document.createElement('input');

    const root = document.createElement('label');
    root.textContent = 'with root';
    root.className = SWITCH_DRIVE_TITLE_CLASS;
    const rootPath = document.createElement('input');

    body.appendChild(existingLabel);
    body.appendChild(bucket);
    body.appendChild(bucketName);
    body.appendChild(root);
    body.appendChild(rootPath);
    return body;
  };

  /**
   * Create the node for a copy to another bucket handler.
   */
  const createCopyToAnotherBucketNode = (): HTMLElement => {
    const body = document.createElement('div');

    const bucket = document.createElement('label');
    bucket.textContent = 'Copy to another Bucket';
    bucket.className = SWITCH_DRIVE_TITLE_CLASS;
    const bucketName = document.createElement('input');

    const root = document.createElement('label');
    root.textContent = 'Location within the Bucket';
    root.className = SWITCH_DRIVE_TITLE_CLASS;
    const rootPath = document.createElement('input');

    body.appendChild(bucket);
    body.appendChild(bucketName);
    body.appendChild(root);
    body.appendChild(rootPath);
    return body;
  };

  /**
   * A widget used to copy files or directories to another bucket.
   */
  export class CopyToAnotherBucket extends Widget {
    /**
     * Construct a new "copy-to-another-bucket" dialog.
     */
    constructor() {
      super({ node: createCopyToAnotherBucketNode() });
      this.onAfterAttach();
    }

    /**
     * The text input node for bucket name.
     */
    protected get bucketInput(): HTMLInputElement {
      return this.node.getElementsByTagName('input')[0] as HTMLInputElement;
    }
    /**
     * The text input node root directory.
     */
    protected get rootInput(): HTMLInputElement {
      return this.node.getElementsByTagName('input')[1] as HTMLInputElement;
    }

    protected onAfterAttach(): void {
      this.addClass(FILE_DIALOG_CLASS);
      const [bucket, root] = this.getValue();
      this.bucketInput.setSelectionRange(0, bucket.length);
      this.rootInput.setSelectionRange(0, root.length);
    }

    /**
     * Get the value of the widget.
     */
    getValue(): [bucket: string, root: string] {
      return [this.bucketInput.value, this.rootInput.value];
    }
  }

  /**
   * A widget used to switch to another drive.
   */
  export class SwitchDriveHandler extends Widget {
    /**
     * Construct a new "switch-drive" dialog.
     */
    constructor(oldDriveName: string) {
      super({ node: createSwitchDriveNode(oldDriveName) });
      this.onAfterAttach();
    }

    protected onAfterAttach(): void {
      this.addClass(FILE_DIALOG_CLASS);
      const bucket = this.bucketInput.value;
      this.bucketInput.setSelectionRange(0, bucket.length);
      const root = this.rootInput.value;
      this.rootInput.setSelectionRange(0, root.length);
    }

    /**
     * Get the input text node for bucket name.
     */
    get bucketInput(): HTMLInputElement {
      return this.node.getElementsByTagName('input')[0] as HTMLInputElement;
    }

    /**
     * Get the input text node for path to root.
     */
    get rootInput(): HTMLInputElement {
      return this.node.getElementsByTagName('input')[1] as HTMLInputElement;
    }

    /**
     * Get the value of the widget.
     */
    getValue(): string[] {
      return [this.bucketInput.value, this.rootInput.value];
    }
  }

  export function addCommands(
    app: JupyterFrontEnd,
    drive: Drive,
    factory: IFileBrowserFactory,
    state: IStateDB,
    settings: ISettingRegistry.ISettings
  ): void {
    const { tracker } = factory;

    app.commands.addCommand(CommandIDs.openSwitchDrive, {
      isVisible: () => {
        return (settings.get('bucketSwitching').composite as boolean) ?? false;
      },
      execute: async () => {
        return showDialog({
          body: new Private.SwitchDriveHandler(drive.name),
          focusNodeSelector: 'input',
          buttons: [
            Dialog.okButton({
              label: 'Switch Drive',
              ariaLabel: 'Switch to another Drive'
            })
          ]
        }).then(result => {
          if (result.value) {
            drive.name = result.value[0];
            drive.root = result.value[1];
            app.serviceManager.contents.addDrive(drive);

            // saving the new drive name to the persistent state database
            state.save(DRIVE_STATE_ID, {
              bucket: result.value[0],
              root: result.value[1]
            });
          }
        });
      },
      icon: DriveIcon.bindprops({ stylesheet: 'menuItem' })
    });

    app.commands.addCommand(CommandIDs.copyToAnotherBucket, {
      execute: async () => {
        return showDialog({
          body: new Private.CopyToAnotherBucket(),
          focusNodeSelector: 'input',
          buttons: [
            Dialog.okButton({
              label: 'Copy',
              ariaLabel: 'Copy to another Bucket'
            })
          ]
        }).then(result => {
          const widget = tracker.currentWidget;

          if (widget) {
            const path = widget
              .selectedItems()
              .next()!
              .value.path.split(':')[1];

            if (result.value) {
              drive.copyToAnotherBucket(path, result.value[1], result.value[0]);
            }
          }
        });
      },
      icon: DriveIcon.bindprops({ stylesheet: 'menuItem' }),
      label: 'Copy to another Bucket'
    });

    app.contextMenu.addItem({
      command: CommandIDs.copyToAnotherBucket,
      selector:
        '.jp-SidePanel .jp-DirListing-content .jp-DirListing-item[data-isDir]',
      rank: 10
    });

    app.commands.addCommand(CommandIDs.rename, {
      execute: args => {
        const widget = tracker.currentWidget;

        if (widget) {
          return widget.rename();
        }
      },
      isVisible: () =>
        // So long as this command only handles one file at time, don't show it
        // if multiple files are selected.
        !!tracker.currentWidget &&
        Array.from(tracker.currentWidget.selectedItems()).length === 1,
      isEnabled: () =>
        // Disable directory rename for S3 folders.
        !!tracker.currentWidget &&
        tracker.currentWidget?.selectedItems().next()!.value.type !==
          'directory',
      icon: editIcon.bindprops({ stylesheet: 'menuItem' }),
      label: 'Rename',
      mnemonic: 0
    });
  }

  /**
   * Restores file browser state and overrides state if tree resolver resolves.
   */
  export async function restoreBrowser(
    browser: FileBrowser,
    commands: CommandRegistry,
    router: IRouter | null,
    tree: JupyterFrontEnd.ITreeResolver | null,
    labShell: ILabShell | null
  ): Promise<void> {
    const restoring = 'jp-mod-restoring';

    browser.addClass(restoring);

    if (!router) {
      await browser.model.restore(browser.id);
      await browser.model.refresh();
      browser.removeClass(restoring);
      return;
    }

    const listener = async () => {
      router.routed.disconnect(listener);

      const paths = await tree?.paths;
      if (paths?.file || paths?.browser) {
        // Restore the model without populating it.
        await browser.model.restore(browser.id, false);
        if (paths.file) {
          await commands.execute(CommandIDs.openPath, {
            path: paths.file,
            dontShowBrowser: true
          });
        }
        if (paths.browser) {
          await commands.execute(CommandIDs.openPath, {
            path: paths.browser,
            dontShowBrowser: true
          });
        }
      } else {
        await browser.model.restore(browser.id);
        await browser.model.refresh();
      }
      browser.removeClass(restoring);

      if (labShell?.isEmpty('main')) {
        void commands.execute('launcher:create');
      }
    };
    router.routed.connect(listener);
  }
}
