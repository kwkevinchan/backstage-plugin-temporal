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

// Copy of plugins/temporal-backend/src/common/definition.ts, written by scripts/sync-common.mjs.
// Edit the backend file and run `yarn sync:common`.

import type { Entity } from '@backstage/catalog-model';
import {
  InvalidTemporalWorkflowSpecError,
  isTemporalWorkflowEntity,
} from './workflowEntity';

/**
 * Formats of a workflow definition (`spec.definition.format` of a
 * `TemporalWorkflow` entity). `serverless-workflow` is the CNCF Serverless
 * Workflow DSL 1.0 (now the Open Workflow Specification), as Zigflow runs it.
 *
 * @public
 */
export const TEMPORAL_DEFINITION_FORMATS = ['serverless-workflow'] as const;

/**
 * Format of a workflow definition.
 *
 * @public
 */
export type TemporalDefinitionFormat =
  (typeof TEMPORAL_DEFINITION_FORMATS)[number];

/**
 * Where the definition of a `TemporalWorkflow` entity is
 * (`spec.definition`).
 *
 * @public
 */
export interface TemporalWorkflowDefinitionSpec {
  /** Format of the file. */
  format: TemporalDefinitionFormat;
  /**
   * The file: a path relative to the file the entity was read from, or an
   * absolute URL. Read with the backend's URL reader, so only hosts of a
   * configured integration (or `backend.reading.allow`) work.
   */
  target: string;
}

/** Longest `spec.definition.target`. */
const MAX_TARGET_LENGTH = 2048;

/**
 * The definition of a `TemporalWorkflow` entity (`spec.definition`), or
 * undefined for workflows written in code (no `spec.definition`) and for
 * other kinds.
 *
 * @throws {@link InvalidTemporalWorkflowSpecError} for a definition with an
 * unknown format or without a target.
 * @public
 */
export function getTemporalWorkflowDefinitionSpec(
  entity: Entity,
): TemporalWorkflowDefinitionSpec | undefined {
  if (!isTemporalWorkflowEntity(entity)) return undefined;
  const value = (entity.spec as { definition?: unknown } | undefined)
    ?.definition;
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new InvalidTemporalWorkflowSpecError(
      'definition',
      'spec.definition must be an object with format and target',
    );
  }
  const { format, target } = value as { format?: unknown; target?: unknown };
  if (
    typeof format !== 'string' ||
    !(TEMPORAL_DEFINITION_FORMATS as readonly string[]).includes(format)
  ) {
    throw new InvalidTemporalWorkflowSpecError(
      'definition',
      `spec.definition.format must be one of ${TEMPORAL_DEFINITION_FORMATS.join(
        ', ',
      )}`,
    );
  }
  if (
    typeof target !== 'string' ||
    !target.trim() ||
    target.length > MAX_TARGET_LENGTH
  ) {
    throw new InvalidTemporalWorkflowSpecError(
      'definition',
      'spec.definition.target must be a path or a URL',
    );
  }
  return { format: format as TemporalDefinitionFormat, target: target.trim() };
}
