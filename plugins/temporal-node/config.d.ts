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
       * annotation. Defaults to `default`.
       */
      defaultNamespace?: string;
      /**
       * Authentication of the connection. Only `none` (no authentication)
       * is supported in this version; the block is reserved for a simple
       * authentication method.
       */
      auth?: {
        type?: 'none';
      };
    };
    /** Temporal Web UI, used for "Open in Temporal UI" links. */
    webUi?: {
      /** For example `http://localhost:8080`. */
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
      /** Keyword attribute that holds the user who started a workflow. */
      initiator?: string;
    };
  };
}
