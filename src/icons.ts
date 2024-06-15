import { LabIcon } from '@jupyterlab/ui-components';
import driveSvg from '../style/driveIconFileBrowser.svg';
import newDriveSvg from '../style/newDriveIcon.svg';

export const DriveIcon = new LabIcon({
  name: '@jupyter/jupydrive-s3:drive',
  svgstr: driveSvg
});

export const NewDriveIcon = new LabIcon({
  name: '@jupyter/jupydrive-s3:new-drive',
  svgstr: newDriveSvg
});
