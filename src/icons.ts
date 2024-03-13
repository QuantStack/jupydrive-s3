import { LabIcon } from '@jupyterlab/ui-components';
import driveSvg from '../style/driveIconFileBrowser.svg';
import newDriveSvg from '../style/newDriveIcon.svg';

export const DriveIcon = new LabIcon({
  name: '@jupyter/jupyter-drives-browser:drive',
  svgstr: driveSvg
});

export const NewDriveIcon = new LabIcon({
  name: '@jupyter/jupyter-drives-browser:new-drive',
  svgstr: newDriveSvg
});
