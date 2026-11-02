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
       * Temporal server. The connection does not use TLS.
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
    /** Operations that change workflows: start, signal, update, cancel, terminate, rerun. */
    control?: {
      /**
       * Serve the operations. Defaults to true; each one is still checked
       * with the permission framework. When false, they answer 404 and the
       * frontend hides them; queries keep working.
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
  };
}
