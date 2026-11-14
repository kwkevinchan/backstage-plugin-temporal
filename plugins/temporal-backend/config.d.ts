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
       * Connect with TLS (server certificate checked with the system's CAs),
       * for example to Temporal Cloud. Defaults to false.
       */
      tls?: boolean;
      /**
       * Authentication of the connection. `none` (the default) sends no
       * credentials. `bearer` sends `Authorization: Bearer <token>` with
       * every call, for example for the JWT authorizer of a self-hosted
       * Temporal server or an API key of Temporal Cloud (with `tls: true`).
       */
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
     * The operations that change workflows: start, signal, update, cancel,
     * terminate, rerun, custom actions, and pause, resume and run now on
     * schedules. Each one is checked with its permission and recorded with
     * the auditor.
     */
    control?: {
      /**
       * Serve the routes that change workflows and show their buttons.
       * Defaults to true. When false, those routes do not exist (404) and
       * custom actions added by modules are ignored; reading and queries
       * are not affected. Without a permission policy every signed-in user
       * may use the operations, so turn them off or restrict them with a
       * policy.
       * @visibility frontend
       */
      enabled?: boolean;
      /**
       * Signal names that may be sent. Empty or absent allows every name.
       * @visibility frontend
       */
      allowedSignals?: string[];
      /**
       * Update names that may be sent. Empty or absent allows every name.
       * @visibility frontend
       */
      allowedUpdates?: string[];
    };
    /**
     * Temporal External Storage: payloads that workers store outside the
     * workflow history with the `ExternalStorage` of the Temporal SDKs.
     */
    externalStorage?: {
      /**
       * The S3 driver (`@temporalio/external-storage-s3` and the drivers of
       * the other SDKs). Without it, stored payloads are shown as stored
       * externally, with their key and size. The endpoint, path style and
       * credentials come from an entry of `integrations.awsS3`.
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
         * Host of the `integrations.awsS3` entry to read with: the host and
         * port of its `endpoint`, for example `localhost:9100` for
         * `http://localhost:9100`. Defaults to `amazonaws.com`, the AWS S3
         * entry, which Backstage adds with the default AWS credentials when
         * there is none.
         */
        integrationHost?: string;
        /** Region of the bucket. Defaults to `us-east-1`. */
        region?: string;
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
