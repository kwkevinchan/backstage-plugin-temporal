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
  /** Configuration of the unofficial Temporal plugin. */
  temporal?: {
    connection: {
      /**
       * Address of the Temporal frontend service, as `host:port`.
       */
      address: string;
      /**
       * Namespaces that the plugin may read. Requests for other namespaces
       * are rejected. Defaults to the default namespace only.
       */
      namespaces?: string[];
      /**
       * Namespace used when an entity has no `temporal.io/namespace`
       * annotation or `spec.namespace`. Defaults to `default`.
       * @visibility frontend
       */
      defaultNamespace?: string;
      /**
       * Authentication of the connection. `none` (the default) sends no
       * credentials. `bearer` sends `Authorization: Bearer <token>` with
       * every call, for example for the JWT authorizer of a self-hosted
       * Temporal server or an API key of Temporal Cloud (with `tls: true`).
       */
      /**
       * Connect with TLS (server certificate checked with the system's CAs),
       * for example to Temporal Cloud. Defaults to false.
       */
      tls?: boolean;
      auth?: {
        type?: 'none' | 'bearer';
        /**
         * Token for `bearer`, for example a JWT. Read it from an
         * environment variable: `token: ${TEMPORAL_TOKEN}`.
         * @visibility secret
         */
        token?: string;
      };
    };
    /** Temporal Web UI, used for "Open in Temporal UI" links. */
    webUi?: {
      /**
       * For example `http://localhost:8080`.
       * @visibility frontend
       */
      baseUrl: string;
    };
    /** Names of custom search attributes registered in Temporal. */
    searchAttributes?: {
      /**
       * Keyword attribute that holds the catalog entity reference of a
       * workflow. When set, workflows tagged with the entity reference are
       * listed for that entity too.
       */
      entityRef?: string;
      /**
       * Keyword attribute that holds the user who started a workflow. When
       * set, workflows started or rerun from Backstage carry the user's
       * entity reference in it.
       */
      initiator?: string;
    };
    /**
     * Temporal External Storage: payloads that workers store outside the
     * workflow history with the `ExternalStorage` of the Temporal SDKs.
     */
    externalStorage?: {
      /**
       * The S3 driver (`@temporalio/external-storage-s3` and the drivers of
       * the other SDKs). Without it, stored payloads are shown as stored
       * externally, with their key and size.
       */
      s3?: {
        /**
         * Bucket of the payloads, the same as the workers' driver uses.
         * Payloads in other buckets are not read.
         */
        bucket: string;
        /**
         * Driver name the workers' driver writes into the references.
         * Defaults to `aws.s3driver`, the default of the S3 driver.
         */
        driverName?: string;
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
    /**
     * Views that are not part of the first release and will move to a
     * separate package: AI loops (the Loops tab, loops in the graph) and LLM
     * steps (model and tool calls). Off by default; no compatibility
     * promise.
     */
    experimental?: {
      /** Show AI loops and LLM steps. Defaults to false. */
      aiWorkflows?: boolean;
    };
  };
}
