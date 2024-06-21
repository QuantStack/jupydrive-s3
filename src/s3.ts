import { Contents } from '@jupyterlab/services';
import { PathExt } from '@jupyterlab/coreutils';
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  GetObjectCommand,
  PutObjectCommand,
  HeadObjectCommand,
  HeadObjectCommandOutput,
  S3Client
} from '@aws-sdk/client-s3';

import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export interface IRegisteredFileTypes {
  [fileExtension: string]: {
    fileType: string;
    fileMimeTypes: string[];
    fileFormat: string;
  };
}

interface IContentsList {
  [fileName: string]: Contents.IModel;
}

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

/**
 * Get the presigned URL for an S3 object.
 *
 * @param s3Client: The S3Client used to send commands.
 * @param bucketName: The name of bucket.
 * @param path: The path to the object.
 *
 * @returns: A promise which resolves with presigned URL.
 */
export const presignedS3Url = async (
  s3Client: S3Client,
  bucketName: string,
  path: string
): Promise<string> => {
  // retrieve object from S3 bucket
  const getCommand = new GetObjectCommand({
    Bucket: bucketName,
    Key: path,
    ResponseContentDisposition: 'attachment',
    ResponseContentType: 'application/octet-stream'
  });
  await s3Client.send(getCommand);

  // get pre-signed URL of S3 file
  const presignedUrl = await getSignedUrl(s3Client, getCommand);
  return presignedUrl;
};

/**
 * Get list of contents of root or directory.
 *
 * @param s3Client: The S3Client used to send commands.
 * @param bucketName: The bucket name.
 * @param root: The path to the directory acting as root.
 * @param registeredFileTypes: The list containing all registered file types.
 * @param path: The path to the directory (optional).
 *
 * @returns: A promise which resolves with the contents model.
 */
export const listS3Contents = async (
  s3Client: S3Client,
  bucketName: string,
  root: string,
  registeredFileTypes: IRegisteredFileTypes,
  path?: string
): Promise<Contents.IModel> => {
  const fileList: IContentsList = {};

  // listing contents of folder
  const command = new ListObjectsV2Command({
    Bucket: bucketName,
    Prefix: path ? PathExt.join(root, path) : root
  });

  let isTruncated: boolean | undefined = true;

  while (isTruncated) {
    const { Contents, IsTruncated, NextContinuationToken } =
      await s3Client.send(command);

    if (Contents) {
      Contents.forEach(c => {
        // check if we are dealing with the files inside a subfolder
        if (
          c.Key !== root + '/' &&
          c.Key !== path + '/' &&
          c.Key !== root + '/' + path + '/'
        ) {
          const fileName = c
            .Key!.replace(
              (root ? root + '/' : '') + (path ? path + '/' : ''),
              ''
            )
            .split('/')[0];
          const [fileType, fileMimeType, fileFormat] = Private.getFileType(
            PathExt.extname(PathExt.basename(fileName)),
            registeredFileTypes
          );

          fileList[fileName] = fileList[fileName] ?? {
            name: fileName,
            path: path ? PathExt.join(path, fileName) : fileName,
            last_modified: c.LastModified!.toISOString(),
            created: '',
            content: !fileName.split('.')[1] ? [] : null,
            format: fileFormat as Contents.FileFormat,
            mimetype: fileMimeType,
            size: c.Size!,
            writable: true,
            type: fileType
          };
        }
      });
    }
    if (isTruncated) {
      isTruncated = IsTruncated;
    }
    command.input.ContinuationToken = NextContinuationToken;
  }

  data = {
    name: path ? PathExt.basename(path) : bucketName,
    path: path ? path + '/' : bucketName,
    last_modified: '',
    created: '',
    content: Object.values(fileList),
    format: 'json',
    mimetype: '',
    size: undefined,
    writable: true,
    type: 'directory'
  };

  return data;
};

/**
 * Retrieve contents of a file.
 *
 * @param s3Client: The S3Client used to send commands.
 * @param bucketName: The bucket name.
 * @param root: The path to the directory acting as root.
 * @param path: The path to to file.
 * @param registeredFileTypes: The list containing all registered file types.
 *
 * @returns: A promise which resolves with the file contents model.
 */
export const getS3FileContents = async (
  s3Client: S3Client,
  bucketName: string,
  root: string,
  path: string,
  registeredFileTypes: IRegisteredFileTypes
): Promise<Contents.IModel> => {
  // retrieving contents and metadata of file
  const command = new GetObjectCommand({
    Bucket: bucketName,
    Key: PathExt.join(root, path)
  });

  const response = await s3Client.send(command);

  if (response) {
    const date: string = response.LastModified!.toISOString();
    const [fileType, fileMimeType, fileFormat] = Private.getFileType(
      PathExt.extname(PathExt.basename(path)),
      registeredFileTypes
    );

    let fileContents: string | Uint8Array;

    // for certain media type files, extract content as byte array and decode to base64 to view in JupyterLab
    if (fileFormat === 'base64' || fileType === 'PDF') {
      fileContents = await response.Body!.transformToByteArray();
      fileContents = btoa(
        fileContents.reduce(
          (data, byte) => data + String.fromCharCode(byte),
          ''
        )
      );
    } else {
      fileContents = await response.Body!.transformToString();
    }

    data = {
      name: PathExt.basename(path),
      path: PathExt.join(root, path),
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

  return data;
};

/**
 * Create a new file or directory or save a file.
 *
 * When saving a file, the options parameter is needed.
 *
 * @param s3Client: The S3Client used to send commands.
 * @param bucketName: The bucket name.
 * @param root: The path to the directory acting as root.
 * @param name: The name of file or directory to be created or saved.
 * @param path: The path to to file or directory.
 * @param body: The new contents of the file.
 * @param registeredFileTypes: The list containing all registered file types.
 * @param options: The optional parameteres of saving a file or directory (optional).
 *
 * @returns A promise which resolves with the new file or directory contents model.
 */
export const createS3Object = async (
  s3Client: S3Client,
  bucketName: string,
  root: string,
  name: string,
  path: string,
  body: string | Blob,
  registeredFileTypes: IRegisteredFileTypes,
  options?: Partial<Contents.IModel>
): Promise<Contents.IModel> => {
  path = PathExt.join(root, path);

  const [fileType, fileMimeType, fileFormat] = Private.getFileType(
    PathExt.extname(PathExt.basename(name)),
    registeredFileTypes
  );

  // checking if we are creating a new file or saving an existing one (overwrriting)
  if (options) {
    body = Private.formatBody(options, fileFormat, fileType, fileMimeType);
  }

  await s3Client.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: path + (PathExt.extname(name) === '' ? '/' : ''),
      Body: body,
      CacheControl: options ? 'no-cache' : undefined
    })
  );

  data = {
    name: name,
    path: PathExt.join(path, name),
    last_modified: new Date().toISOString(),
    created: new Date().toISOString(),
    content: path.split('.').length === 1 ? [] : body,
    format: fileFormat as Contents.FileFormat,
    mimetype: fileMimeType,
    size: typeof body === 'string' ? body.length : body.size,
    writable: true,
    type: fileType
  };

  return data;
};

/**
 * Deleting a file or directory.
 *
 * @param s3Client: The S3Client used to send commands.
 * @param bucketName: The bucket name.
 * @param root: The path to the directory acting as root.
 * @param path: The path to to file or directory.
 */
export const deleteS3Objects = async (
  s3Client: S3Client,
  bucketName: string,
  root: string,
  path: string
): Promise<void> => {
  path = PathExt.join(root, path);

  // get list of contents with given prefix (path)
  const command = new ListObjectsV2Command({
    Bucket: bucketName,
    Prefix: PathExt.extname(path) === '' ? path + '/' : path
  });

  let isTruncated: boolean | undefined = true;

  while (isTruncated) {
    const { Contents, IsTruncated, NextContinuationToken } =
      await s3Client.send(command);

    if (Contents) {
      await Promise.all(
        Contents.map(c => {
          // delete each file with given path
          Private.deleteFile(s3Client, bucketName, c.Key!);
        })
      );
    }
    if (isTruncated) {
      isTruncated = IsTruncated;
    }
    command.input.ContinuationToken = NextContinuationToken;
  }
};

/**
 * Check whether an object (file or directory) exists within given S3 bucket.
 *
 * Used before renaming a file to avoid overwriting and when setting the root.
 *
 * @param s3Client: The S3Client used to send commands.
 * @param bucketName: The bucket name.
 * @param root: The path to the directory acting as root.
 * @param path: The path to to file or directory.
 *
 * @returns A promise which resolves or rejects depending on the existance of the object.
 */
export const checkS3Object = async (
  s3Client: S3Client,
  bucketName: string,
  root: string,
  path?: string
): Promise<HeadObjectCommandOutput> => {
  return await s3Client.send(
    new HeadObjectCommand({
      Bucket: bucketName,
      Key: path ? PathExt.join(root, path) : root + '/' // check whether we are looking at an object or the root
    })
  );
};

/**
 * Rename a file or directory.
 *
 * @param s3Client: The S3Client used to send commands.
 * @param bucketName: The bucket name.
 * @param root: The path to the directory acting as root.
 * @param oldLocalPath: The old path of the object.
 * @param newLocalPath: The new path of the object.
 * @param newFileName: The new object name.
 * @param registeredFileTypes: The list containing all registered file types.
 *
 * @returns A promise which resolves with the new object contents model.
 */
export const renameS3Objects = async (
  s3Client: S3Client,
  bucketName: string,
  root: string,
  oldLocalPath: string,
  newLocalPath: string,
  newFileName: string,
  registeredFileTypes: IRegisteredFileTypes
): Promise<Contents.IModel> => {
  newLocalPath = PathExt.join(root, newLocalPath);
  oldLocalPath = PathExt.join(root, oldLocalPath);

  const isDir: boolean = PathExt.extname(oldLocalPath) === '';

  if (isDir) {
    newLocalPath = newLocalPath.substring(0, newLocalPath.length - 1);
  }
  newLocalPath =
    newLocalPath.substring(0, newLocalPath.lastIndexOf('/') + 1) + newFileName;

  const [fileType, fileMimeType, fileFormat] = Private.getFileType(
    PathExt.extname(PathExt.basename(newFileName)),
    registeredFileTypes
  );

  // list contents of path - contents of directory or one file
  const command = new ListObjectsV2Command({
    Bucket: bucketName,
    Prefix: oldLocalPath
  });

  let isTruncated: boolean | undefined = true;

  while (isTruncated) {
    const { Contents, IsTruncated, NextContinuationToken } =
      await s3Client.send(command);

    if (Contents) {
      // retrieve information of file or directory
      const fileContents = await s3Client.send(
        new GetObjectCommand({
          Bucket: bucketName,
          Key: Contents[0].Key!
        })
      );

      const body = await fileContents.Body?.transformToString();

      data = {
        name: newFileName,
        path: newLocalPath,
        last_modified: fileContents.LastModified!.toISOString(),
        created: '',
        content: body ? body : [],
        format: fileFormat as Contents.FileFormat,
        mimetype: fileMimeType,
        size: fileContents.ContentLength!,
        writable: true,
        type: fileType
      };

      const promises = Contents.map(async c => {
        const remainingFilePath = c.Key!.substring(oldLocalPath.length);
        // wait for copy action to resolve, delete original file only if it succeeds
        await Private.copyFile(
          s3Client,
          bucketName,
          remainingFilePath,
          oldLocalPath,
          newLocalPath
        );
        return Private.deleteFile(
          s3Client,
          bucketName,
          oldLocalPath + remainingFilePath
        );
      });
      await Promise.all(promises);
    }
    if (isTruncated) {
      isTruncated = IsTruncated;
    }
    command.input.ContinuationToken = NextContinuationToken;
  }

  return data;
};

/**
 * Copy a file or directory to a new location within the bucket or to another bucket.
 *
 * If no additional bucket name is provided, the content will be copied to the default bucket.
 *
 * @param s3Client: The S3Client used to send commands.
 * @param bucketName: The bucket name.
 * @param root: The path to the directory acting as root.
 * @param name: The new object name.
 * @param path: The original path to the object to be copied.
 * @param toDir: The new path where object should be copied.
 * @param registeredFileTypes: The list containing all registered file types.
 * @param newBucketName: The name of the bucket where to copy the object (optional).
 *
 * @returns A promise which resolves with the new object contents model.
 */
export const copyS3Objects = async (
  s3Client: S3Client,
  bucketName: string,
  root: string,
  name: string,
  path: string,
  toDir: string,
  registeredFileTypes: IRegisteredFileTypes,
  newBucketName?: string
): Promise<Contents.IModel> => {
  const isDir: boolean = PathExt.extname(path) === '';

  path = PathExt.join(root, path);
  toDir = PathExt.join(root, toDir);

  name = PathExt.join(toDir, name);
  path = isDir ? path + '/' : path;

  // list contents of path - contents of directory or one file
  const command = new ListObjectsV2Command({
    Bucket: bucketName,
    Prefix: path
  });

  let isTruncated: boolean | undefined = true;

  while (isTruncated) {
    const { Contents, IsTruncated, NextContinuationToken } =
      await s3Client.send(command);

    if (Contents) {
      const promises = Contents.map(c => {
        const remainingFilePath = c.Key!.substring(path.length);
        // copy each file from old directory to new location
        return Private.copyFile(
          s3Client,
          bucketName,
          remainingFilePath,
          path,
          name,
          newBucketName
        );
      });
      await Promise.all(promises);
    }
    if (isTruncated) {
      isTruncated = IsTruncated;
    }
    command.input.ContinuationToken = NextContinuationToken;
  }

  const [fileType, fileMimeType, fileFormat] = Private.getFileType(
    PathExt.extname(PathExt.basename(name)),
    registeredFileTypes
  );

  // retrieve information of new file
  const newFileContents = await s3Client.send(
    new GetObjectCommand({
      Bucket: newBucketName ?? bucketName,
      Key: name
    })
  );

  data = {
    name: PathExt.basename(name),
    path: name,
    last_modified: newFileContents.LastModified!.toISOString(),
    created: new Date().toISOString(),
    content: await newFileContents.Body!.transformToString(),
    format: fileFormat as Contents.FileFormat,
    mimetype: fileMimeType,
    size: newFileContents.ContentLength!,
    writable: true,
    type: fileType
  };

  return data;
};

/**
 * Count number of appeareances of object name.
 *
 * @param s3Client: The S3Client used to send commands.
 * @param bucketName: The bucket name.
 * @param root: The path to the directory acting as root.
 * @param path: The path to the object.
 * @param originalName: The original name of the object (before it was incremented).
 *
 * @returns A promise which resolves with the number of appeareances of object.
 */
export const countS3ObjectNameAppearances = async (
  s3Client: S3Client,
  bucketName: string,
  root: string,
  path: string,
  originalName: string
): Promise<number> => {
  let counter: number = 0;
  path = PathExt.join(root, path);

  // count number of name appearances
  const command = new ListObjectsV2Command({
    Bucket: bucketName,
    Prefix: path.substring(0, path.lastIndexOf('/'))
  });

  let isTruncated: boolean | undefined = true;

  while (isTruncated) {
    const { Contents, IsTruncated, NextContinuationToken } =
      await s3Client.send(command);

    if (Contents) {
      Contents.forEach(c => {
        const fileName = c
          .Key!.replace((root ? root + '/' : '') + (path ? path + '/' : ''), '')
          .split('/')[0];
        if (
          fileName.substring(0, originalName.length + 1).includes(originalName)
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

  return counter;
};

namespace Private {
  /**
   * Helping function to define file type, mimetype and format based on file extension.
   * @param extension file extension (e.g.: txt, ipynb, csv)
   * @returns
   */
  export function getFileType(
    extension: string,
    registeredFileTypes: IRegisteredFileTypes
  ) {
    let fileType: string = 'text';
    let fileMimetype: string = 'text/plain';
    let fileFormat: string = 'text';

    if (registeredFileTypes[extension]) {
      fileType = registeredFileTypes[extension].fileType;
      fileMimetype = registeredFileTypes[extension].fileMimeTypes[0];
      fileFormat = registeredFileTypes[extension].fileFormat;
    }

    // the file format for notebooks appears as json, but should be text
    if (extension === '.ipynb') {
      fileFormat = 'text';
    }

    return [fileType, fileMimetype, fileFormat];
  }

  /**
   * Helping function for deleting files inside
   * a directory, in the case of deleting the directory.
   *
   * @param filePath complete path of file to delete
   */
  export async function deleteFile(
    s3Client: S3Client,
    bucketName: string,
    filePath: string
  ) {
    await s3Client.send(
      new DeleteObjectCommand({
        Bucket: bucketName,
        Key: filePath
      })
    );
  }

  /**
   * Helping function for copying the files inside a directory
   * to a new location, in the case of renaming or copying a directory.
   *
   * @param remainingFilePath remaining path of file to be copied
   * @param oldPath old path of file
   * @param newPath new path of file
   */
  export async function copyFile(
    s3Client: S3Client,
    bucketName: string,
    remainingFilePath: string,
    oldPath: string,
    newPath: string,
    newBucketName?: string
  ) {
    await s3Client.send(
      new CopyObjectCommand({
        Bucket: newBucketName ? newBucketName : bucketName,
        CopySource: PathExt.join(bucketName, oldPath, remainingFilePath),
        Key: PathExt.join(newPath, remainingFilePath)
      })
    );
  }

  /**
   * Helping function used for formatting the body of files.
   *
   * @param options: The parameteres for saving a file.
   * @param fileFormat: The registered file format.
   * @param fileType: The registered file type.
   * @param fileMimeType: The registered file mimetype.
   *
   * @returns The formatted content (body).
   */
  export function formatBody(
    options: Partial<Contents.IModel>,
    fileFormat: string,
    fileType: string,
    fileMimeType: string
  ) {
    let body: string | Blob;
    if (options.format === 'json') {
      body = JSON.stringify(options.content, null, 2);
    } else if (
      options.format === 'base64' &&
      (fileFormat === 'base64' || fileType === 'PDF')
    ) {
      // transform base64 encoding to a utf-8 array for saving and storing in S3 bucket
      const byteCharacters = atob(options.content);
      const byteArrays = [];

      for (let offset = 0; offset < byteCharacters.length; offset += 512) {
        const slice = byteCharacters.slice(offset, offset + 512);
        const byteNumbers = new Array(slice.length);
        for (let i = 0; i < slice.length; i++) {
          byteNumbers[i] = slice.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        byteArrays.push(byteArray);
      }

      body = new Blob(byteArrays, { type: fileMimeType });
    } else {
      body = options.content;
    }
    return body;
  }
}
