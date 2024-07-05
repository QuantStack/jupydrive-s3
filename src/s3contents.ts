import { Signal, ISignal } from '@lumino/signaling';
import { Contents, ServerConnection } from '@jupyterlab/services';
import { URLExt, PathExt } from '@jupyterlab/coreutils';
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
    const { config, name, root } = options;
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
    this.formatRoot(root ?? '').then((root: string) => {
      this._root = root;
    });
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
   * The Drive name setter
   */
  set name(name: string) {
    this._name = name;

    // if name of drive is changed, the filebrowser needs to refresh its contents
    // as we are switching to another bucket
    this._fileChanged.emit({
      type: 'new',
      oldValue: null,
      newValue: { path: '' }
    });
  }

  /**
   * The Drive root getter
   */
  get root(): string {
    return this._root;
  }

  /**
   * The Drive root setter
   */
  set root(root: string) {
    this.formatRoot(root ?? '').then(root => (this._root = root));
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

    // getting the list of files from the root
    if (!path) {
      data = await listS3Contents(
        this._s3Client,
        this._name,
        this._root,
        this._registeredFileTypes
      );
    } else {
      const currentPath = PathExt.basename(path);

      // listing contents of a folder
      if (PathExt.extname(currentPath) === '') {
        data = await listS3Contents(
          this._s3Client,
          this._name,
          this.root,
          this.registeredFileTypes,
          path
        );
      }
      // getting the contents of a specific file
      else {
        data = await getS3FileContents(
          this._s3Client,
          this._name,
          this._root,
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
    // get current list of contents of drive
    const old_data = await listS3Contents(
      this._s3Client,
      this._name,
      this._root,
      this.registeredFileTypes,
      options.path
    );

    if (options.type !== undefined) {
      // get incremented untitled name
      const name = this.incrementUntitledName(old_data, options);
      data = await createS3Object(
        this._s3Client,
        this._name,
        this._root,
        name,
        options.path ? PathExt.join(options.path, name) : name,
        '', // create new file with empty body,
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
    await deleteS3Objects(this._s3Client, this._name, this._root, localPath);

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
    let newFileName = PathExt.basename(newLocalPath);

    await checkS3Object(this._s3Client, this._name, this._root, newLocalPath)
      .then(async () => {
        console.log('File name already exists!');
        // construct new incremented name
        newFileName = await this.incrementName(newLocalPath, this._name);
      })
      .catch(() => {
        // function throws error as the file name doesn't exist
        console.log("Name doesn't exist!");
      })
      .finally(async () => {
        // once the name has been incremented if needed, proceed with the renaming
        data = await renameS3Objects(
          this._s3Client,
          this._name,
          this._root,
          oldLocalPath,
          newLocalPath,
          newFileName,
          this._registeredFileTypes
        );
      });

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
   * @param bucketName - The name of the bucket where content is moved.
   *
   * @param root - The root of the bucket, if it exists.
   */
  async incrementName(localPath: string, bucketName: string) {
    const isDir: boolean = PathExt.extname(localPath) === '';
    let fileExtension: string = '';
    let originalName: string = '';

    // check if we are dealing with a directory
    if (isDir) {
      localPath = localPath.substring(0, localPath.length - 1);
      originalName = PathExt.basename(localPath);
    }
    // dealing with a file
    else {
      // extract name from path
      originalName = PathExt.basename(localPath);
      // eliminate file extension
      fileExtension = PathExt.extname(originalName);
      originalName =
        originalName.split('.')[originalName.split('.').length - 2];
    }

    const counter = await countS3ObjectNameAppearances(
      this._s3Client,
      bucketName,
      this._root,
      localPath,
      originalName
    );
    let newName = counter ? originalName + counter : originalName;
    newName = isDir ? newName + '/' : newName + fileExtension;

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
    const fileName = PathExt.basename(localPath);

    data = await createS3Object(
      this._s3Client,
      this._name,
      this._root,
      fileName,
      localPath,
      options.content,
      this._registeredFileTypes,
      options
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
   * @param bucketName - The name of the bucket where content is moved.
   *
   * @returns A promise which resolves with the new name when the
   *  file is copied.
   */
  async incrementCopyName(copiedItemPath: string, bucketName: string) {
    const isDir: boolean = PathExt.extname(copiedItemPath) === '';

    // extracting original file name
    const originalFileName = PathExt.basename(copiedItemPath);

    // constructing new file name and path with -Copy string
    const newFileName = isDir
      ? originalFileName + '-Copy'
      : originalFileName.split('.')[0] +
        '-Copy.' +
        originalFileName.split('.')[1];

    const newFilePath =
      copiedItemPath.substring(0, copiedItemPath.lastIndexOf('/') + 1) +
      newFileName +
      (isDir ? '/' : '');

    // getting incremented name of Copy in case of duplicates
    const incrementedName = await this.incrementName(newFilePath, bucketName);

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
    // construct new file or directory name for the copy
    const newFileName = await this.incrementCopyName(path, this._name);

    data = await copyS3Objects(
      this._s3Client,
      this._name,
      this._root,
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
    // construct new file or directory name for the copy
    const newFileName = await this.incrementCopyName(path, bucketName);

    data = await copyS3Objects(
      this._s3Client,
      this._name,
      this._root,
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

  /**
   * Helping function which formats root by removing all leading or trailing
   * backslashes and checking if given path to directory exists.
   *
   * @param root
   * @returns formatted root
   */
  private async formatRoot(root: string) {
    // if root is empty, no formatting needed
    if (root === '') {
      return root;
    }

    // reformat the path to arbitrary root so it has no leading or trailing /
    root = PathExt.removeSlash(PathExt.normalize(root));
    // check if directory exists within bucket
    try {
      checkS3Object(this._s3Client, this._name, root);
      // the directory exists, root is formatted correctly
      return root;
    } catch (error) {
      console.log("Given path to root directory doesn't exist within bucket.");
      return '';
    }
  }

  private _serverSettings: ServerConnection.ISettings;
  private _s3Client: S3Client;
  private _name: string = '';
  private _root: string = '';
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
     * Path to directory from drive, which acts as root.
     */
    root: string;

    /**
     * The server settings for the server.
     */
    serverSettings?: ServerConnection.ISettings;
  }
}
