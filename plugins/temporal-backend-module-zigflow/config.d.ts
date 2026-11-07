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
    /** Definition files of `TemporalWorkflow` entities (`spec.definition`). */
    definitions?: {
      /**
       * Largest definition file the backend reads, in bytes. Defaults to
       * 1048576 (1 MiB); at most 8388608.
       */
      maxBytes?: number;
      /**
       * Read definitions next to entities from `file:` locations, for a
       * development catalog. Only files in the folder of the entity file or
       * below it. Defaults to false.
       */
      readFileLocations?: boolean;
    };
  };
}
