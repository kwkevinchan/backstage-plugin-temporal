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
       * For example `http://localhost:8080`. Only `http:` and `https:` URLs
       * make links.
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
     * workflow history with the `ExternalStorage` of the Temporal SDKs. The
     * plugin never reads them: it shows where they are stored.
     */
    externalStorage?: {
      /**
       * Template of a link to a stored payload, for example a page of your
       * S3 console: `https://console.example.com/s3/{bucket}?prefix={key}`.
       * `{bucket}` and `{key}` are replaced with the URL-encoded bucket and
       * key. Only `https:` templates are used. Without it there is no link;
       * the location (`s3://bucket/key`) is shown with a copy button.
       * @visibility frontend
       */
      objectUrl?: string;
    };
    /**
     * Settings for the Workflows overview (`POST /workflow-types/overview`).
     */
    overview?: {
      /**
       * Maximum visibility calls per second started by the overview in each
       * Temporal namespace, per backend process (combined with the concurrency
       * limit of 4 in-flight calls per namespace). Defaults to 5 (half of
       * Temporal's default `frontend.namespaceRPS.visibility` of 10). Must be
       * a positive number. In multi-replica deployments, divide your target
       * budget across replicas or raise `frontend.namespaceRPS.visibility` on
       * Temporal.
       */
      maxVisibilityCallsPerSecond?: number;
    };
  };
}
