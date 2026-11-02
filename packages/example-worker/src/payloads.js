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
 * S3 payload codec for the example worker. The codec package is TypeScript
 * in this repository; `yarn start` loads it with the Backstage CLI node
 * transform.
 */
const {
  CreateBucketCommand,
  HeadBucketCommand,
  S3Client,
} = require('@aws-sdk/client-s3');
const { createS3DataConverter } = require('@kwkevinchan/temporal-payload-s3');

/** Data converter and bucket, or undefined when S3 is not configured. */
async function payloadStorage() {
  const endpoint = process.env.PAYLOAD_S3_ENDPOINT;
  if (!endpoint) return undefined;
  const store = {
    endpoint,
    bucket: process.env.PAYLOAD_S3_BUCKET || 'temporal-payloads',
    region: process.env.PAYLOAD_S3_REGION || 'us-east-1',
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.PAYLOAD_S3_ACCESS_KEY || '',
      secretAccessKey: process.env.PAYLOAD_S3_SECRET_KEY || '',
    },
  };
  // Development only: create the bucket when it is missing.
  const s3 = new S3Client({
    endpoint,
    region: store.region,
    forcePathStyle: true,
    credentials: store.credentials,
  });
  try {
    await s3.send(new HeadBucketCommand({ Bucket: store.bucket }));
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket: store.bucket }));
    console.log(`Created bucket ${store.bucket}`);
  }
  s3.destroy();
  console.log(`Large payloads go to ${endpoint}/${store.bucket}`);
  return { dataConverter: createS3DataConverter({ store }) };
}

module.exports = { payloadStorage };
