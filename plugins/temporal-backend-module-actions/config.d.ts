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
    /** Actions registry module (`temporal-backend-module-actions`). */
    actions?: {
      /**
       * Allow service principals (for example static tokens from
       * `backend.auth.externalAccess`) to call workflow-changing actions
       * (`start-workflow`, `signal-workflow`, `update-workflow`). Defaults to
       * false so service callers cannot start, signal or update workflows
       * without user-level permission checks or user confirmation. Read actions
       * (`list-workflows`, `get-workflow`) are always available to service
       * callers.
       */
      allowServiceWrites?: boolean;
    };
  };
}
