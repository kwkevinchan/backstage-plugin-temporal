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

const TemporalWorkflowContext = createVersionedContext<{
  1: TemporalWorkflowExtensionProps | undefined;
}>('temporal-workflow-context');

/**
 * Props of {@link TemporalWorkflowProvider}.
 *
 * @public
 */
export interface TemporalWorkflowProviderProps {
  value: TemporalWorkflowExtensionProps;
  children?: ReactNode;
}

/**
 * Provides the current workflow to {@link useTemporalWorkflow}. The workflow
 * details page renders it; use it to render a component that calls the hook
 * in a test.
 *
 * @public
 */
export function TemporalWorkflowProvider(props: TemporalWorkflowProviderProps) {
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
export function useTemporalWorkflow(): TemporalWorkflowExtensionProps {
  const versioned = useContext(TemporalWorkflowContext);
  const value = versioned?.atVersion(1);
  if (!value) {
    throw new Error(
      'useTemporalWorkflow must be used inside the Temporal workflow details page',
    );
  }
  return value;
}
