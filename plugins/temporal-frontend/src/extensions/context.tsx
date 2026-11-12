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

import { ReactNode, useContext } from 'react';
import {
  createVersionedContext,
  createVersionedValueMap,
} from '@backstage/version-bridge';
import type { TemporalWorkflowExtensionProps } from './extensions';

/**
 * Value of the workflow context on the workflow details page.
 *
 * @public
 */
export type TemporalWorkflowContextValue = TemporalWorkflowExtensionProps;

const TemporalWorkflowContext = createVersionedContext<{
  1: TemporalWorkflowContextValue | undefined;
}>('temporal-workflow-context');

/**
 * Provides the current workflow to extensions. Rendered by the workflow
 * details page.
 *
 * @public
 */
export function TemporalWorkflowProvider(props: {
  value: TemporalWorkflowContextValue;
  children?: ReactNode;
}) {
  return (
    <TemporalWorkflowContext.Provider
      value={createVersionedValueMap({ 1: props.value })}
    >
      {props.children}
    </TemporalWorkflowContext.Provider>
  );
}

/**
 * Returns the workflow shown on the current workflow details page. Throws
 * outside of it.
 *
 * @public
 */
export function useTemporalWorkflow(): TemporalWorkflowContextValue {
  const versioned = useContext(TemporalWorkflowContext);
  const value = versioned?.atVersion(1);
  if (!value) {
    throw new Error(
      'useTemporalWorkflow must be used inside the Temporal workflow details page',
    );
  }
  return value;
}
