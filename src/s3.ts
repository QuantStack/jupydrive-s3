import { URLExt } from '@jupyterlab/coreutils';

import {
  DeleteObjectCommand,
  GetObjectCommand,
  GetBucketLocationCommand,
  HeadBucketCommand,
  S3Client,
  PutBucketCorsCommand,
  PutObjectCommand,
  ListObjectsV2Command,
  ListBucketsCommand
} from '@aws-sdk/client-s3';

/**
 * Setting up the S3 client using the user credentials.
 *
 * When no region or credentials are provided, the SDK will use the
 * region and credentials from the local AWS config.
 */
const client = new S3Client({
  region: 'eu-north-1',
  credentials: {
    accessKeyId: '',
    secretAccessKey: ''
  }
});

/**
 * Set the CORS rules for a bucket such that the HTTP requests
 * within the extension are permitted.
 *
 * @param bucketName name of bucket
 */
export const setBucketCORS = async (bucketName: string) => {
  const command = new PutBucketCorsCommand({
    Bucket: bucketName,
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
  });

  try {
    const response = await client.send(command);
    console.log(response);
  } catch (err) {
    console.error(err);
  }
};

/**
 * Determine if already bucket exists.
 * @param bucketName name of bucket
 */
export const isBucket = async (bucketName: string) => {
  const command = new HeadBucketCommand({
    Bucket: bucketName
  });

  try {
    const response = await client.send(command);
    if (response.$metadata.httpStatusCode === 200) {
      console.log(
        'Bucket exists and user can access it - bucket: ',
        bucketName
      );
    } else {
      console.log(
        "Bucket doesn't exist or user doesn't have access to it - bucket: ",
        bucketName
      );
    }
  } catch (err) {
    console.error(err);
  }
};

/**
 * Get bucket region.
 * @param bucketName name of bucket
 * @returns
 */
export const getBucketRegion = async (bucketName: string) => {
  const command = new GetBucketLocationCommand({
    Bucket: bucketName
  });

  try {
    let region = '';
    const response = await client.send(command);
    region = response?.LocationConstraint as string;
    console.log(region);

    return region;
  } catch (err) {
    console.error(err);
  }
};

/**
 * List all buckets the credentials give access to.
 */
export const listBuckets = async () => {
  const command = new ListBucketsCommand({});

  const { Buckets } = await client.send(command);
  console.log('Buckets: ');
  if (Buckets) {
    console.log(Buckets.map(bucket => bucket.Name).join('\n'));
  }
  return Buckets;
};

/**
 * List all contents of a bucket.
 *
 * @param bucketName name of bucket
 */
export const listBucketContents = async (bucketName: string) => {
  const command = new ListObjectsV2Command({
    Bucket: bucketName
  });

  try {
    let isTruncated: boolean | undefined = true;
    let contentsList = '';
    const content: IFileContent[] = [];

    while (isTruncated) {
      const { Contents, IsTruncated, NextContinuationToken } =
        await client.send(command);

      console.log('Contents of bucket ', bucketName, ' :', Contents);

      if (Contents) {
        Contents.forEach(c => {
          const fileExtension = c.Key!.split('.')[1];

          content.push({
            name: c.Key!,
            path: URLExt.join(bucketName, c.Key!),
            last_modified: c.LastModified!,
            created: null,
            content: null,
            format: null,
            mimetype: fileExtension === 'txt' ? 'text/plain' : null,
            size: c.Size!,
            writable: true,
            type:
              fileExtension === 'txt'
                ? 'txt'
                : fileExtension === 'ipynb'
                  ? 'notebook'
                  : 'file' // when is it directory
          });

          console.log(content);
        });
        const contents = Contents.map(c => `${c.Key}`).join('\n');
        contentsList += contents + '\n';
      }
      if (isTruncated) {
        isTruncated = IsTruncated;
      }
      command.input.ContinuationToken = NextContinuationToken;
    }

    console.log('List of contents:\n', contentsList);
  } catch (err) {
    console.error(err);
  }
};

/**
 * Get contents of a specified file within a bucket.
 *
 * @param bucketName name of bucket
 * @param fileName name of file to retrieve contents of
 */
export const getFileContents = async (bucketName: string, fileName: string) => {
  const command = new GetObjectCommand({
    Bucket: bucketName,
    Key: fileName
  });

  try {
    const response = await client.send(command);

    if (response) {
      const fileContents = await response.Body!.transformToString();
      console.log('File Contents: ', fileContents);
    }

    console.log('File ', fileName, ': ', response);
  } catch (err) {
    console.error(err);
  }
};

/**
 * Uploading a file to a bucket.
 *
 * @param bucketName name of bucket
 * @param file name of file including its type extension (e.g.: test_file.txt)
 * @param body blob containing contents of file
 */
export const uploadFile = async (
  bucketName: string,
  file: string,
  body: string
) => {
  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: file,
    Body: body
  });

  try {
    const response = await client.send(command);
    console.log(response);
  } catch (err) {
    console.error(err);
  }
};

/**
 * Delete a specified file from a bucket.
 *
 * @param bucketName name of bucket
 * @param file name of file including its type extension (e.g.: test_file.txt)
 */
export const deleteFile = async (bucketName: string, file: string) => {
  const command = new DeleteObjectCommand({
    Bucket: bucketName,
    Key: file
  });

  try {
    const response = await client.send(command);
    console.log(response);
  } catch (err) {
    console.error(err);
  }
};

export interface IFileContent {
  name: string;
  path: string;
  last_modified: Date;
  created: Date | null;
  content: string | null;
  format: string | null;
  mimetype: string | null;
  size: number;
  writable: boolean;
  type: string;
}
