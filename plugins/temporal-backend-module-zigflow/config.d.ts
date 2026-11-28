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
       * How long a definition read from a URL is kept in memory, in seconds,
       * so repeated page views do not call the source host each time. The
       * cache belongs to one backend process. 0 turns it off. Defaults to
       * 30; at most 600.
       */
      cacheTtlSeconds?: number;
      /**
       * Most definition files the cache keeps; the least recently used is
       * dropped. Defaults to 100.
       */
      cacheMaxEntries?: number;
      /**
       * Most URL reads that run at the same time in one backend process; the
       * others wait. Defaults to 4.
       */
      maxConcurrentReads?: number;
      /**
       * Most URL reads (not counting cache hits) that start in a minute in
       * one backend process. Above it the page shows an error until the
       * minute ends. Defaults to 120.
       */
      maxReadsPerMinute?: number;
      /**
       * Read definitions next to entities from `file:` locations, for a
       * development catalog. Only files in the folder of the entity file or
       * below it. Defaults to false.
       */
      readFileLocations?: boolean;
      /**
       * Hosts and optional path prefixes from which absolute `http(s)`
       * `spec.definition.target` URLs may be read, in the same shape as
       * `backend.reading.allow`. Relative targets inside the repository of
       * the entity are allowed without this list; absolute URLs are rejected
       * unless they match an entry here (and are readable by the backend's
       * URL reader).
       */
      allow?: {
        /**
         * Host name, with an optional leading `*.` subdomain wildcard and an
         * optional `:port` or `:start-end` port range (for example
         * `github.com`, `*.example.com`, `git.example.com:8443`).
         */
        host: string;
        /**
         * Path prefixes on that host (for example `['/my-org/workflows/']`).
         * Each entry matches the exact path or paths below it at a `/`
         * boundary. When omitted, all paths on the host are allowed.
         */
        paths?: string[];
      }[];
    };
  };
}
