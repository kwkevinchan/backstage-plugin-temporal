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

// Copy of plugins/temporal-backend/src/common/errorBody.ts, written by scripts/sync-common.mjs.
// Edit the backend file and run `yarn sync:common`.

/*
 * The error body of the backend's responses, for the clients of the plugin
 * in the backend and the frontend. Not exported from the package: the
 * frontend has a copy of this folder.
 */

/**
 * True when a response carries a Backstage error body (`{ error }`). A 404
 * without one comes from a route that does not exist, not from the plugin.
 */
export async function hasErrorBody(response: Response): Promise<boolean> {
  try {
    const body = JSON.parse(await response.text());
    return typeof body?.error?.name === 'string';
  } catch {
    return false;
  }
}
