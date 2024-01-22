import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';

/**
 * Initialization data for the jupyter-drives-browser extension.
 */
const plugin: JupyterFrontEndPlugin<void> = {
  id: 'jupyter-drives-browser:plugin',
  description: 'A JupyterLab extension which enables client-side drives access.',
  autoStart: true,
  activate: (app: JupyterFrontEnd) => {
    console.log('JupyterLab extension jupyter-drives-browser is activated!');
  }
};

export default plugin;
