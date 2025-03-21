import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client
} from '@aws-sdk/client-s3';

export const listObjectsOperation = async (params: {
  bucketName: string;
  path: string;
  maxKeys?: number;
  s3Client?: S3Client;
}) => {
  return await params.s3Client?.send(
    new ListObjectsV2Command({
      Bucket: params.bucketName,
      Prefix: params.path,
      MaxKeys: params.maxKeys ?? undefined
    })
  );
};

export const getObjectOperation = async (params: {
  bucketName: string;
  key: string;
  s3Client?: S3Client;
}) => {
  return await params.s3Client?.send(
    new GetObjectCommand({
      Bucket: params.bucketName,
      Key: params.key
    })
  );
};

export const createObjectOperation = async (params: {
  bucketName: string;
  key: string;
  body: string | Blob;
  cacheControl?: string;
  s3Client?: S3Client;
}) => {
  return await params.s3Client?.send(
    new PutObjectCommand({
      Bucket: params.bucketName,
      Key: params.key,
      Body: params.body,
      CacheControl: params.cacheControl
    })
  );
};

export const headObjectOperation = async (params: {
  bucketName: string;
  key: string;
  s3Client?: S3Client;
}) => {
  return await params.s3Client?.send(
    new HeadObjectCommand({
      Bucket: params.bucketName,
      Key: params.key
    })
  );
};

export const deleteObjectOperation = async (params: {
  bucketName: string;
  key: string;
  s3Client?: S3Client;
}) => {
  return await params.s3Client?.send(
    new DeleteObjectCommand({
      Bucket: params.bucketName,
      Key: params.key
    })
  );
};

export const copyObjectOperation = async (params: {
  bucketName: string;
  copySource: string;
  key: string;
  s3Client?: S3Client;
}) => {
  return await params.s3Client?.send(
    new CopyObjectCommand({
      Bucket: params.bucketName,
      CopySource: params.copySource,
      Key: params.key
    })
  );
};
