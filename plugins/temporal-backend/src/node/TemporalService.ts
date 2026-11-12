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
  createServiceRef,
  LoggerService,
  RootConfigService,
} from '@backstage/backend-plugin-api';
import { Config } from '@backstage/config';
import {
  buildWorkflowPath,
  isValidNamespaceName,
  WorkflowRef,
} from '../common';
import { Client, Connection } from '@temporalio/client';

/**
 * Names of the custom search attributes the plugin knows about.
 *
 * @public
 */
export interface TemporalSearchAttributeNames {
  /** Keyword attribute with the catalog entity reference of a workflow. */
  entityRef?: string;
  /** Keyword attribute with the user who started a workflow. */
  initiator?: string;
}

/**
 * Shared connection to Temporal for backend plugins and modules.
 *
 * @public
 */
export interface TemporalService {
  /** Returns a client for a namespace (default namespace when omitted). */
  getClient(options?: { namespace?: string }): Promise<Client>;
  /** Returns the shared connection. */
  getConnection(): Promise<Connection>;
  getDefaultNamespace(): string;
  getAllowedNamespaces(): string[];
  isNamespaceAllowed(namespace: string): boolean;
  getSearchAttributeNames(): TemporalSearchAttributeNames;
  /** Link to the execution in the Temporal Web UI, if `temporal.webUi` is set. */
  getWebUiUrl(ref: WorkflowRef): string | undefined;
}

/**
 * Authentication of the Temporal connection. `bearer` sends
 * `Authorization: Bearer <token>` with every call, as the JWT authorizer of a
 * self-hosted Temporal server expects. The connection does not use TLS.
 *
 * @public
 */
export type TemporalConnectionAuth =
  | { type: 'none' }
  | { type: 'bearer'; token: string };

/**
 * Options of {@link DefaultTemporalService}, mostly read from config.
 *
 * @public
 */
export interface TemporalServiceOptions {
  address: string;
  /** Defaults to no authentication. */
  auth?: TemporalConnectionAuth;
  /** Connect with TLS. Defaults to false. */
  tls?: boolean;
  defaultNamespace: string;
  namespaces: string[];
  webUiBaseUrl?: string;
  searchAttributes: TemporalSearchAttributeNames;
}

const SEARCH_ATTRIBUTE_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

/** Authentication methods for the connection. */
const AUTH_TYPES = ['none', 'bearer'];

function readAuth(connection: Config): TemporalConnectionAuth {
  const authType = connection.getOptionalString('auth.type') ?? 'none';
  if (!AUTH_TYPES.includes(authType)) {
    throw new Error(
      `Unsupported temporal.connection.auth.type: ${authType} (supported: ${AUTH_TYPES.join(
        ', ',
      )})`,
    );
  }
  if (authType === 'none') {
    return { type: 'none' };
  }
  const token = connection.getOptionalString('auth.token')?.trim();
  if (!token) {
    throw new Error(
      'temporal.connection.auth.token is required when auth.type is bearer',
    );
  }
  if (/\s/.test(token)) {
    throw new Error('temporal.connection.auth.token must not contain spaces');
  }
  return { type: 'bearer', token };
}

/**
 * Reads {@link TemporalServiceOptions} from the root config.
 *
 * @public
 */
export function readTemporalServiceOptions(
  config: Config,
): TemporalServiceOptions {
  const temporal = config.getConfig('temporal');
  const connection = temporal.getConfig('connection');
  const defaultNamespace =
    connection.getOptionalString('defaultNamespace') ?? 'default';
  const namespaces = connection.getOptionalStringArray('namespaces') ?? [
    defaultNamespace,
  ];
  for (const ns of [defaultNamespace, ...namespaces]) {
    if (!isValidNamespaceName(ns)) {
      throw new Error(`Invalid Temporal namespace in config: ${ns}`);
    }
  }
  if (!namespaces.includes(defaultNamespace)) {
    namespaces.push(defaultNamespace);
  }
  const auth = readAuth(connection);
  const searchAttributes: TemporalSearchAttributeNames = {
    entityRef: temporal.getOptionalString('searchAttributes.entityRef'),
    initiator: temporal.getOptionalString('searchAttributes.initiator'),
  };
  for (const name of Object.values(searchAttributes)) {
    if (name !== undefined && !SEARCH_ATTRIBUTE_NAME.test(name)) {
      throw new Error(`Invalid search attribute name in config: ${name}`);
    }
  }
  return {
    address: connection.getString('address'),
    auth,
    tls: connection.getOptionalBoolean('tls') ?? false,
    defaultNamespace,
    namespaces,
    webUiBaseUrl: temporal
      .getOptionalString('webUi.baseUrl')
      ?.replace(/\/+$/, ''),
    searchAttributes,
  };
}

/**
 * Default implementation of {@link TemporalService}. The connection is opened
 * on first use and closed on shutdown.
 *
 * @public
 */
export class DefaultTemporalService implements TemporalService {
  readonly #options: TemporalServiceOptions;
  readonly #logger?: LoggerService;
  #connection?: Promise<Connection>;
  readonly #clients = new Map<string, Promise<Client>>();

  static fromConfig(
    config: RootConfigService,
    options?: { logger?: LoggerService },
  ): DefaultTemporalService {
    return new DefaultTemporalService(
      readTemporalServiceOptions(config),
      options?.logger,
    );
  }

  constructor(options: TemporalServiceOptions, logger?: LoggerService) {
    this.#options = options;
    this.#logger = logger;
  }

  getConnection(): Promise<Connection> {
    if (!this.#connection) {
      const { address, auth } = this.#options;
      const tls = this.#options.tls === true;
      const bearer = auth?.type === 'bearer';
      this.#logger?.info(
        `Connecting to Temporal at ${address}${tls ? ' with TLS' : ''}${
          bearer ? ' with a bearer token' : ''
        }`,
      );
      this.#connection = Connection.connect({
        address,
        // TLS only when configured (the client would turn it on for an API
        // key by itself). `apiKey` sends `Authorization: Bearer <token>`.
        tls,
        ...(bearer ? { apiKey: auth.token } : {}),
      }).catch(error => {
        this.#connection = undefined;
        throw error;
      });
    }
    return this.#connection;
  }

  getClient(options?: { namespace?: string }): Promise<Client> {
    const namespace = options?.namespace ?? this.#options.defaultNamespace;
    if (!this.isNamespaceAllowed(namespace)) {
      return Promise.reject(
        new Error(`Temporal namespace is not allowed: ${namespace}`),
      );
    }
    let client = this.#clients.get(namespace);
    if (!client) {
      client = this.getConnection().then(
        connection => new Client({ connection, namespace }),
      );
      client.catch(() => this.#clients.delete(namespace));
      this.#clients.set(namespace, client);
    }
    return client;
  }

  getDefaultNamespace(): string {
    return this.#options.defaultNamespace;
  }

  getAllowedNamespaces(): string[] {
    return [...this.#options.namespaces];
  }

  isNamespaceAllowed(namespace: string): boolean {
    return this.#options.namespaces.includes(namespace);
  }

  getSearchAttributeNames(): TemporalSearchAttributeNames {
    return { ...this.#options.searchAttributes };
  }

  getWebUiUrl(ref: WorkflowRef): string | undefined {
    const base = this.#options.webUiBaseUrl;
    if (!base) return undefined;
    const path = buildWorkflowPath({
      namespace: ref.namespace,
      workflowId: ref.workflowId,
    });
    // The Web UI addresses a run as /workflows/:workflowId/:runId/history.
    return ref.runId
      ? `${base}${path}/${encodeURIComponent(ref.runId)}/history`
      : `${base}${path}`;
  }

  async close(): Promise<void> {
    const connection = this.#connection;
    this.#connection = undefined;
    this.#clients.clear();
    if (connection) {
      await (await connection).close();
    }
  }
}

/**
 * Service reference of the shared Temporal connection. Root scoped, so all
 * plugins share one connection.
 *
 * @public
 */
export const temporalServiceRef = createServiceRef<TemporalService>({
  id: 'temporal.client',
  scope: 'root',
  defaultFactory: async service =>
    createServiceFactory({
      service,
      deps: {
        config: coreServices.rootConfig,
        logger: coreServices.rootLogger,
        lifecycle: coreServices.rootLifecycle,
      },
      factory({ config, logger, lifecycle }) {
        const temporal = DefaultTemporalService.fromConfig(config, {
          logger: logger.child({ service: 'temporal' }),
        });
        lifecycle.addShutdownHook(() => temporal.close());
        return temporal;
      },
    }),
});
