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

async function draft({ topic, round, feedback }) {
  return feedback ? `${topic} r${round}: ${feedback}` : `${topic} r${round}`;
}

async function review({ text, round }) {
  return round < 3 ? `第 ${round} 輪還不夠具體` : `done: ${text}`;
}

async function notify({ message }) {
  return { delivered: message };
}

module.exports = { draft, review, notify };
