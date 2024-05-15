import {
  ILabShell,
  JupyterFrontEndPlugin,
  IRouter,
  JupyterFrontEnd
} from '@jupyterlab/application';
import { showDialog, Dialog } from '@jupyterlab/apputils';
import {
  IDefaultFileBrowser,
  IFileBrowserFactory,
  FileBrowser,
  Uploader
} from '@jupyterlab/filebrowser';

import {
  createToolbarFactory,
  IToolbarWidgetRegistry,
  setToolbar
} from '@jupyterlab/apputils';
import { ISettingRegistry } from '@jupyterlab/settingregistry';
import { ITranslator } from '@jupyterlab/translation';

import { CommandRegistry } from '@lumino/commands';
import { Widget } from '@lumino/widgets';
import { Drive } from './s3contents';

import { DriveIcon } from './icons';
import { FilenameSearcher, IScore } from '@jupyterlab/ui-components';

/**
 * The command IDs used to the filebrowser plugin.
 */
namespace CommandIDs {
  export const openPath = 'filebrowser:open-path';
  export const openChangeDrive = 'drives:open-change-drive-dialog';
  export const copyToAnotherBucket = 'drives:copy-to-another-bucket';
}

const FILE_BROWSER_FACTORY = 'DriveBrowser';
const FILE_BROWSER_PLUGIN_ID = 'jupyter-drives-browser:file-browser-toolbar';

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

// create S3 drive
const S3Drive = new Drive({
  name: 'jupyter-drives-test-bucket-1'
});

/**
 * The default file browser factory provider.
 */
export const defaultFileBrowser: JupyterFrontEndPlugin<IDefaultFileBrowser> = {
  id: 'jupyter-drives-browser:default-file-browser',
  description: 'The default file browser factory provider',
  provides: IDefaultFileBrowser,
  requires: [IFileBrowserFactory],
  optional: [IRouter, JupyterFrontEnd.ITreeResolver, ILabShell],
  activate: async (
    app: JupyterFrontEnd,
    fileBrowserFactory: IFileBrowserFactory,
    router: IRouter | null,
    tree: JupyterFrontEnd.ITreeResolver | null,
    labShell: ILabShell | null
  ): Promise<IDefaultFileBrowser> => {
    const { commands } = app;

    app.serviceManager.contents.addDrive(S3Drive);

    // Manually restore and load the default file browser.
    const defaultBrowser = fileBrowserFactory.createFileBrowser(
      'drivebrowser',
      {
        auto: false,
        restore: false,
        driveName: S3Drive.name
      }
    );

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

export const toolbarFileBrowser: JupyterFrontEndPlugin<void> = {
  id: 'jupyter-drives-browser:file-browser-toolbar',
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
    app: JupyterFrontEnd,
    fileBrowser: IDefaultFileBrowser,
    toolbarRegistry: IToolbarWidgetRegistry,
    settingsRegistry: ISettingRegistry,
    translator: ITranslator,
    factory: IFileBrowserFactory
  ): Promise<void> => {
    console.log(
      'jupyter-drives-browser:file-browser-toolbar pluging activated!'
    );

    const { tracker } = factory;

    // get registered file types
    S3Drive.getRegisteredFileTypes(app);

    // add the filebrowser model to the drive
    S3Drive.fileBrowserModel = fileBrowser.model;

    app.commands.addCommand(CommandIDs.openChangeDrive, {
      execute: () => {
        return showDialog({
          body: new SwitchDriveHandler(S3Drive.name),
          focusNodeSelector: 'input',
          buttons: [
            Dialog.okButton({
              label: 'Switch Drive',
              ariaLabel: 'Switch to another Drive'
            })
          ]
        }).then(result => {
          if (result.value) {
            S3Drive.name = result.value;
            app.serviceManager.contents.addDrive(S3Drive);
          }
        });
      },
      icon: DriveIcon.bindprops({ stylesheet: 'menuItem' })
    });

    app.commands.addCommand(CommandIDs.copyToAnotherBucket, {
      execute: async () => {
        return showDialog({
          body: new CopyToAnotherBucket(),
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
              S3Drive.copyToAnotherBucket(
                path,
                result.value[1],
                result.value[0]
              );
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
          placeholder: 'Filter files by namesss',
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
 * A widget used to switch to another drive.
 */
class SwitchDriveHandler extends Widget {
  /**
   * Construct a new "switch-drive" dialog.
   */
  constructor(oldDriveName: string) {
    super({ node: Private.createSwitchDriveNode(oldDriveName) });
    this.onAfterAttach();
  }

  protected onAfterAttach(): void {
    this.addClass(FILE_DIALOG_CLASS);
    const value = this.inputNode.value;
    this.inputNode.setSelectionRange(0, value.length);
  }

  /**
   * Get the input text node.
   */
  get inputNode(): HTMLInputElement {
    return this.node.getElementsByTagName('input')[0] as HTMLInputElement;
  }

  /**
   * Get the value of the widget.
   */
  getValue(): string {
    return this.inputNode.value;
  }
}

/**
 * A widget used to copy files or directories to another bucket.
 */
class CopyToAnotherBucket extends Widget {
  /**
   * Construct a new "copy-to-another-bucket" dialog.
   */
  constructor() {
    super({ node: Private.createCopyToAnotherBucketNode() });
    this.onAfterAttach();
  }

  protected onAfterAttach(): void {
    this.addClass(FILE_DIALOG_CLASS);
    const name = this.inputNameNode.value;
    this.inputNameNode.setSelectionRange(0, name.length);
    const location = this.inputLocationNode.value;
    this.inputLocationNode.setSelectionRange(0, location.length);
  }

  /**
   * Get the input text node for the bucket name.
   */
  get inputNameNode(): HTMLInputElement {
    return this.node.getElementsByTagName('input')[0] as HTMLInputElement;
  }

  /**
   * Get the input text node for the location within the bucket.
   */
  get inputLocationNode(): HTMLInputElement {
    return this.node.getElementsByTagName('input')[1] as HTMLInputElement;
  }

  /**
   * Get the value of the widget.
   */
  getValue(): string[] {
    return [this.inputNameNode.value, this.inputLocationNode.value];
  }
}

namespace Private {
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

  /**
   * Create the node for a switch drive handler.
   */
  export function createSwitchDriveNode(oldDriveName: string): HTMLElement {
    const body = document.createElement('div');
    const existingLabel = document.createElement('label');
    existingLabel.textContent = 'Current Drive';
    const existingName = document.createElement('span');
    existingName.textContent = oldDriveName;

    const nameTitle = document.createElement('label');
    nameTitle.textContent = 'Switch to another Drive';
    nameTitle.className = SWITCH_DRIVE_TITLE_CLASS;
    const name = document.createElement('input');

    body.appendChild(existingLabel);
    body.appendChild(existingName);
    body.appendChild(nameTitle);
    body.appendChild(name);
    return body;
  }

  /**
   * Create the node for a copy to another bucket handler.
   */
  export function createCopyToAnotherBucketNode(): HTMLElement {
    const body = document.createElement('div');

    const nameTitle = document.createElement('label');
    nameTitle.textContent = 'Copy to another Bucket';
    nameTitle.className = SWITCH_DRIVE_TITLE_CLASS;
    const name = document.createElement('input');

    const location = document.createElement('label');
    location.textContent = 'Location within the Bucket';
    location.className = SWITCH_DRIVE_TITLE_CLASS;
    const locationName = document.createElement('input');

    body.appendChild(nameTitle);
    body.appendChild(name);
    body.appendChild(location);
    body.appendChild(locationName);
    return body;
  }
}
