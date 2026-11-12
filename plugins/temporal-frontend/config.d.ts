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
    connection?: {
      /**
       * Namespace used when an entity has none. Defaults to `default`.
       * @visibility frontend
       */
      defaultNamespace?: string;
    };
    /**
     * The operations that change workflows. The backend reads the same
     * settings and checks them again.
     */
    control?: {
      /**
       * Show the buttons that change workflows (Signal, Update, Cancel,
       * Terminate, Rerun, custom actions, Start workflow, and Pause, Resume
       * and Run now on schedules). Defaults to true. Set it to false
       * together with the backend, which then serves none of those routes.
       * @visibility frontend
       */
      enabled?: boolean;
      /**
       * Signal names offered in the Signal dialog. Empty or absent allows
       * every name.
       * @visibility frontend
       */
      allowedSignals?: string[];
      /**
       * Update names offered in the Update dialog. Empty or absent allows
       * every name.
       * @visibility frontend
       */
      allowedUpdates?: string[];
    };
    /** Temporal Web UI, used for "Open in Temporal UI" links. */
    webUi?: {
      /**
       * For example `http://localhost:8080`.
       * @visibility frontend
       */
      baseUrl?: string;
    };
  };
}
