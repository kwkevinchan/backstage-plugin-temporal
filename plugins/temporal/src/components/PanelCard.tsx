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

import type { ReactNode } from 'react';
import { Card, CardBody, CardHeader, Flex, Text } from '@backstage/ui';

/** A @backstage/ui card with a title, an optional subtitle and actions. */
export function PanelCard(props: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  testId?: string;
}) {
  return (
    <Card data-testid={props.testId} style={{ height: '100%' }}>
      <CardHeader>
        <Flex
          align="center"
          justify="between"
          gap="3"
          style={{ flexWrap: 'wrap' }}
        >
          <div style={{ minWidth: 0 }}>
            <Text as="h3" variant="title-small" style={{ margin: 0 }}>
              {props.title}
            </Text>
            {props.subtitle && (
              <Text
                as="p"
                variant="body-small"
                color="secondary"
                style={{ margin: 0 }}
              >
                {props.subtitle}
              </Text>
            )}
          </div>
          {props.actions && (
            <Flex align="center" gap="2" style={{ flexWrap: 'wrap' }}>
              {props.actions}
            </Flex>
          )}
        </Flex>
      </CardHeader>
      <CardBody>{props.children}</CardBody>
    </Card>
  );
}
