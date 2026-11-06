/*
 * Copyright 2026 The backstage-plugin-temporal Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/*
 * Temporal External Storage for the example worker: payloads of 128 KiB and
 * more go to S3 with the S3 driver of the Temporal SDK, and the history
 * holds a reference instead. The threshold is lower than the SDK default
 * (256 KiB), so the summary of reportWorkflow (about 180 KiB) is stored too.
 */

const {
  CreateBucketCommand,
  HeadBucketCommand,
  S3Client,
} = require('@aws-sdk/client-s3');
const { ExternalStorage } = require('@temporalio/common');
const { S3StorageDriver } = require('@temporalio/external-storage-s3');
const {
  AwsSdkS3StorageDriverClient,
} = require('@temporalio/external-storage-s3-aws-sdk');

const THRESHOLD_BYTES = 128 * 1024;

/** Data converter and bucket, or undefined when S3 is not configured. */
async function payloadStorage() {
  const endpoint = process.env.PAYLOAD_S3_ENDPOINT;
  if (!endpoint) return undefined;
  const bucket = process.env.PAYLOAD_S3_BUCKET || 'temporal-payloads';
  const s3 = new S3Client({
    endpoint,
    region: process.env.PAYLOAD_S3_REGION || 'us-east-1',
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.PAYLOAD_S3_ACCESS_KEY || '',
      secretAccessKey: process.env.PAYLOAD_S3_SECRET_KEY || '',
    },
    // Checksums only where an operation requires them, which more
    // S3-compatible services understand.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
  // Development only: create the bucket when it is missing.
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket: bucket }));
    console.log(`Created bucket ${bucket}`);
  }
  console.log(`Large payloads go to ${endpoint}/${bucket}`);
  const driver = new S3StorageDriver({
    client: new AwsSdkS3StorageDriverClient(s3),
    bucket,
  });
  return {
    dataConverter: {
      externalStorage: new ExternalStorage({
        drivers: [driver],
        payloadSizeThreshold: THRESHOLD_BYTES,
      }),
    },
  };
}

module.exports = { payloadStorage };
