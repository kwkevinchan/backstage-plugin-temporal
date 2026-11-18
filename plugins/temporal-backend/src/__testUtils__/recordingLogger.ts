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

import {
  coreServices,
  createServiceFactory,
  type LoggerService,
} from '@backstage/backend-plugin-api';

/** One call to a logger, with the fields of the child loggers it went through. */
export interface LogRecord {
  level: 'error' | 'warn' | 'info' | 'debug';
  message: string;
  /** The fields of `child()` calls and of the call's own meta, merged. */
  meta: Record<string, unknown>;
  /** The error that the call passed, if any. */
  error?: Error;
}

export type RecordingLogger = LoggerService & { records: LogRecord[] };

/**
 * A logger that records every call with the fields it carries, children
 * included, to assert the level, the message and the fields of a log.
 */
export function recordingLogger(
  records: LogRecord[] = [],
  inherited: Record<string, unknown> = {},
): RecordingLogger {
  const log =
    (level: LogRecord['level']) =>
    (message: string, meta?: Error | Record<string, unknown>) => {
      records.push(
        meta instanceof Error
          ? { level, message, meta: { ...inherited }, error: meta }
          : { level, message, meta: { ...inherited, ...meta } },
      );
    };
  return {
    records,
    error: log('error'),
    warn: log('warn'),
    info: log('info'),
    debug: log('debug'),
    child: meta => recordingLogger(records, { ...inherited, ...meta }),
  };
}

/** The logger service of a plugin, backed by a recording logger. */
export function recordingLoggerFactory(logger: LoggerService) {
  return createServiceFactory({
    service: coreServices.logger,
    deps: {},
    factory: () => logger,
  });
}
