import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';

import { defaultFileBrowser } from './filebrowser';

/**
 * Initialization data for the jupyter-drives-browser extension.
 */
const defaultPlugin: JupyterFrontEndPlugin<void> = {
  id: 'jupyter-drives-browser:plugin',
  description:
    'A JupyterLab extension which enables client-side drives access.',
  autoStart: true,
  activate: (app: JupyterFrontEnd) => {
    console.log('JupyterLab extension jupyter-drives-browser is activated!');
  }
};

/**
 * Export the plugins as default.
 */
const plugins: JupyterFrontEndPlugin<any>[] = [
  defaultFileBrowser,
  defaultPlugin
];

export default plugins;
