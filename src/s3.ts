import { Contents } from '@jupyterlab/services';
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  GetObjectCommand,
  PutObjectCommand,
  HeadObjectCommand,
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
    Prefix: (root ? root + '/' : '') + (path ? path + '/' : '')
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
          c.Key! !== path + '/' &&
          c.Key! !== root + '/' + path + '/ '
        ) {
          const fileName = c
            .Key!.replace(
              (root ? root + '/' : '') + (path ? path + '/' : ''),
              ''
            )
            .split('/')[0];
          const [fileType, fileMimeType, fileFormat] = Private.getFileType(
            fileName.split('.')[1],
            registeredFileTypes
          );

          fileList[fileName] = fileList[fileName] ?? {
            name: fileName,
            path: path ? path + '/' + fileName : fileName,
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
    name: path ? path.split('/')[path.split('/').length - 1] : bucketName,
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
    Key: (root ? root + '/' : '') + path
  });

  const response = await s3Client.send(command);

  if (response) {
    const date: string = response.LastModified!.toISOString();
    const [fileType, fileMimeType, fileFormat] = Private.getFileType(
      path.split('/')[path.split('/').length - 1].split('.')[1],
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
      name: path.split('/')[path.split('/').length - 1],
      path: (root ? root + '/' : '') + path, // TO DO: double check root needs to be here
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

export const createS3Object = async (
  s3Client: S3Client,
  bucketName: string,
  root: string,
  name: string,
  path: string,
  body: any, //string | Blob,
  registeredFileTypes: IRegisteredFileTypes
): Promise<Contents.IModel> => {
  path = root ? (path ? root + '/' + path : root) : path;

  const [fileType, fileMimeType, fileFormat] = Private.getFileType(
    name.split('.')[1],
    registeredFileTypes
  );

  await s3Client.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: path + (name.split('.').length === 1 ? '/' : ''),
      Body: body,
      CacheControl: body === '' ? undefined : 'no-cache'
    })
  );

  // TO DO: improve way in which we check if we create new file or overwrrite exisiting one
  // checking if we are creating a new file or saving an existing one (overwrriting)
  if (body === '') {
    body = Private.formatBody(body, fileFormat, fileType, fileMimeType);
  }

  data = {
    name: name,
    path: (path ? path + '/' : '') + name,
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

export const deleteS3Objects = async (
  s3Client: S3Client,
  bucketName: string,
  root: string,
  path: string
) => {
  // TO DO: check if new way to frame path works
  // localPath = this._root
  //     ? localPath
  //       ? this._root + '/' + localPath
  //       : this._root
  //     : localPath;
  path = (root ? root + '/' : '') + path;

  // get list of contents with given prefix (path)
  const command = new ListObjectsV2Command({
    Bucket: bucketName,
    Prefix: path.split('.').length === 1 ? path + '/' : path
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

export const checkS3Object = async (
  s3Client: S3Client,
  bucketName: string,
  root: string,
  path?: string
) => {
  return await s3Client.send(
    new HeadObjectCommand({
      Bucket: bucketName,
      Key: (root ? root + '/' : '') + path
    })
  );
};

export const renameS3Objects = async (
  s3Client: S3Client,
  bucketName: string,
  root: string,
  oldLocalPath: string,
  newLocalPath: string,
  newFileName: string,
  registeredFileTypes: IRegisteredFileTypes
): Promise<Contents.IModel> => {
  newLocalPath = (root ? root + '/' : '') + newLocalPath;
  oldLocalPath = (root ? root + '/' : '') + oldLocalPath;

  const isDir: boolean = oldLocalPath.split('.').length === 1;

  if (isDir) {
    newLocalPath = newLocalPath.substring(0, newLocalPath.length - 1);
  }
  newLocalPath =
    newLocalPath.substring(0, newLocalPath.lastIndexOf('/') + 1) +
    newFileName +
    (isDir ? '/' : '');

  const [fileType, fileMimeType, fileFormat] = Private.getFileType(
    newFileName!.split('.')[1],
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
  const isDir: boolean = path.split('.').length === 1;

  path = (root ? root + '/' : '') + path;
  toDir = root ? root + (toDir ? '/' + toDir : toDir) : toDir;

  name = toDir !== '' ? toDir + '/' + name : name;
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
    name.split('.')[1],
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
    name: name,
    path: toDir ? toDir + '/' + name : name,
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

export const countS3ObjectNameAppearances = async (
  s3Client: S3Client,
  bucketName: string,
  root: string,
  path: string,
  originalName: string
): Promise<number> => {
  let counter: number = 0;
  path = (root ? root + '/' : '') + (path ? path + '/' : '');

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
    extension = extension ?? '';

    if (registeredFileTypes[extension]) {
      fileType = registeredFileTypes[extension].fileType;
      fileMimetype = registeredFileTypes[extension].fileMimeTypes[0];
      fileFormat = registeredFileTypes[extension].fileFormat;
    }

    // the file format for notebooks appears as json, but should be text
    if (extension === 'ipynb') {
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
        CopySource: bucketName + '/' + oldPath + remainingFilePath,
        Key: newPath + remainingFilePath
      })
    );
  }

  export function formatBody(
    // options: Partial<Contents.IModel>,
    content: any,
    fileFormat: string,
    fileType: string,
    fileMimeType: string
  ) {
    let body: string | Blob;
    if (fileFormat === 'json') {
      // TO DO: fileformat != options.format ? options.format === 'json'
      body = JSON.stringify(content, null, 2); // options?.content
    } else if (
      // options.format === 'base64' &&
      fileFormat === 'base64' ||
      fileType === 'PDF'
    ) {
      // transform base64 encoding to a utf-8 array for saving and storing in S3 bucket
      const byteCharacters = atob(content);
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
      body = content;
    }
    return body;
  }
}
