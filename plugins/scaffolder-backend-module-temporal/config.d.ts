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
    /** Scaffolder module (`scaffolder-backend-module-temporal`). */
    scaffolder?: {
      /**
       * Allow tasks that do not run as a user (for example tasks started with
       * a static token from `backend.auth.externalAccess`) to start workflows
       * (`temporal:workflow:start`) and to send signals and updates
       * (`temporal:workflow:signal`). Defaults to false, so per-user
       * permissions apply to these actions. The read action
       * (`temporal:workflow:wait`) accepts any initiator.
       */
      allowServiceWrites?: boolean;
    };
  };
}
