// import { ListBucketsCommand, S3Client } from '@aws-sdk/client-s3';

// // When no region or credentials are provided, the SDK will use the
// // region and credentials from the local AWS config.
// const client = new S3Client({});

// export const helloS3 = async () => {
//   const command = new ListBucketsCommand({});

//   const { Buckets } = await client.send(command);
//   console.log("Buckets: ");
//   if (Buckets){
//     console.log(Buckets.map((bucket) => bucket.Name).join("\n")); }
//   return Buckets;
// };
