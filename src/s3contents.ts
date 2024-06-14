import { Signal, ISignal } from '@lumino/signaling';
import { Contents, ServerConnection } from '@jupyterlab/services';
import { URLExt } from '@jupyterlab/coreutils';
import { JupyterFrontEnd } from '@jupyterlab/application';

import {
  S3Client,
  GetBucketLocationCommand,
  S3ClientConfig
} from '@aws-sdk/client-s3';

import {
  checkS3Object,
  createS3Object,
  copyS3Objects,
  countS3ObjectNameAppearances,
  deleteS3Objects,
  presignedS3Url,
  renameS3Objects,
  listS3Contents,
  IRegisteredFileTypes,
  getS3FileContents
} from './s3';

let data: Contents.IModel = {
  name: '',
  path: '',
  last_modified: '',
  created: '',
  content: null,
  format: null,
  mimetype: '',
  size: 0,
  writable: true,
  type: ''
};

export class Drive implements Contents.IDrive {
  /**
   * Construct a new drive object.
   *
   * @param options - The options used to initialize the object.
   */
  constructor(options: Drive.IOptions) {
    const { config, name } = options;
    this._serverSettings = ServerConnection.makeSettings();
    this._s3Client = new S3Client(config ?? {});
    this._name = name;
    this._baseUrl = URLExt.join(
      (config?.endpoint as string) ?? 'https://s3.amazonaws.com/',
      this._name
    );
    this._provider = 'S3';
    const region = config?.region;
    if (typeof region === 'string') {
      this._region = region;
    } else {
      const regionPromise = region ?? this.getRegion;
      regionPromise().then((region: string) => {
        this._region = region!;
      });
    }

    this._registeredFileTypes = {};
  }

  /**
   * The Drive S3 client
   */
  get s3Client(): S3Client {
    return this._s3Client;
  }

  /**
   * The Drive S3 client
   */
  set s3Client(s3Client: S3Client) {
    this._s3Client = s3Client;
  }

  /**
   * The Drive base URL
   */
  get baseUrl(): string {
    return this._baseUrl;
  }

  /**
   * The Drive base URL
   */
  set baseUrl(url: string) {
    this._baseUrl = url;
  }

  /**
   * The Drive name getter
   */
  get name(): string {
    return this._name;
  }

  /**
   * The Drive name setter */
  set name(name: string) {
    this._name = name;
  }

  /**
   * The Drive provider getter
   */
  get provider(): string {
    return this._provider;
  }

  /**
   * The Drive provider setter */
  set provider(name: string) {
    this._provider = name;
  }

  /**
   * The Drive region getter
   */
  get region(): string {
    return this._region;
  }

  /**
   * The Drive region setter
   */
  set region(region: string) {
    this._region = region;
  }

  /**
   * The Drive creationDate getter
   */
  get creationDate(): string {
    return this._creationDate;
  }

  /**
   * The Drive creationDate setter
   */
  set creationDate(date: string) {
    this._creationDate = date;
  }

  /**
   * The registered file types
   */
  get registeredFileTypes(): IRegisteredFileTypes {
    return this._registeredFileTypes;
  }

  /**
   * The registered file types
   */
  set registeredFileTypes(fileTypes: IRegisteredFileTypes) {
    this._registeredFileTypes = fileTypes;
  }

  /**
   * Settings for the notebook server.
   */
  get serverSettings(): ServerConnection.ISettings {
    return this._serverSettings;
  }

  /**
   * A signal emitted when a file operation takes place.
   */
  get fileChanged(): ISignal<this, Contents.IChangedArgs> {
    return this._fileChanged;
  }

  /**
   * Test whether the manager has been disposed.
   */
  get isDisposed(): boolean {
    return this._isDisposed;
  }

  /**
   * A signal emitted when the drive is disposed.
   */
  get disposed(): ISignal<this, void> {
    return this._disposed;
  }

  /**
   * Dispose of the resources held by the manager.
   */
  dispose(): void {
    if (this.isDisposed) {
      return;
    }
    this._isDisposed = true;
    this._disposed.emit();
    Signal.clearData(this);
  }

  /**
   * Get an encoded download url given a file path.
   *
   * @param path - An absolute POSIX file path on the server.
   *
   * #### Notes
   * It is expected that the path contains no relative paths,
   * use [[ContentsManager.getAbsolutePath]] to get an absolute
   * path if necessary.
   */
  async getDownloadUrl(path: string): Promise<string> {
    const url = await presignedS3Url(this._s3Client, this._name, path);
    return url;
  }

  /**
   * Get a file or directory.
   *
   * @param localPath: The path to the file.
   *
   * @param options: The options used to fetch the file.
   *
   * @returns A promise which resolves with the file content.
   *
   * Uses the [Jupyter Notebook API](https://petstore.swagger.io/?url=https://raw.githubusercontent.com/jupyter-server/jupyter_server/main/jupyter_server/services/api/api.yaml#!/contents) and validates the response model.
   */
  async get(
    path: string,
    options?: Contents.IFetchOptions
  ): Promise<Contents.IModel> {
    path = path.replace(this._name + '/', '');

    // check if we are getting the list of files from the drive
    if (!path) {
      // TO DO: replace '' with root variable
      data = await listS3Contents(
        this._s3Client,
        this._name,
        '',
        this._registeredFileTypes
      );
    } else {
      const splitPath = path.split('/');
      const currentPath = splitPath[splitPath.length - 1];

      // listing contents of a folder
      if (currentPath.indexOf('.') === -1) {
        data = await listS3Contents(
          this._s3Client,
          this._name,
          path + '/',
          this.registeredFileTypes
        );
      }
      // getting the contents of a specific file
      else {
        data = await getS3FileContents(
          this._s3Client,
          this._name,
          path,
          this.registeredFileTypes
        );
      }
    }

    Contents.validateContentsModel(data);
    return data;
  }

  /**
   * Create a new untitled file or directory in the specified directory path.
   *
   * @param options: The options used to create the file.
   *
   * @returns A promise which resolves with the created file content when the
   *    file is created.
   */
  async newUntitled(
    options: Contents.ICreateOptions = {}
  ): Promise<Contents.IModel> {
    const body = '';

    // get current list of contents of drive
    const old_data = await listS3Contents(
      this._s3Client,
      this._name,
      '',
      this.registeredFileTypes
    );

    if (options.type !== undefined) {
      // get incremented untitled name
      const name = this.incrementUntitledName(old_data, options);
      data = await createS3Object(
        this._s3Client,
        this._name,
        name,
        options.path as string,
        body,
        options,
        this.registeredFileTypes
      );
    } else {
      console.warn('Type of new element is undefined');
    }

    Contents.validateContentsModel(data);
    this._fileChanged.emit({
      type: 'new',
      oldValue: null,
      newValue: data
    });

    return data;
  }

  incrementUntitledName(
    contents: Contents.IModel,
    options: Contents.ICreateOptions
  ): string {
    const content: Array<Contents.IModel> = contents.content;
    let name: string = '';
    let countText = 0;
    let countDir = 0;
    let countNotebook = 0;
    if (options.type === 'notebook') {
      options.ext = 'ipynb';
    }

    content.forEach(item => {
      if (options.ext !== undefined) {
        if (item.name.includes('untitled') && item.name.includes('.txt')) {
          countText = countText + 1;
        } else if (
          item.name.includes('Untitled') &&
          item.name.includes('.ipynb')
        ) {
          countNotebook = countNotebook + 1;
        }
      } else if (item.name.includes('Untitled Folder')) {
        countDir = countDir + 1;
      }
    });

    if (options.ext === 'txt') {
      if (countText === 0) {
        name = 'untitled' + '.' + options.ext;
      } else {
        name = 'untitled' + countText + '.' + options.ext;
      }
    }
    if (options.ext === 'ipynb') {
      if (countNotebook === 0) {
        name = 'Untitled' + '.' + options.ext;
      } else {
        name = 'Untitled' + countNotebook + '.' + options.ext;
      }
    } else if (options.type === 'directory') {
      if (countDir === 0) {
        name = 'Untitled Folder';
      } else {
        name = 'Untitled Folder ' + countDir;
      }
    }
    return name;
  }

  /**
   * Delete a file.
   *
   * @param path - The path to the file.
   *
   * @returns A promise which resolves when the file is deleted.
   */
  async delete(localPath: string): Promise<void> {
    await deleteS3Objects(this._s3Client, this._name, localPath);

    this._fileChanged.emit({
      type: 'delete',
      oldValue: { path: localPath },
      newValue: { path: undefined }
    });
  }

  /**
   * Rename a file or directory.
   *
   * @param oldLocalPath - The original file path.
   *
   * @param newLocalPath - The new file path.
   *
   * @returns A promise which resolves with the new file contents model when
   *   the file is renamed.
   *
   * #### Notes
   * Uses the [Jupyter Notebook API](https://petstore.swagger.io/?url=https://raw.githubusercontent.com/jupyter-server/jupyter_server/main/jupyter_server/services/api/api.yaml#!/contents) and validates the response model.
   */
  async rename(
    oldLocalPath: string,
    newLocalPath: string,
    options: Contents.ICreateOptions = {}
  ): Promise<Contents.IModel> {
    let newFileName =
      newLocalPath.indexOf('/') >= 0
        ? newLocalPath.split('/')[newLocalPath.split('/').length - 1]
        : newLocalPath;

    const isDir: boolean = oldLocalPath.split('.').length === 1;

    // check if file with new name already exists
    try {
      checkS3Object(this._s3Client, this._name, newLocalPath);
      console.log('File name already exists!');
      // construct new incremented name and it's corresponding path
      newFileName = await this.incrementName(newLocalPath, isDir, this._name);
      if (isDir) {
        newLocalPath = newLocalPath.substring(0, newLocalPath.length - 1);
      }
      newLocalPath = isDir
        ? newLocalPath.substring(0, newLocalPath.lastIndexOf('/') + 1) +
          newFileName +
          '/'
        : newLocalPath.substring(0, newLocalPath.lastIndexOf('/') + 1) +
          newFileName;
    } catch (e) {
      // function throws error as the file name doesn't exist
      console.log("Name doesn't exist!");
    }

    renameS3Objects(
      this._s3Client,
      this._name,
      oldLocalPath,
      newLocalPath,
      newFileName,
      this._registeredFileTypes
    );

    this._fileChanged.emit({
      type: 'rename',
      oldValue: { path: oldLocalPath },
      newValue: data
    });
    Contents.validateContentsModel(data);
    return data;
  }

  /**
   * Helping function to increment name of existing files or directorties.
   *
   * @param localPath - Path to file.
   *
   * @param isDir - Whether the content is a directory or a file.
   *
   * @param bucketName - The name of the bucket where content is moved.
   */
  async incrementName(localPath: string, isDir: boolean, bucketName: string) {
    let fileExtension: string = '';
    let originalName: string = '';

    // check if we are dealing with a directory
    if (isDir) {
      localPath = localPath.substring(0, localPath.length - 1);
      originalName = localPath.split('/')[localPath.split('/').length - 1];
    }
    // dealing with a file
    else {
      // extract name from path
      originalName = localPath.split('/')[localPath.split('/').length - 1];
      // eliminate file extension
      fileExtension =
        originalName.split('.')[originalName.split('.').length - 1];
      originalName =
        originalName.split('.')[originalName.split('.').length - 2];
    }

    const counter = await countS3ObjectNameAppearances(
      this._s3Client,
      this._name,
      localPath,
      originalName
    );
    let newName = counter ? originalName + counter : originalName;
    newName = isDir ? newName + '/' : newName + '.' + fileExtension;

    return newName;
  }

  /**
   * Save a file.
   *
   * @param localPath - The desired file path.
   *
   * @param options - Optional overrides to the model.
   *
   * @returns A promise which resolves with the file content model when the
   *   file is saved.
   *
   * #### Notes
   * Ensure that `model.content` is populated for the file.
   *
   * Uses the [Jupyter Notebook API](https://petstore.swagger.io/?url=https://raw.githubusercontent.com/jupyter-server/jupyter_server/main/jupyter_server/services/api/api.yaml#!/contents) and validates the response model.
   */
  async save(
    localPath: string,
    options: Partial<Contents.IModel> = {}
  ): Promise<Contents.IModel> {
    const fileName =
      localPath.indexOf('/') === -1
        ? localPath
        : localPath.split('/')[localPath.split.length - 1];

    data = await createS3Object(
      this._s3Client,
      this._name,
      fileName,
      localPath,
      options.content,
      options,
      this._registeredFileTypes
    );

    this._fileChanged.emit({
      type: 'save',
      oldValue: null,
      newValue: data
    });
    Contents.validateContentsModel(data);
    return data;
  }

  /**
   * Copy a file into a given directory.
   *
   * @param path - The original file path.
   *
   * @param isDir - The boolean marking if we are dealing with a file or directory.
   *
   * @param bucketName - The name of the bucket where content is moved.
   *
   * @returns A promise which resolves with the new name when the
   *  file is copied.
   */
  async incrementCopyName(
    copiedItemPath: string,
    isDir: boolean,
    bucketName: string
  ) {
    // extracting original file name
    const originalFileName =
      copiedItemPath.split('/')[copiedItemPath.split('/').length - 1];

    // constructing new file name and path with -Copy string
    const newFileName = isDir
      ? originalFileName + '-Copy'
      : originalFileName.split('.')[0] +
        '-Copy.' +
        originalFileName.split('.')[1];

    const newFilePath = isDir
      ? copiedItemPath.substring(0, copiedItemPath.lastIndexOf('/') + 1) +
        newFileName +
        '/'
      : copiedItemPath.substring(0, copiedItemPath.lastIndexOf('/') + 1) +
        newFileName;

    // getting incremented name of Copy in case of duplicates
    const incrementedName = await this.incrementName(
      newFilePath,
      isDir,
      bucketName
    );

    return incrementedName;
  }

  /**
   * Copy a file into a given directory.
   *
   * @param path - The original file path.
   *
   * @param toDir - The destination directory path.
   *
   * @returns A promise which resolves with the new contents model when the
   *  file is copied.
   */
  async copy(
    path: string,
    toDir: string,
    options: Contents.ICreateOptions = {}
  ): Promise<Contents.IModel> {
    const isDir: boolean = path.split('.').length === 1;

    // construct new file or directory name for the copy
    let newFileName = await this.incrementCopyName(path, isDir, this._name);
    newFileName = toDir !== '' ? toDir + '/' + newFileName : newFileName;
    path = isDir ? path + '/' : path;

    data = await copyS3Objects(
      this._s3Client,
      this._name,
      newFileName,
      path,
      toDir,
      this._registeredFileTypes
    );

    this._fileChanged.emit({
      type: 'new',
      oldValue: null,
      newValue: data
    });
    Contents.validateContentsModel(data);
    return data;
  }

  /**
   * Copy a file into another bucket.
   *
   * @param path - The original file path.
   *
   * @param toDir - The destination directory path.
   *
   * @param bucketName - The name of the bucket where content is moved.
   *
   * @returns A promise which resolves with the new contents model when the
   *  file is copied.
   */
  async copyToAnotherBucket(
    path: string,
    toDir: string,
    bucketName: string,
    options: Contents.ICreateOptions = {}
  ): Promise<Contents.IModel> {
    path =
      path[path.length - 1] === '/' ? path.substring(0, path.length - 1) : path;

    const isDir: boolean = path.split('.').length === 1;

    // construct new file or directory name for the copy
    let newFileName = await this.incrementCopyName(path, isDir, bucketName);
    newFileName = toDir !== '' ? toDir + '/' + newFileName : newFileName;
    path = isDir ? path + '/' : path;

    data = await copyS3Objects(
      this._s3Client,
      this._name,
      newFileName,
      path,
      toDir,
      this._registeredFileTypes,
      bucketName
    );

    this._fileChanged.emit({
      type: 'new',
      oldValue: null,
      newValue: data
    });
    Contents.validateContentsModel(data);
    return data;
  }

  /**
   * Create a checkpoint for a file.
   *
   * @param path - The path of the file.
   *
   * @returns A promise which resolves with the new checkpoint model when the
   *   checkpoint is created.
   */
  async createCheckpoint(path: string): Promise<Contents.ICheckpointModel> {
    const emptyCheckpoint: Contents.ICheckpointModel = {
      id: '',
      last_modified: ''
    };
    return Promise.resolve(emptyCheckpoint);
  }

  /**
   * List available checkpoints for a file.
   *
   * @param path - The path of the file.
   *
   * @returns A promise which resolves with a list of checkpoint models for
   *    the file.
   */
  listCheckpoints(path: string): Promise<Contents.ICheckpointModel[]> {
    return Promise.resolve([]);
  }

  /**
   * Restore a file to a known checkpoint state.
   *
   * @param path - The path of the file.
   *
   * @param checkpointID - The id of the checkpoint to restore.
   *
   * @returns A promise which resolves when the checkpoint is restored.
   */
  restoreCheckpoint(path: string, checkpointID: string): Promise<void> {
    return Promise.reject('Repository is read only');
  }

  /**
   * Delete a checkpoint for a file.
   *
   * @param path - The path of the file.
   *
   * @param checkpointID - The id of the checkpoint to delete.
   *
   * @returns A promise which resolves when the checkpoint is deleted.
   */
  deleteCheckpoint(path: string, checkpointID: string): Promise<void> {
    return Promise.reject('Read only');
  }

  /**
   * Helping function for extracting region of bucket.
   * @returns region of Bucket
   */
  private async getRegion() {
    const response = await this._s3Client.send(
      new GetBucketLocationCommand({
        Bucket: this._name
      })
    );
    return (response?.LocationConstraint as string) ?? '';
  }

  /**
   * Get all registered file types and store them accordingly with their file
   * extension (e.g.: .txt, .pdf, .jpeg), file mimetype (e.g.: text/plain, application/pdf)
   * and file format (e.g.: base64, text).
   *
   * @param app
   */
  getRegisteredFileTypes(app: JupyterFrontEnd) {
    // get called when instating the toolbar
    const registeredFileTypes = app.docRegistry.fileTypes();

    for (const fileType of registeredFileTypes) {
      // check if we are dealing with a directory
      if (fileType.extensions.length === 0) {
        this._registeredFileTypes[''] = {
          fileType: 'directory',
          fileFormat: 'json',
          fileMimeTypes: ['text/directory']
        };
      }

      // store the mimetype and fileformat for each file extension
      fileType.extensions.forEach(extension => {
        extension = extension.split('.')[1];
        if (!this._registeredFileTypes[extension]) {
          this._registeredFileTypes[extension] = {
            fileType: fileType.name,
            fileMimeTypes: [...fileType.mimeTypes],
            fileFormat: fileType.fileFormat ? fileType.fileFormat : ''
          };
        }
      });
    }
  }

  private _serverSettings: ServerConnection.ISettings;
  private _s3Client: S3Client;
  private _name: string = '';
  private _provider: string = '';
  private _baseUrl: string = '';
  private _region: string = '';
  private _creationDate: string = '';
  private _fileChanged = new Signal<this, Contents.IChangedArgs>(this);
  private _isDisposed: boolean = false;
  private _disposed = new Signal<this, void>(this);
  private _registeredFileTypes: IRegisteredFileTypes = {};
}

export namespace Drive {
  /**
   * The options used to initialize a `Drive`.
   */
  export interface IOptions {
    /**
     * S3 client configuration if available
     */
    config?: S3ClientConfig;

    /**
     * The name for the `Drive`, which is used in file
     * paths to disambiguate it from other drives.
     */
    name: string;

    /**
     * The server settings for the server.
     */
    serverSettings?: ServerConnection.ISettings;
  }
}
