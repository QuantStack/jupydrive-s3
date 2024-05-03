import { Signal, ISignal } from '@lumino/signaling';
import { Contents, ServerConnection } from '@jupyterlab/services';
import { URLExt } from '@jupyterlab/coreutils';

import {
  CopyObjectCommand,
  DeleteObjectCommand,
  S3Client,
  ListObjectsV2Command,
  GetBucketLocationCommand,
  GetObjectCommand,
  PutBucketCorsCommand,
  PutObjectCommand,
  HeadObjectCommand
} from '@aws-sdk/client-s3';

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
    this._serverSettings = ServerConnection.makeSettings();

    this._s3Client = new S3Client({});

    this._name = options.name;
    this._baseUrl = URLExt.join('https://s3.amazonaws.com/', this._name);
    this._provider = 'S3';

    this.getRegion().then((region: string) => {
      this._region = region!;
    });
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
   * The Drive base URL is set by the settingsRegistry change hook
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
   * The Drive region setter */
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
   * The Drive region setter */
  set creationDate(date: string) {
    this._creationDate = date;
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
  getDownloadUrl(path: string): Promise<string> {
    // Parse the path into user/repo/path
    return Promise.reject('Empty getDownloadUrl method');
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
      const content: Contents.IModel[] = [];

      const command = new ListObjectsV2Command({
        Bucket: this._name
      });

      let isTruncated: boolean | undefined = true;

      while (isTruncated) {
        const { Contents, IsTruncated, NextContinuationToken } =
          await this._s3Client.send(command);

        if (Contents) {
          Contents.forEach(c => {
            // checking if we are dealing with the file inside a folder
            if (c.Key!.split('/').length === 1 || c.Key!.split('/')[1] === '') {
              const [fileType, fileMimeType, fileFormat] = this.getFileType(
                c.Key!.split('.')[1]
              );

              content.push({
                name: !c.Key!.split('.')[1] ? c.Key!.slice(0, -1) : c.Key!,
                path: c.Key!,
                last_modified: c.LastModified!.toISOString(),
                created: '',
                content: !c.Key!.split('.')[1] ? [] : null,
                format: fileFormat as Contents.FileFormat,
                mimetype: fileMimeType,
                size: c.Size!,
                writable: true,
                type: fileType
              });
            }
          });
        }
        if (isTruncated) {
          isTruncated = IsTruncated;
        }
        command.input.ContinuationToken = NextContinuationToken;
      }

      data = {
        name: this._name,
        path: this._name,
        last_modified: '',
        created: '',
        content: content,
        format: 'json',
        mimetype: '',
        size: undefined,
        writable: true,
        type: 'directory'
      };
    } else {
      const splitPath = path.split('/');
      const currentPath = splitPath[splitPath.length - 1];

      // listing contents of a folder
      if (currentPath.indexOf('.') === -1) {
        const content: Contents.IModel[] = [];

        const command = new ListObjectsV2Command({
          Bucket: this._name,
          Prefix: currentPath + '/'
        });

        let isTruncated: boolean | undefined = true;

        while (isTruncated) {
          const { Contents, IsTruncated, NextContinuationToken } =
            await this._s3Client.send(command);

          if (Contents) {
            Contents.forEach(c => {
              // checking if we are dealing with the file inside a folder
              if (c.Key !== currentPath + '/') {
                const fileName = c.Key!.split('/')[1];
                const [fileType, fileMimeType, fileFormat] = this.getFileType(
                  c.Key!.split('.')[1]
                );

                content.push({
                  name: fileName,
                  path: path + '/' + fileName,
                  last_modified: c.LastModified!.toISOString(),
                  created: '',
                  content: !c.Key!.split('.')[1] ? [] : null,
                  format: fileFormat as Contents.FileFormat,
                  mimetype: fileMimeType,
                  size: c.Size!,
                  writable: true,
                  type: fileType
                });
              }
            });
          }
          if (isTruncated) {
            isTruncated = IsTruncated;
          }
          command.input.ContinuationToken = NextContinuationToken;
        }

        data = {
          name: currentPath,
          path: path + '/',
          last_modified: '',
          created: '',
          content: content,
          format: 'json',
          mimetype: '',
          size: undefined,
          writable: true,
          type: 'directory'
        };
      }
      // getting the contents of a specific file
      else {
        const command = new GetObjectCommand({
          Bucket: this._name,
          Key: path.replace(this._name + '/', '')
        });

        const response = await this._s3Client.send(command);

        if (response) {
          const fileContents: string = await response.Body!.transformToString();
          const date: string = response.LastModified!.toISOString();
          const [fileType, fileMimeType, fileFormat] = this.getFileType(
            currentPath.split('.')[1]
          );

          data = {
            name: currentPath,
            path: path,
            last_modified: date,
            created: '',
            content: fileContents,
            format: fileFormat as Contents.FileFormat,
            mimetype: fileMimeType,
            size: response.ContentLength!,
            writable: true,
            type: fileType
          };
        }
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
    const content: Contents.IModel[] = [];

    const command = new ListObjectsV2Command({
      Bucket: this._name
    });

    let isTruncated: boolean | undefined = true;

    while (isTruncated) {
      const { Contents, IsTruncated, NextContinuationToken } =
        await this._s3Client.send(command);

      if (Contents) {
        Contents.forEach(c => {
          const [fileType, fileMimeType, fileFormat] = this.getFileType(
            c.Key!.split('.')[1]
          );

          content.push({
            name: c.Key!,
            path: URLExt.join(this._name, c.Key!),
            last_modified: c.LastModified!.toISOString(),
            created: '',
            content: !c.Key!.split('.')[1] ? [] : null,
            format: fileFormat as Contents.FileFormat,
            mimetype: fileMimeType,
            size: c.Size!,
            writable: true,
            type: fileType
          });
        });
      }
      if (isTruncated) {
        isTruncated = IsTruncated;
      }
      command.input.ContinuationToken = NextContinuationToken;
    }

    const old_data: Contents.IModel = {
      name: this._name,
      path: '',
      last_modified: '',
      created: '',
      content: content,
      format: 'json',
      mimetype: '',
      size: undefined,
      writable: true,
      type: 'directory'
    };

    if (options.type !== undefined) {
      if (options.type !== 'directory') {
        const name = this.incrementUntitledName(old_data, options);
        const response = await this.s3Client.send(
          new PutObjectCommand({
            Bucket: this._name,
            Key: options.path ? options.path + '/' + name : name,
            Body: body
          })
        );
        console.log('NEW FILE, response: ', response);

        // retrieve information of old file
        const newFileContents = await this._s3Client.send(
          new GetObjectCommand({
            Bucket: this._name,
            Key: options.path ? options.path + '/' + name : name
          })
        );
        const [fileType, fileMimeType, fileFormat] = this.getFileType(
          options.ext!
        );

        data = {
          name: name,
          path: options.path + '/' + name,
          last_modified: newFileContents.LastModified!.toISOString(),
          created: Date(),
          content: body,
          format: fileFormat as Contents.FileFormat,
          mimetype: fileMimeType,
          size: newFileContents.ContentLength,
          writable: true,
          type: fileType
        };
      } else {
        // creating a new directory
        const name = this.incrementUntitledName(old_data, options);
        const response = await this.s3Client.send(
          new PutObjectCommand({
            Bucket: this._name,
            Key: options.path ? options.path + '/' + name + '/' : name + '/',
            Body: body
          })
        );
        console.log('NEW DIRECTORY, response: ', response);

        data = {
          name: name,
          path: options.path + '/' + name,
          last_modified: new Date().toISOString(),
          created: new Date().toISOString(),
          content: [],
          format: 'json',
          mimetype: 'text/directory',
          size: undefined,
          writable: true,
          type: options.type
        };
      }
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
    // check if we are dealing with a directory
    const info = await this.s3Client.send(
      new ListObjectsV2Command({
        Bucket: this._name,
        Prefix: localPath
      })
    );

    let isDir = 0;
    if (
      info.Contents!.length > 1 ||
      info.Contents![0].Key![info.Contents![0].Key!.length - 1] === '/'
    ) {
      localPath = localPath + '/';
      isDir = 1;
    }

    const response = await this.s3Client.send(
      new DeleteObjectCommand({
        Bucket: this._name,
        Key: localPath
      })
    );
    console.log('DELETE, response: ', response);

    // if we are dealing with a directory, delete files inside it
    if (isDir) {
      // get list of content from deleted directory
      const command = new ListObjectsV2Command({
        Bucket: this._name,
        Prefix: localPath
      });

      let isTruncated: boolean | undefined = true;

      while (isTruncated) {
        const { Contents, IsTruncated, NextContinuationToken } =
          await this._s3Client.send(command);

        if (Contents) {
          Contents.forEach(c => {
            this.delete_file(c.Key!);
          });
        }
        if (isTruncated) {
          isTruncated = IsTruncated;
        }
        command.input.ContinuationToken = NextContinuationToken;
      }
    }

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

    // check if we are dealing with a directory
    const info = await this.s3Client.send(
      new ListObjectsV2Command({
        Bucket: this._name,
        Prefix: oldLocalPath
      })
    );

    let isDir: boolean = false;
    if (
      info.Contents!.length > 1 ||
      info.Contents![0].Key![info.Contents![0].Key!.length - 1] === '/'
    ) {
      oldLocalPath = oldLocalPath + '/';
      newLocalPath = newLocalPath + '/';
      isDir = true;
    }

    // retrieve information of old file
    const fileContents = await this._s3Client.send(
      new GetObjectCommand({
        Bucket: this._name,
        Key: oldLocalPath
      })
    );

    // delete old object
    await this._s3Client.send(
      new DeleteObjectCommand({
        Bucket: this._name,
        Key: oldLocalPath
      })
    );

    // check if file with new name already exists
    try {
      await this._s3Client.send(
        new HeadObjectCommand({
          Bucket: this._name,
          Key: newLocalPath
        })
      );
      console.log('File name already exists!');
      newFileName = await this.incrementName(newLocalPath, isDir);
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

    const body = await fileContents.Body?.transformToString();

    // create new file with same content, but different name
    const response = await this.s3Client.send(
      new PutObjectCommand({
        Bucket: this._name,
        Key: newLocalPath,
        Body: body
      })
    );
    console.log('RENAME, response', response);

    // in the case of renaming a directory, move files to new location
    if (isDir) {
      // get list of content from old directory
      const command = new ListObjectsV2Command({
        Bucket: this._name,
        Prefix: oldLocalPath
      });

      let isTruncated: boolean | undefined = true;

      while (isTruncated) {
        const { Contents, IsTruncated, NextContinuationToken } =
          await this._s3Client.send(command);

        if (Contents) {
          Contents.forEach(c => {
            const fileName = c.Key!.split('/')[c.Key!.split.length - 1];
            this.copy_file(fileName, oldLocalPath, newLocalPath);
          });
        }
        if (isTruncated) {
          isTruncated = IsTruncated;
        }
        command.input.ContinuationToken = NextContinuationToken;
      }
    }
    const [fileType, fileMimeType, fileFormat] = this.getFileType(
      newFileName!.split('.')[1]
    );

    const data = {
      name: newFileName,
      path: newLocalPath,
      last_modified: fileContents.LastModified!.toISOString(),
      created: '',
      content: isDir ? [] : body,
      format: fileFormat as Contents.FileFormat,
      mimetype: fileMimeType,
      size: fileContents.ContentLength!,
      writable: true,
      type: fileType
    };

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
   * @param localPath - Path to file
   */
  async incrementName(localPath: string, isDir: boolean) {
    let counter: number = 0;
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

    const command = new ListObjectsV2Command({
      Bucket: this._name,
      Prefix: localPath.substring(0, localPath.lastIndexOf('/'))
    });

    let isTruncated: boolean | undefined = true;

    while (isTruncated) {
      const { Contents, IsTruncated, NextContinuationToken } =
        await this._s3Client.send(command);

      if (Contents) {
        Contents.forEach(c => {
          // check if we are dealing with a directory
          if (c.Key![c.Key!.length - 1] === '/') {
            c.Key! = c.Key!.substring(0, c.Key!.length - 1);
          }
          // check if the name of the file or directory matches the original name
          if (
            c
              .Key!.substring(
                c.Key!.lastIndexOf('/') + 1,
                c.Key!.lastIndexOf('/') + 1 + originalName.length
              )
              .includes(originalName)
          ) {
            counter += 1;
          }
        });
      }
      if (isTruncated) {
        isTruncated = IsTruncated;
      }
      command.input.ContinuationToken = NextContinuationToken;
    }

    let newName = counter ? originalName + counter : originalName;
    newName = isDir ? newName : newName + '.' + fileExtension;

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

    let body: string;
    if (options.format === 'json') {
      body = JSON.stringify(options?.content, null, 2);
    } else {
      body = options?.content;
    }

    // save file with new content by overwritting existing file
    const response = await this._s3Client.send(
      new PutObjectCommand({
        Bucket: this._name,
        Key: localPath,
        Body: body,
        CacheControl: 'no-cache'
      })
    );
    console.log('SAVE response: ', response);

    // retrieve information of file with new content
    const info = await this._s3Client.send(
      new GetObjectCommand({
        Bucket: this._name,
        Key: localPath
      })
    );

    const [fileType, fileMimeType, fileFormat] = this.getFileType(
      fileName.split('.')[1]
    );

    data = {
      name: fileName,
      path: localPath,
      last_modified: info.LastModified!.toISOString(),
      created: '',
      content: body,
      format: fileFormat as Contents.FileFormat,
      mimetype: fileMimeType,
      size: info.ContentLength!,
      writable: true,
      type: fileType
    };

    Contents.validateContentsModel(data);

    this._fileChanged.emit({
      type: 'save',
      oldValue: null,
      newValue: data
    });

    return data;
  }

  /**
   * Copy a file into a given directory.
   *
   * @param path - The original file path.
   *
   * @param isDir - The boolean marking if we are dealing with a file or directory.
   *
   * @returns A promise which resolves with the new name when the
   *  file is copied.
   */
  async incrementCopyName(copiedItemPath: string, isDir: boolean) {
    // extracting original file name
    const originalFileName =
      copiedItemPath.split('/')[copiedItemPath.split('/').length - 1];

    // constructing new file name and path with -Copy string
    const newFileName =
      originalFileName.split('.')[0] +
      '-Copy.' +
      originalFileName.split('.')[1];
    const newFilePath = isDir
      ? copiedItemPath.substring(0, copiedItemPath.lastIndexOf('/') + 1) +
        newFileName +
        '/'
      : copiedItemPath.substring(0, copiedItemPath.lastIndexOf('/') + 1) +
        newFileName;

    // getting incremented name of Copy in case of duplicates
    const incrementedName = await this.incrementName(newFilePath, isDir);

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
    // check if we are dealing with a directory
    const info = await this.s3Client.send(
      new ListObjectsV2Command({
        Bucket: this._name,
        Prefix: path
      })
    );

    let isDir: boolean = false;
    if (
      info.Contents!.length > 1 ||
      info.Contents![0].Key![info.Contents![0].Key!.length - 1] === '/'
    ) {
      isDir = true;
    }

    const newFileName = await this.incrementCopyName(path, isDir);

    const copy_response = await this._s3Client.send(
      new CopyObjectCommand({
        Bucket: this._name,
        CopySource: this._name + '/' + path,
        Key: toDir !== '' ? toDir + '/' + newFileName : newFileName
      })
    );
    console.log('COPY response: ', copy_response);

    // retrieve information of new file
    const newFileContents = await this._s3Client.send(
      new GetObjectCommand({
        Bucket: this._name,
        Key: toDir !== '' ? toDir + '/' + newFileName : newFileName
      })
    );
    const [fileType, fileMimeType, fileFormat] = this.getFileType(
      newFileName.split('.')[1]
    );

    data = {
      name: newFileName,
      path: toDir + '/' + newFileName,
      last_modified: newFileContents.LastModified!.toISOString(),
      created: new Date().toISOString(),
      content: await newFileContents.Body!.transformToString(),
      format: fileFormat as Contents.FileFormat,
      mimetype: fileMimeType,
      size: newFileContents.ContentLength!,
      writable: true,
      type: fileType
    };

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
   * @returns A promise which resolves with the new contents model when the
   *  file is copied.
   */
  async copyToAnotherBucket(
    path: string,
    toDir: string,
    bucketName: string,
    options: Contents.ICreateOptions = {}
  ): Promise<Contents.IModel> {
    // check if we are dealing with a directory
    const info = await this.s3Client.send(
      new ListObjectsV2Command({
        Bucket: this._name,
        Prefix: path
      })
    );

    let isDir: boolean = false;
    if (
      info.Contents!.length > 1 ||
      info.Contents![0].Key![info.Contents![0].Key!.length - 1] === '/'
    ) {
      isDir = true;
    }

    const newFileName = await this.incrementCopyName(path, isDir);

    // copy file to another bucket
    const copy_response = await this._s3Client.send(
      new CopyObjectCommand({
        Bucket: bucketName,
        CopySource: this._name + '/' + path,
        Key: toDir !== '' ? toDir + '/' + newFileName : newFileName
      })
    );
    console.log('COPY response: ', copy_response);

    // retrieve information of new file
    const newFileContents = await this._s3Client.send(
      new GetObjectCommand({
        Bucket: bucketName,
        Key: toDir !== '' ? toDir + '/' + newFileName : newFileName
      })
    );
    const [fileType, fileMimeType, fileFormat] = this.getFileType(
      newFileName.split('.')[1]
    );

    data = {
      name: newFileName,
      path: toDir + '/' + newFileName,
      last_modified: newFileContents.LastModified!.toISOString(),
      created: new Date().toISOString(),
      content: await newFileContents.Body!.transformToString(),
      format: fileFormat as Contents.FileFormat,
      mimetype: fileMimeType,
      size: newFileContents.ContentLength!,
      writable: true,
      type: fileType
    };

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
   * Set bucket CORS rules to allow the operations within the extension.
   * @param name bucket name
   */
  async setBucketCORS(name: string) {
    const response = await this.s3Client.send(
      new PutBucketCorsCommand({
        Bucket: name,
        CORSConfiguration: {
          CORSRules: [
            {
              AllowedHeaders: ['*'],
              AllowedMethods: ['GET', 'PUT', 'DELETE', 'HEAD'],
              // Allow only requests from the specified origin.
              AllowedOrigins: ['http://localhost:*'],
              // Allow the entity tag (ETag) header to be returned in the response. The ETag header
              // The entity tag represents a specific version of the object. The ETag reflects
              // changes only to the contents of an object, not its metadata.
              ExposeHeaders: ['ETag'],
              // How long the requesting browser should cache the preflight response. After
              // this time, the preflight request will have to be made again.
              MaxAgeSeconds: 3600
            }
          ]
        }
      })
    );
    console.log('SET BUCKET CORS, response: ', response);
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
    const region = response?.LocationConstraint as string;
    return region;
  }
  /**
   * Helping function for copying the files inside a directory
   * to a new location, in the case of renaming a directory.
   *
   * @param fileName name of file to be copied
   * @param oldPath old path of file
   * @param newPath new path of file
   */
  private async copy_file(fileName: string, oldPath: string, newPath: string) {
    const copy_response = await this._s3Client.send(
      new CopyObjectCommand({
        Bucket: this._name,
        CopySource: this._name + '/' + oldPath + fileName,
        Key: newPath + fileName
      })
    );
    console.log('RENAME, file inside directory copy resp: ', copy_response);
  }

  /**
   * Helping functions for deleting files inside
   * a directory, in the case of deleting the directory.
   *
   * @param filePath complete path of file to delete
   */
  private async delete_file(filePath: string) {
    const delete_response = await this.s3Client.send(
      new DeleteObjectCommand({
        Bucket: this._name,
        Key: filePath
      })
    );
    console.log('DELETE, file inside directory response: ', delete_response);
  }

  /**
   * Helping function to define file type, mimetype and format based on file extension.
   * @param extension file extension (e.g.: txt, ipynb, csv)
   * @returns
   */
  private getFileType(extension: string) {
    let fileType: string;
    let fileMimetype: string;
    let fileFormat: Contents.FileFormat = 'text';

    switch (extension) {
      case 'txt':
        fileType = 'text';
        fileMimetype = 'text/plain';
        break;
      case 'ipynb':
        fileType = 'notebook';
        fileMimetype = 'application/x-ipynb+json';
        break;
      case 'md':
        fileType = 'markdown';
        fileMimetype = 'text/markdown';
        break;
      case 'pdf':
        fileType = 'PDF';
        fileMimetype = 'application/pdf';
        break;
      case 'py':
        fileType = 'python';
        fileMimetype = 'text/x-python';
        break;
      case 'json':
        fileType = 'json';
        fileMimetype = 'application/json';
        break;
      case 'jsonl':
        fileType = 'jsonl';
        fileMimetype = 'test/jsonl';
        break;
      case 'ndjson':
        fileType = 'jsonl';
        fileMimetype = 'application/jsonl';
        break;
      case 'jl':
        fileType = 'julia';
        fileMimetype = 'text/x-julia';
        break;
      case 'csv':
        fileType = 'csv';
        fileMimetype = 'text/csv';
        break;
      case 'tsv':
        fileType = 'tsv';
        fileMimetype = 'text/csv';
        break;
      case 'R':
        fileType = 'r';
        fileMimetype = 'text/x-rsrc';
        break;
      case 'yaml':
        fileType = 'yaml';
        fileMimetype = 'text/x-yaml';
        break;
      case 'yml':
        fileType = 'yaml';
        fileMimetype = 'text/x-yaml';
        break;
      case 'svg':
        fileType = 'svg';
        fileMimetype = 'image/svg+xml';
        fileFormat = 'base64';
        break;
      case 'tif':
        fileType = 'tiff';
        fileMimetype = 'image/tiff';
        fileFormat = 'base64';
        break;
      case 'tiff':
        fileType = 'tiff';
        fileMimetype = 'image/tiff';
        fileFormat = 'base64';
        break;
      case 'jpg':
        fileType = 'jpeg';
        fileMimetype = 'image/jpeg';
        fileFormat = 'base64';
        break;
      case 'jpeg':
        fileType = 'jpeg';
        fileMimetype = 'image/jpeg';
        fileFormat = 'base64';
        break;
      case 'gif':
        fileType = 'gif';
        fileMimetype = 'image/gif';
        fileFormat = 'base64';
        break;
      case 'png':
        fileType = 'png';
        fileMimetype = 'image/png';
        fileFormat = 'base64';
        break;
      case 'bmp':
        fileType = 'bmp';
        fileMimetype = 'image/bmp';
        fileFormat = 'base64';
        break;
      case 'webp':
        fileType = 'webp';
        fileMimetype = 'image/webp';
        fileFormat = 'base64';
        break;
      case 'html':
        fileType = 'html';
        fileMimetype = 'text/html';
        break;
      case undefined:
        fileType = 'directory';
        fileMimetype = 'text/directory';
        fileFormat = 'json';
        break;
      default:
        fileType = 'text';
        fileMimetype = 'text/plain';
        break;
    }

    return [fileType, fileMimetype, fileFormat];
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
}

export namespace Drive {
  /**
   * The options used to initialize a `Drive`.
   */
  export interface IOptions {
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
