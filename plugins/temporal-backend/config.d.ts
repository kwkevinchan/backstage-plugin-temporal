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

export interface Config {
  temporal?: {
    /** Payloads stored outside the workflow history. */
    payloads?: {
      /**
       * S3-compatible storage of large payloads (claim checks of the
       * `@kwkevinchan/temporal-payload-s3` codec). Without it, claim checks
       * are shown as stored externally, with their key and size.
       */
      s3?: {
        /** Bucket of the payloads, the same as the workers use. */
        bucket: string;
        /**
         * Endpoint of an S3-compatible service, for example
         * `http://localhost:9100`. Leave it out for AWS S3.
         */
        endpoint?: string;
        /** Region. Defaults to `us-east-1`. */
        region?: string;
        /** Bucket in the path instead of the host name. */
        forcePathStyle?: boolean;
        /** Access key with read access (`s3:GetObject`) to the bucket. */
        credentials: {
          accessKeyId: string;
          /** @visibility secret */
          secretAccessKey: string;
          /** @visibility secret */
          sessionToken?: string;
        };
        /**
         * JSON payloads up to this many bytes are downloaded and shown like
         * payloads in the history. Larger ones show their size and a
         * preview, and can be downloaded. Defaults to 262144 (256 KiB).
         */
        maxInlineBytes?: number;
        /** Bytes of text shown as the preview of a larger payload. Defaults to 2048. */
        previewBytes?: number;
      };
    };
  };
}
