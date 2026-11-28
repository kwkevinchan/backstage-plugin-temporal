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

import { useMemo } from 'react';
import {
  discoveryApiRef,
  fetchApiRef,
  useApi,
} from '@backstage/core-plugin-api';
import { DefinitionClient } from '../../api';
import { DefinitionContent } from './DefinitionContent';

/**
 * The Definition tab as the extensions mount it: it reads the definition
 * file from the route of the backend module.
 */
export function EntityTemporalDefinitionContentPage() {
  const discoveryApi = useApi(discoveryApiRef);
  const fetchApi = useApi(fetchApiRef);
  const definitions = useMemo(
    () => new DefinitionClient({ discoveryApi, fetchApi }),
    [discoveryApi, fetchApi],
  );
  return <DefinitionContent definitions={definitions} />;
}
