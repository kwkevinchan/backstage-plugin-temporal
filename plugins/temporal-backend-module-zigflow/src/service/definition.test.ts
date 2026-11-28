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

import { execFileSync } from 'node:child_process';
import * as fsPromises from 'node:fs/promises';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { LoggerService } from '@backstage/backend-plugin-api';
import { mockServices } from '@backstage/backend-test-utils';
import type { Entity } from '@backstage/catalog-model';
import { ConfigReader } from '@backstage/config';
import { NotFoundError } from '@backstage/errors';
import { ScmIntegrations } from '@backstage/integration';
import {
  DefinitionAllowRule,
  DefinitionReader,
  parseDefinition,
} from './definition';

const fixture = readFileSync(
  join(__dirname, '../../../../test-fixtures/definitions/every-task.yaml'),
  'utf8',
);

const entity = (location?: string): Entity => ({
  apiVersion: 'temporal.io/v1alpha1',
  kind: 'TemporalWorkflow',
  metadata: {
    name: 'order-flow',
    namespace: 'default',
    annotations: location
      ? { 'backstage.io/managed-by-location': location }
      : {},
  },
  spec: { owner: 'group:default/team-a', workflowType: 'order-flow' },
});

const spec = (target: string) => ({
  format: 'serverless-workflow' as const,
  target,
});

function readerOf(
  readUrl: jest.Mock,
  options: {
    maxBytes?: number;
    cacheTtlSeconds?: number;
    cacheMaxEntries?: number;
    maxConcurrentReads?: number;
    maxReadsPerMinute?: number;
    readFileLocations?: boolean;
    allow?: DefinitionAllowRule[];
    integrations?: ScmIntegrations;
    logger?: LoggerService;
  } = {},
) {
  const { integrations, ...rest } = options;
  return new DefinitionReader({
    reader: mockServices.urlReader.mock({ readUrl }),
    integrations:
      integrations ?? ScmIntegrations.fromConfig(new ConfigReader({})),
    ...rest,
  });
}

describe('parseDefinition', () => {
  it('finds every task with its first and last line', () => {
    const { document, tasks, error } = parseDefinition(fixture);
    expect(error).toBeUndefined();
    expect((document as any).document.workflowType).toBe('order-flow');
    const byName = Object.fromEntries(
      tasks.map(t => [t.pointer, [t.startLine, t.endLine]]),
    );
    expect(byName['/do/0/validate']).toEqual([10, 14]);
    expect(byName['/do/2/packItems']).toEqual([22, 32]);
    expect(byName['/do/2/packItems/do/0/pack']).toEqual([28, 32]);
    expect(byName['/do/3/checks/fork/branches/1/stock']).toEqual([42, 52]);
    expect(byName['/do/3/checks/fork/branches/1/stock/do/0/reserve']).toEqual([
      44, 52,
    ]);
    expect(byName['/do/5/charge/try/0/chargeCard']).toEqual([62, 66]);
    expect(byName['/do/5/charge/catch/do/0/refund']).toEqual([74, 77]);
    expect(byName['/do/11/expressShipping']).toEqual([97, 103]);
    expect(tasks.map(t => t.pointer.split('/').pop())).toEqual([
      'validate',
      'route',
      'packItems',
      'pack',
      'checks',
      'fraud',
      'stock',
      'reserve',
      'waitForPayment',
      'charge',
      'chargeCard',
      'refund',
      'cooldown',
      'notify',
      'summary',
      'mystery',
      'stop',
      'expressShipping',
      'book',
    ]);
    expect(tasks[0]).toEqual({
      pointer: '/do/0/validate',
      startLine: 10,
      endLine: 14,
    });
  });

  it('reports the line of a syntax error', () => {
    const result = parseDefinition('document:\n  dsl: 1.0.0\ndo:\n  - a: [\n');
    expect(result.error).toMatchObject({ kind: 'parse' });
    expect(result.error?.line).toBeGreaterThanOrEqual(4);
    expect(result.tasks).toEqual([]);
  });

  it('stops alias bombs', () => {
    const lines = ['a: &a ["x","x","x","x","x","x","x","x","x","x"]'];
    for (let i = 0; i < 8; i++) {
      const prev = String.fromCharCode(97 + i);
      const next = String.fromCharCode(98 + i);
      lines.push(`${next}: &${next} [${new Array(10).fill(`*${prev}`)}]`);
    }
    lines.push('do: []');
    const result = parseDefinition(lines.join('\n'));
    expect(result.error).toEqual({
      kind: 'parse',
      message:
        'The file uses too many aliases (at most 20 aliases in all, and at most 19 for one anchor)',
    });
    expect(result.document).toBeUndefined();
  });

  it('keeps tags as data and runs nothing', () => {
    const result = parseDefinition(
      'document: {dsl: 1.0.0}\ndo:\n  - a:\n      set:\n        f: !!js/function "function () { throw 1 }"\n',
    );
    // An unknown tag is an error in strict mode or plain data otherwise;
    // never a function.
    const value = (result.document as any)?.do?.[0]?.a?.set?.f;
    expect(typeof value === 'function').toBe(false);
  });

  it('rejects duplicate keys and files that are not workflows', () => {
    expect(parseDefinition('a: 1\na: 2\n').error?.kind).toBe('parse');
    expect(parseDefinition('- 1\n- 2\n').error?.kind).toBe('format');
    expect(parseDefinition('document: {dsl: 1.0.0}\n').error).toEqual({
      kind: 'format',
      message: 'The file has no task list (do) at the top level',
    });
    expect(
      parseDefinition('document: {dsl: 0.8.0}\ndo: []\n').error?.message,
    ).toBe('DSL version 0.8.0 is not supported; the page reads 1.x');
  });

  it('checks unique keys in time linear in the number of keys', () => {
    const lines = ['document: {dsl: 1.0.0}', 'do: []', 'vars:'];
    for (let i = 0; i < 50000; i++) lines.push(`  key${i}: ${i}`);
    const text = lines.join('\n');
    const start = Date.now();
    const result = parseDefinition(text);
    const elapsed = Date.now() - start;
    expect(result.error).toBeUndefined();
    expect(Object.keys((result.document as any).vars)).toHaveLength(50000);
    // Comparing every key with every earlier key takes tens of seconds.
    expect(elapsed).toBeLessThan(5000);

    expect(parseDefinition(`${text}\n  key25000: again\n`).error).toMatchObject(
      { kind: 'parse', message: 'Map keys must be unique', line: 50004 },
    );
    expect(
      parseDefinition('do:\n  - a:\n      set: {x: 1, y: 2, x: 3}\n').error,
    ).toMatchObject({ kind: 'parse', line: 3 });
    // Equal values of different types are different keys.
    expect(parseDefinition('do: []\n1: a\n"1": b\n').error).toBeUndefined();
  });

  it('limits the number of aliases, also in files with many anchors', () => {
    const shared = ['document: {dsl: 1.0.0}', 'retry: &retry {limit: 3}'];
    const tasks = (count: number) =>
      Array.from(
        { length: count },
        (_, i) => `  - t${i}:\n      call: http\n      retry: *retry`,
      );
    // The anchor counts as a copy: 19 aliases of one anchor are the most.
    const ok = parseDefinition([...shared, 'do:', ...tasks(19)].join('\n'));
    expect(ok.error).toBeUndefined();
    expect((ok.document as any).do[18].t18.retry).toEqual({ limit: 3 });

    for (const count of [20, 21]) {
      expect(
        parseDefinition([...shared, 'do:', ...tasks(count)].join('\n')).error,
      ).toEqual({
        kind: 'parse',
        message:
          'The file uses too many aliases (at most 20 aliases in all, and at most 19 for one anchor)',
      });
    }

    // The yaml package scans the whole document for the anchor of each
    // alias: 20000 aliases take seconds.
    const lines = ['do:'];
    for (let i = 0; i < 20000; i++) lines.push(`- &a${i} x`, `- *a${i}`);
    const start = Date.now();
    expect(parseDefinition(lines.join('\n')).error?.message).toBe(
      'The file uses too many aliases (at most 20 aliases in all, and at most 19 for one anchor)',
    );
    expect(Date.now() - start).toBeLessThan(2000);
  });

  it('stops aliases that expand a large block into much more data', () => {
    const text = [
      'document: {dsl: 1.0.0}',
      `big: &big "${'x'.repeat(60000)}"`,
      'do: []',
      `copies: [${new Array(19).fill('*big').join(', ')}]`,
    ].join('\n');
    expect(parseDefinition(text)).toEqual({
      tasks: [],
      error: {
        kind: 'parse',
        message: 'The file expands to too much data through its aliases',
      },
    });
    const few = text.replace(/copies: .*/, 'copies: [*big, *big]');
    expect(parseDefinition(few).error).toBeUndefined();
  });

  it('reports an alias inside its own anchor as a parse error', () => {
    for (const text of [
      'document: {dsl: 1.0.0}\ndo: []\na: &a [*a]\n',
      'document: {dsl: 1.0.0}\ndo: []\nb: &b {c: [1, *b]}\n',
    ]) {
      expect(parseDefinition(text)).toEqual({
        tasks: [],
        error: {
          kind: 'parse',
          message: 'The file has an alias inside its own anchor',
        },
      });
    }
  });

  it('reports deep nesting as a parse error', () => {
    const nested = (depth: number) =>
      `document: {dsl: 1.0.0}\ndo: []\nx: ${'['.repeat(depth)}${']'.repeat(
        depth,
      )}\n`;
    expect(parseDefinition(nested(60)).error).toBeUndefined();
    expect(parseDefinition(nested(70)).error).toEqual({
      kind: 'parse',
      message: 'The file is nested more than 64 levels deep',
    });
    for (const depth of [500, 5000, 100000]) {
      expect(parseDefinition(nested(depth)).error?.kind).toBe('parse');
    }
  });

  it('keeps a "__proto__" key as data', () => {
    const result = parseDefinition(
      'document: {dsl: 1.0.0}\ndo: []\n__proto__: {polluted: true}\n',
    );
    expect(result.error).toBeUndefined();
    expect(Object.getPrototypeOf(result.document)).toBe(Object.prototype);
    expect(Object.keys(result.document!)).toContain('__proto__');
    expect(({} as any).polluted).toBeUndefined();
  });
});

describe('DefinitionReader', () => {
  it('logs a target that cannot be used at debug and a file that cannot be read at warn, with the entity', async () => {
    const logger = mockServices.logger.mock();
    logger.child.mockReturnValue(logger);
    const failure = new Error('connection reset');
    const readUrl = jest.fn(async () => {
      throw failure;
    });
    const reader = readerOf(readUrl, {
      allow: [{ host: 'raw.example.com' }],
      logger,
    });
    const denied = await reader.read(
      entity(),
      spec('https://other.example.com/order.yaml'),
    );
    expect(denied.error?.kind).toBe('read');
    expect(logger.child).toHaveBeenLastCalledWith({
      entityRef: 'temporalworkflow:default/order-flow',
    });
    expect(logger.debug).toHaveBeenCalledWith(
      'The target of a definition cannot be used',
      expect.any(Error),
    );
    expect(logger.warn).not.toHaveBeenCalled();

    await reader.read(entity(), spec('https://raw.example.com/order.yaml'));
    expect(logger.child).toHaveBeenLastCalledWith({
      entityRef: 'temporalworkflow:default/order-flow',
      targetType: 'url',
    });
    expect(logger.warn).toHaveBeenCalledWith(
      'Could not read the definition of an entity',
      failure,
    );
  });

  it('reads a target relative to the entity location', async () => {
    const readUrl = jest.fn(async () => ({
      buffer: async () => Buffer.from(fixture),
      stream: () => Readable.from([Buffer.from(fixture)]),
    }));
    const reader = readerOf(readUrl);
    const result = await reader.read(
      entity(
        'url:https://git.example.com/org/repo/blob/main/catalog-info.yaml',
      ),
      spec('./workflows/order.yaml'),
    );
    expect(readUrl).toHaveBeenCalledWith(
      'https://git.example.com/org/repo/blob/main/workflows/order.yaml',
    );
    expect(result).toMatchObject({
      format: 'serverless-workflow',
      target: './workflows/order.yaml',
      url: 'https://git.example.com/org/repo/blob/main/workflows/order.yaml',
      size: Buffer.byteLength(fixture),
    });
    expect(result).not.toHaveProperty('entityRef');
    expect(result).not.toHaveProperty('maxBytes');
    expect(result.content).toBe(fixture);
    expect(result.tasks).toHaveLength(19);
    expect(result.error).toBeUndefined();
  });

  it('rejects absolute URLs by default and reads them only when matching temporal.definitions.allow', async () => {
    const readUrl = jest.fn(async () => ({
      buffer: async () => Buffer.from('document: {dsl: 1.0.0}\ndo: []\n'),
    }));

    const denied = await readerOf(readUrl).read(
      entity(),
      spec('https://raw.example.com/my-org/workflows/order.yaml'),
    );
    expect(denied.error?.kind).toBe('read');
    expect(denied.error?.message).toContain('raw.example.com');
    expect(denied.error?.message).toContain('temporal.definitions.allow');
    expect(readUrl).not.toHaveBeenCalled();

    const exact = await readerOf(readUrl, {
      allow: [{ host: 'raw.example.com' }],
    }).read(entity(), spec('https://raw.example.com/order.yaml'));
    expect(readUrl).toHaveBeenCalledWith('https://raw.example.com/order.yaml');
    expect(exact.error).toBeUndefined();

    const wildcardReader = readerOf(readUrl, {
      allow: [{ host: '*.example.com' }],
    });
    expect(
      (
        await wildcardReader.read(
          entity(),
          spec('https://raw.example.com/order.yaml'),
        )
      ).error,
    ).toBeUndefined();
    expect(
      (
        await wildcardReader.read(
          entity(),
          spec('https://example.com/order.yaml'),
        )
      ).error?.message,
    ).toContain('temporal.definitions.allow');
    expect(
      (
        await wildcardReader.read(
          entity(),
          spec('https://evil-example.com/order.yaml'),
        )
      ).error?.message,
    ).toContain('temporal.definitions.allow');

    const portReader = readerOf(readUrl, {
      allow: [{ host: 'internal.example.com:8443' }],
    });
    expect(
      (
        await portReader.read(
          entity(),
          spec('https://internal.example.com:8443/order.yaml'),
        )
      ).error,
    ).toBeUndefined();
    expect(
      (
        await portReader.read(
          entity(),
          spec('https://internal.example.com/order.yaml'),
        )
      ).error?.message,
    ).toContain('temporal.definitions.allow');

    const portRangeReader = readerOf(readUrl, {
      allow: [{ host: 'internal.example.com:8000-8999' }],
    });
    expect(
      (
        await portRangeReader.read(
          entity(),
          spec('https://internal.example.com:8443/order.yaml'),
        )
      ).error,
    ).toBeUndefined();
    expect(
      (
        await portRangeReader.read(
          entity(),
          spec('https://internal.example.com:9000/order.yaml'),
        )
      ).error?.message,
    ).toContain('temporal.definitions.allow');

    const pathReader = readerOf(readUrl, {
      allow: [{ host: 'raw.example.com', paths: ['/my-org/workflows'] }],
    });
    expect(
      (
        await pathReader.read(
          entity(),
          spec('https://raw.example.com/my-org/workflows/order.yaml'),
        )
      ).error,
    ).toBeUndefined();
    const wrongPath = await pathReader.read(
      entity(),
      spec('https://raw.example.com/other-org/order.yaml'),
    );
    expect(wrongPath.error?.kind).toBe('read');
    expect(wrongPath.error?.message).toContain('/other-org/order.yaml');
    expect(wrongPath.error?.message).toContain('temporal.definitions.allow');
    const siblingPrefix = await pathReader.read(
      entity(),
      spec('https://raw.example.com/my-org/workflows-evil/order.yaml'),
    );
    expect(siblingPrefix.error?.kind).toBe('read');
    const traversal = await pathReader.read(
      entity(),
      spec('https://raw.example.com/my-org/workflows/../secret.yaml'),
    );
    expect(traversal.error?.kind).toBe('read');

    const strayPercentTraversal = await pathReader.read(
      entity(),
      spec('https://raw.example.com/my-org/workflows/%252e%252e/secret/x%'),
    );
    expect(strayPercentTraversal.error?.kind).toBe('read');
    expect(readUrl).not.toHaveBeenCalledWith(
      expect.stringContaining('secret/x%'),
    );

    const defaultPort = await readerOf(readUrl, {
      allow: [{ host: 'raw.example.com' }],
    }).read(entity(), spec('https://raw.example.com:443/order.yaml'));
    expect(defaultPort.error).toBeUndefined();

    const userinfoSpoof = await readerOf(readUrl, {
      allow: [{ host: 'raw.example.com' }],
    }).read(
      entity(),
      spec('https://raw.example.com@evil.example.com/order.yaml'),
    );
    expect(userinfoSpoof.error).toEqual({
      kind: 'read',
      message:
        'Absolute definition URLs must not contain a user name or password',
    });
    expect(readUrl).not.toHaveBeenCalledWith(
      expect.stringContaining('evil.example.com'),
    );

    for (const target of [
      'https://user@raw.example.com/order.yaml',
      'https://user:secret@raw.example.com/order.yaml',
      'https://:secret@raw.example.com/order.yaml',
    ]) {
      const userinfo = await readerOf(readUrl, {
        allow: [{ host: 'raw.example.com' }],
      }).read(entity(), spec(target));
      expect(userinfo.error?.message).toContain('user name or password');
      expect(userinfo.url).toBeUndefined();
      expect(readUrl).not.toHaveBeenCalledWith(
        expect.stringContaining('@raw.example.com'),
      );
    }

    const idnReader = readerOf(readUrl, {
      allow: [{ host: '例子.example.com' }],
    });
    expect(
      (
        await idnReader.read(
          entity(),
          spec('https://例子.example.com/order.yaml'),
        )
      ).error,
    ).toBeUndefined();
  });

  it('rejects absolute and protocol-relative targets padded with ASCII whitespace or controls', async () => {
    const readUrl = jest.fn(async () => ({
      buffer: async () => Buffer.from('document: {dsl: 1.0.0}\ndo: []\n'),
    }));
    const real = ScmIntegrations.fromConfig(
      new ConfigReader({
        integrations: { github: [{ host: 'github.com' }] },
      }),
    );
    const resolveUrl = jest.fn((options: { url: string; base: string }) =>
      real.resolveUrl(options),
    );
    const integrations = {
      resolveUrl,
      byUrl: (url: string) => real.byUrl(url),
    } as unknown as ScmIntegrations;
    const reader = readerOf(readUrl, { integrations });
    const located = entity(
      'url:https://github.com/my-org/my-repo/blob/main/catalog-info.yaml',
    );

    // Spaces are not controls. Trim them, then classify as an absolute URL
    // so the allowlist still applies. Do not resolve them as repo paths.
    const paddedAbsolute = [
      ' https://evil.example.com/x',
      'https://evil.example.com/x ',
    ];
    for (const target of paddedAbsolute) {
      resolveUrl.mockClear();
      const result = await reader.read(located, spec(target));
      expect(result.error).toEqual(
        expect.objectContaining({
          kind: 'read',
          message: expect.stringContaining(
            'Absolute definition URLs from evil.example.com are not allowed',
          ),
        }),
      );
      expect(readUrl).not.toHaveBeenCalled();
      expect(resolveUrl).not.toHaveBeenCalled();
    }

    // Edge controls are rejected before classification. They must not be
    // stripped and then accepted or rejected as an absolute URL.
    const controlAbsolute = [
      '\thttps://evil.example.com/x',
      'https://evil.example.com/x\t',
      '\nhttps://evil.example.com/x',
      'https://evil.example.com/x\n',
      '\rhttps://evil.example.com/x',
      'https://evil.example.com/x\r',
      '\u0000https://evil.example.com/x',
      '\u007fhttps://evil.example.com/x',
      'https://evil.example.com/x\u007f',
    ];
    for (const target of controlAbsolute) {
      resolveUrl.mockClear();
      const result = await reader.read(located, spec(target));
      expect(result.error?.kind).toBe('read');
      expect(readUrl).not.toHaveBeenCalled();
      expect(resolveUrl).not.toHaveBeenCalled();
    }

    const paddedProtocolRelative = [
      ' //evil.example.com/x',
      '\t//evil.example.com/x',
      '\n//evil.example.com/x',
      '\r//evil.example.com/x',
    ];
    for (const target of paddedProtocolRelative) {
      resolveUrl.mockClear();
      const result = await reader.read(located, spec(target));
      expect(result.error?.kind).toBe('read');
      expect(result.error?.message).toContain('temporal.definitions.allow');
      expect(readUrl).not.toHaveBeenCalled();
      expect(resolveUrl).not.toHaveBeenCalled();
    }

    // Even a same-repo URL padded with spaces must still require temporal.definitions.allow.
    resolveUrl.mockClear();
    const sameRepoPadded = await reader.read(
      located,
      spec(' https://github.com/my-org/my-repo/blob/main/other.yaml'),
    );
    expect(sameRepoPadded.error?.kind).toBe('read');
    expect(sameRepoPadded.error?.message).toContain(
      'Absolute definition URLs from github.com are not allowed',
    );
    expect(readUrl).not.toHaveBeenCalled();
    expect(resolveUrl).not.toHaveBeenCalled();
  });

  it('rejects embedded and encoded ASCII controls before resolving a URL', async () => {
    const readUrl = jest.fn(async () => ({
      buffer: async () => Buffer.from('document: {dsl: 1.0.0}\ndo: []\n'),
    }));
    const real = ScmIntegrations.fromConfig(
      new ConfigReader({
        integrations: { github: [{ host: 'github.com' }] },
      }),
    );
    const resolveUrl = jest.fn((options: { url: string; base: string }) =>
      real.resolveUrl(options),
    );
    const integrations = {
      resolveUrl,
      byUrl: (url: string) => real.byUrl(url),
    } as unknown as ScmIntegrations;
    const reader = readerOf(readUrl, { integrations });
    const allowedReader = readerOf(readUrl, {
      integrations,
      allow: [{ host: 'raw.example.com' }],
    });
    const ghRoot = entity(
      'url:https://github.com/my-org/my-repo/blob/main/catalog-info.yaml',
    );
    const ghFeatSub = entity(
      'url:https://github.com/my-org/my-repo/blob/feat/sub/catalog-info.yaml',
    );

    // Spaces still classify as an absolute URL, so an allowed host is read.
    const paddedAllowed = await allowedReader.read(
      entity(),
      spec(' https://raw.example.com/order.yaml'),
    );
    expect(paddedAllowed.error).toBeUndefined();
    expect(readUrl).toHaveBeenCalledWith('https://raw.example.com/order.yaml');
    expect(resolveUrl).not.toHaveBeenCalled();
    readUrl.mockClear();

    const leadingSpace = await reader.read(
      ghRoot,
      spec(' https://github.com/my-org/my-repo/blob/main/other.yaml'),
    );
    expect(leadingSpace.error?.kind).toBe('read');
    expect(leadingSpace.error?.message).toContain(
      'Absolute definition URLs from github.com are not allowed',
    );
    expect(readUrl).not.toHaveBeenCalled();
    expect(resolveUrl).not.toHaveBeenCalled();

    const rejected: Array<{
      ent: ReturnType<typeof entity>;
      target: string;
      allow?: boolean;
    }> = [
      {
        ent: ghRoot,
        target: '\thttps://github.com/my-org/my-repo/blob/main/other.yaml',
      },
      {
        ent: ghRoot,
        target: 'ht\ttps://github.com/my-org/my-repo/blob/main/other.yaml',
      },
      { ent: ghRoot, target: ' //evil.example.com/a.yaml' },
      { ent: ghRoot, target: '\t//evil.example.com/a.yaml' },
      { ent: ghFeatSub, target: '.\t./.\t./feat/other.yaml' },
      { ent: ghRoot, target: '..%09/..' },
      { ent: ghRoot, target: '..%09/outside.yaml' },
      {
        ent: ghRoot,
        target: '%0ahttps://github.com/my-org/my-repo/blob/main/other.yaml',
      },
      { ent: ghRoot, target: '%0dhttps://evil.example.com/a.yaml' },
      { ent: ghRoot, target: '%00./workflows/order.yaml' },
      { ent: ghRoot, target: '%20https://evil.example.com/a.yaml' },
      { ent: ghRoot, target: '%20//evil.example.com/a.yaml' },
      {
        ent: ghRoot,
        target: '%68%74%74%70%73%3a%2f%2fevil.example.com/a.yaml',
      },
      // Edge controls must not be stripped and then pass the allowlist.
      {
        ent: entity(),
        target: '\thttps://raw.example.com/order.yaml',
        allow: true,
      },
      {
        ent: entity(),
        target: 'https://raw.example.com/order.yaml\n',
        allow: true,
      },
      {
        ent: entity(),
        target: '%0ahttps://raw.example.com/order.yaml',
        allow: true,
      },
      {
        ent: entity(),
        target: '%09https://raw.example.com/order.yaml',
        allow: true,
      },
      { ent: ghRoot, target: '\t./workflows/order.yaml' },
      { ent: ghRoot, target: '%0a./workflows/order.yaml' },
    ];
    for (const { ent, target, allow } of rejected) {
      resolveUrl.mockClear();
      const result = await (allow ? allowedReader : reader).read(
        ent,
        spec(target),
      );
      expect(result.error?.kind).toBe('read');
      expect(readUrl).not.toHaveBeenCalled();
      expect(resolveUrl).not.toHaveBeenCalled();
    }
  });

  it('keeps relative targets inside the same repository across integrations', async () => {
    const readUrl = jest.fn(async () => ({
      buffer: async () => Buffer.from('document: {dsl: 1.0.0}\ndo: []\n'),
    }));
    const integrations = ScmIntegrations.fromConfig(
      new ConfigReader({
        integrations: {
          github: [{ host: 'github.com' }],
          gitlab: [{ host: 'gitlab.com' }],
          azure: [{ host: 'dev.azure.com' }],
          gerrit: [
            {
              host: 'gerrit.example.com',
              gitilesBaseUrl: 'https://gerrit.example.com/plugins/gitiles',
            },
          ],
        },
      }),
    );
    const reader = readerOf(readUrl, { integrations, cacheTtlSeconds: 0 });

    const ghSubdir = entity(
      'url:https://github.com/my-org/my-repo/blob/main/services/orders/catalog-info.yaml',
    );
    expect(
      (await reader.read(ghSubdir, spec('./workflows/order.yaml'))).error,
    ).toBeUndefined();
    expect(readUrl).toHaveBeenLastCalledWith(
      'https://github.com/my-org/my-repo/tree/main/services/orders/workflows/order.yaml',
    );
    expect(
      (await reader.read(ghSubdir, spec('../workflows/order.yaml'))).error,
    ).toBeUndefined();
    expect(readUrl).toHaveBeenLastCalledWith(
      'https://github.com/my-org/my-repo/tree/main/services/workflows/order.yaml',
    );
    expect(
      (await reader.read(ghSubdir, spec('/workflows/order.yaml'))).error,
    ).toBeUndefined();
    expect(readUrl).toHaveBeenLastCalledWith(
      'https://github.com/my-org/my-repo/tree/main/workflows/order.yaml',
    );

    const glSubdir = entity(
      'url:https://gitlab.com/org/sub/my-repo/-/blob/main/services/orders/catalog-info.yaml',
    );
    expect(
      (await reader.read(glSubdir, spec('../workflows/order.yaml'))).error,
    ).toBeUndefined();

    const glLegacySubdir = entity(
      'url:https://gitlab.com/grp/sub/my-repo/blob/main/services/orders/catalog-info.yaml',
    );
    expect(
      (await reader.read(glLegacySubdir, spec('../workflows/order.yaml')))
        .error,
    ).toBeUndefined();
    expect(
      (await reader.read(glLegacySubdir, spec('./100%.yaml'))).error,
    ).toBeUndefined();

    const gerritEntity = entity(
      'url:https://gerrit.example.com/plugins/gitiles/team/proj/+/refs/heads/main/catalog-info.yaml',
    );
    expect(
      (await reader.read(gerritEntity, spec('./workflows/order.yaml'))).error,
    ).toBeUndefined();

    const ghPlusSubdir = entity(
      'url:https://github.com/my-org/my-repo/blob/main/services/+/catalog-info.yaml',
    );
    expect(
      (await reader.read(ghPlusSubdir, spec('../workflows/order.yaml'))).error,
    ).toBeUndefined();
    expect(readUrl).toHaveBeenLastCalledWith(
      'https://github.com/my-org/my-repo/tree/main/services/workflows/order.yaml',
    );

    const glPlusSubdir = entity(
      'url:https://gitlab.com/org/sub/my-repo/-/blob/main/services/+/catalog-info.yaml',
    );
    expect(
      (await reader.read(glPlusSubdir, spec('../workflows/order.yaml'))).error,
    ).toBeUndefined();

    const azSubdir = entity(
      'url:https://dev.azure.com/my-org/my-project/_git/my-repo?path=/services/orders/catalog-info.yaml&version=GBmain',
    );
    expect(
      (await reader.read(azSubdir, spec('../workflows/order.yaml'))).error,
    ).toBeUndefined();
  });

  it('characterizes relative targets when the entity branch name contains a slash', async () => {
    const readUrl = jest.fn(async () => ({
      buffer: async () => Buffer.from('document: {dsl: 1.0.0}\ndo: []\n'),
    }));
    const integrations = ScmIntegrations.fromConfig(
      new ConfigReader({
        integrations: {
          github: [{ host: 'github.com' }],
          gitlab: [{ host: 'gitlab.com' }],
          gitea: [{ host: 'gitea.example.com' }],
        },
      }),
    );
    const reader = readerOf(readUrl, { integrations });

    // parseRepoUrl takes only the first segment after the ref marker as `ref`,
    // so for branch `feature/x`, `feature` is treated as the ref and `x` as
    // a folder. Keep repo boundaries intact while locking in exact resolution
    // across hosts.
    const allowedCases: Array<{
      host: string;
      location: string;
      target: string;
      expectedUrl: string;
    }> = [
      {
        host: 'github',
        location:
          'url:https://github.com/my-org/my-repo/blob/feature/x/catalog-info.yaml',
        target: '../y/wf.yaml',
        expectedUrl: 'https://github.com/my-org/my-repo/tree/feature/y/wf.yaml',
      },
      {
        host: 'github',
        location:
          'url:https://github.com/my-org/my-repo/blob/feature/x/catalog-info.yaml',
        target: './wf.yaml',
        expectedUrl: 'https://github.com/my-org/my-repo/tree/feature/x/wf.yaml',
      },
      {
        host: 'github',
        location:
          'url:https://github.com/my-org/my-repo/blob/feature/x/catalog-info.yaml',
        target: '/wf.yaml',
        expectedUrl: 'https://github.com/my-org/my-repo/tree/feature/wf.yaml',
      },
      {
        host: 'gitlab',
        location:
          'url:https://gitlab.com/my-org/my-repo/-/blob/feature/x/catalog-info.yaml',
        target: '../y/wf.yaml',
        expectedUrl:
          'https://gitlab.com/my-org/my-repo/-/blob/feature/y/wf.yaml',
      },
      {
        host: 'gitlab',
        location:
          'url:https://gitlab.com/my-org/my-repo/-/blob/feature/x/catalog-info.yaml',
        target: './wf.yaml',
        expectedUrl:
          'https://gitlab.com/my-org/my-repo/-/blob/feature/x/wf.yaml',
      },
      {
        host: 'gitlab',
        location:
          'url:https://gitlab.com/my-org/my-repo/-/blob/feature/x/catalog-info.yaml',
        target: '/wf.yaml',
        expectedUrl: 'https://gitlab.com/my-org/my-repo/-/blob/feature/wf.yaml',
      },
      {
        host: 'gitea',
        location:
          'url:https://gitea.example.com/my-org/my-repo/src/branch/feature/x/catalog-info.yaml',
        target: '../y/wf.yaml',
        expectedUrl:
          'https://gitea.example.com/my-org/my-repo/src/branch/feature/y/wf.yaml',
      },
      {
        host: 'gitea',
        location:
          'url:https://gitea.example.com/my-org/my-repo/src/branch/feature/x/catalog-info.yaml',
        target: './wf.yaml',
        expectedUrl:
          'https://gitea.example.com/my-org/my-repo/src/branch/feature/x/wf.yaml',
      },
      {
        host: 'raw.githubusercontent.com',
        location:
          'url:https://raw.githubusercontent.com/my-org/my-repo/feature/x/catalog-info.yaml',
        target: '../y/wf.yaml',
        expectedUrl:
          'https://raw.githubusercontent.com/my-org/my-repo/feature/y/wf.yaml',
      },
      {
        host: 'raw.githubusercontent.com',
        location:
          'url:https://raw.githubusercontent.com/my-org/my-repo/feature/x/catalog-info.yaml',
        target: './wf.yaml',
        expectedUrl:
          'https://raw.githubusercontent.com/my-org/my-repo/feature/x/wf.yaml',
      },
      {
        host: 'raw.githubusercontent.com',
        location:
          'url:https://raw.githubusercontent.com/my-org/my-repo/feature/x/catalog-info.yaml',
        target: '/wf.yaml',
        expectedUrl:
          'https://raw.githubusercontent.com/my-org/my-repo/feature/x/catalog-info.yaml/wf.yaml',
      },
    ];

    for (const c of allowedCases) {
      readUrl.mockClear();
      const result = await reader.read(entity(c.location), spec(c.target));
      expect(result.error).toBeUndefined();
      expect(readUrl).toHaveBeenCalledTimes(1);
      expect(readUrl).toHaveBeenCalledWith(c.expectedUrl);
    }

    const rejectedCases: Array<{
      host: string;
      location: string;
      target: string;
    }> = [
      // Gitea /wf.yaml resolves to .../src/branch/wf.yaml without a filepath segment after ref.
      {
        host: 'gitea',
        location:
          'url:https://gitea.example.com/my-org/my-repo/src/branch/feature/x/catalog-info.yaml',
        target: '/wf.yaml',
      },
      // Climbing past `feature/` still fails the repository boundary on every host.
      {
        host: 'github',
        location:
          'url:https://github.com/my-org/my-repo/blob/feature/x/catalog-info.yaml',
        target: '../../outside/wf.yaml',
      },
      {
        host: 'gitlab',
        location:
          'url:https://gitlab.com/my-org/my-repo/-/blob/feature/x/catalog-info.yaml',
        target: '../../outside/wf.yaml',
      },
      {
        host: 'gitea',
        location:
          'url:https://gitea.example.com/my-org/my-repo/src/branch/feature/x/catalog-info.yaml',
        target: '../../outside/wf.yaml',
      },
      {
        host: 'raw.githubusercontent.com',
        location:
          'url:https://raw.githubusercontent.com/my-org/my-repo/feature/x/catalog-info.yaml',
        target: '../../outside/wf.yaml',
      },
    ];

    for (const c of rejectedCases) {
      readUrl.mockClear();
      const result = await reader.read(entity(c.location), spec(c.target));
      expect(result.error?.kind).toBe('read');
      expect(result.error?.message).toContain('stay in the repository');
      expect(readUrl).not.toHaveBeenCalled();
    }
  });

  it('rejects relative targets that climb out of the repository or resolve elsewhere', async () => {
    const readUrl = jest.fn(async () => ({
      buffer: async () => Buffer.from('document: {dsl: 1.0.0}\ndo: []\n'),
    }));
    const integrations = ScmIntegrations.fromConfig(
      new ConfigReader({
        integrations: {
          github: [{ host: 'github.com' }],
          gitlab: [{ host: 'gitlab.com' }],
          azure: [{ host: 'dev.azure.com' }],
          gerrit: [
            {
              host: 'gerrit.example.com',
              gitilesBaseUrl: 'https://gerrit.example.com/plugins/gitiles',
            },
          ],
          harness: [{ host: 'app.harness.io' }],
        },
      }),
    );
    const reader = readerOf(readUrl, { integrations });

    const ghRoot = entity(
      'url:https://github.com/my-org/my-repo/blob/main/catalog-info.yaml',
    );
    const ghOneDir = entity(
      'url:https://github.com/my-org/my-repo/blob/main/services/catalog-info.yaml',
    );
    const azSubdir = entity(
      'url:https://dev.azure.com/my-org/my-project/_git/my-repo?path=/services/orders/catalog-info.yaml&version=GBmain',
    );

    const badCases: [ReturnType<typeof entity>, string][] = [
      [ghRoot, '../outside.yaml'],
      [ghRoot, '../main/order.yaml'],
      [ghRoot, '/../outside.yaml'],
      [ghRoot, '%2e%2e/outside.yaml'],
      [ghRoot, '%252e%252e/outside.yaml'],
      [ghOneDir, '%2e%2e/%2e%2e/main/x.yaml%'],
      [ghRoot, '//evil.example.com/a.yaml'],
      [ghRoot, '%68%74%74%70%73%3a%2f%2fevil.example.com/a.yaml'],
      [ghRoot, 'ht\ttps://github.com/my-org/my-repo/blob/main/other.yaml'],
      [ghRoot, '%20https://evil.example.com/a.yaml'],
      [ghRoot, '%20//evil.example.com/a.yaml'],
      [ghRoot, '.\t./outside.yaml'],
      [ghRoot, '..%09/outside.yaml'],
      [
        entity(
          'url:https://github.com/my-org/my-repo/blob/feat/sub/catalog-info.yaml',
        ),
        '.\t./.\t./feat/other.yaml',
      ],
      [ghOneDir, '../../outside.yaml'],
      [ghOneDir, '../../../other-repo/blob/main/order.yaml'],
      [ghOneDir, '../../../../other-org/other-repo/blob/main/order.yaml'],
      [azSubdir, '../../../outside.yaml'],
      [
        entity(
          'url:https://gerrit.example.com/plugins/gitiles/team/proj/+/refs/heads/main/catalog-info.yaml',
        ),
        '../../../../../../secret/+/refs/heads/main/x.yaml',
      ],
      [
        entity(
          'url:https://gerrit.example.com/plugins/gitiles/team/proj/+/refs/heads/main/services/catalog-info.yaml',
        ),
        '../other/x.yaml',
      ],
      [
        entity(
          'url:https://us-east-1.console.aws.amazon.com/codesuite/codecommit/repositories/repoA/browse/refs/heads/main/--/catalog-info.yaml?region=us-east-1',
        ),
        '../../../../../../repoB/browse/refs/heads/main/--/x.yaml',
      ],
      [
        entity(
          'url:https://app.harness.io/ng/account/A/module/code/orgs/O/projects/P/repos/R/files/main/~/catalog-info.yaml',
        ),
        '../../../../../../../../O2/projects/P2/repos/R2/files/main/~/x.yaml',
      ],
      [
        entity(
          'url:https://gitlab.com/grp/sub/repo/blob/main/catalog-info.yaml',
        ),
        '../../../other/blob/main/x.yaml',
      ],
      [
        entity(
          'url:https://gitlab.com/grp/x/src/a/b/proj/blob/main/catalog-info.yaml',
        ),
        '../../../../b2/proj2/blob/main/x.yaml',
      ],
      [
        entity(
          'url:https://app.harness.io/ng/account/A/module/code/orgs/src/projects/P/repos/R/files/main/~/catalog-info.yaml',
        ),
        '../../../../../../P2/repos/R2/files/main/~/x.yaml',
      ],
    ];
    for (const [ent, target] of badCases) {
      const result = await reader.read(ent, spec(target));
      expect(result.error?.kind).toBe('read');
      expect(result.error?.message).toContain('temporal.definitions.allow');
    }
    expect(readUrl).not.toHaveBeenCalled();

    // Even a backslash traversal is rejected before UrlReader is called.
    const backslash = await reader.read(ghRoot, spec('workflows\\order.yaml'));
    expect(backslash.error?.kind).toBe('read');

    // Guard post-resolution mismatch even if a custom integration returns another repo, branch, or host.
    for (const spoofed of [
      'https://github.com/my-org/other-repo/blob/main/order.yaml',
      'https://github.com/my-org/my-repo/blob/other-branch/order.yaml',
      'https://evil.example.com/order.yaml',
    ]) {
      const fakeIntegrations = {
        resolveUrl: jest.fn(() => spoofed),
        byUrl: jest.fn((u: string) => integrations.byUrl(u)),
      } as unknown as ScmIntegrations;
      const customReader = readerOf(readUrl, {
        integrations: fakeIntegrations,
      });
      const result = await customReader.read(ghRoot, spec('./order.yaml'));
      expect(result.error?.kind).toBe('read');
      expect(result.error?.message).toContain('temporal.definitions.allow');
    }
    expect(readUrl).not.toHaveBeenCalled();
  });

  describe('URL shapes of other integration types', () => {
    const okReadUrl = () =>
      jest.fn(async () => ({
        buffer: async () => Buffer.from('document: {dsl: 1.0.0}\ndo: []\n'),
      }));
    const typedReader = (readUrl: jest.Mock) =>
      readerOf(readUrl, {
        integrations: ScmIntegrations.fromConfig(
          new ConfigReader({
            integrations: {
              github: [{ host: 'github.com' }],
              gerrit: [
                {
                  host: 'gerrit.example.com',
                  gitilesBaseUrl: 'https://gerrit.example.com/plugins/gitiles',
                },
              ],
              harness: [{ host: 'app.harness.io' }],
            },
          }),
        ),
      });
    const expectRejected = async (location: string, target: string) => {
      const readUrl = okReadUrl();
      const result = await typedReader(readUrl).read(
        entity(`url:${location}`),
        spec(target),
      );
      expect(result.error?.kind).toBe('read');
      expect(result.error?.message).toContain('temporal.definitions.allow');
      expect(readUrl).not.toHaveBeenCalled();
    };

    it('does not read a Gerrit project named like a Gitea URL', async () => {
      await expectRejected(
        'https://gerrit.example.com/plugins/gitiles/src/branch/main/att/+/refs/heads/main/catalog-info.yaml',
        '../../../../../victim/+/refs/heads/main/x.yaml',
      );
    });

    it('does not read a Gerrit project named like a GitLab URL', async () => {
      await expectRejected(
        'https://gerrit.example.com/plugins/gitiles/team/-/blob/x/att/+/refs/heads/main/catalog-info.yaml',
        '../../../../../victim/+/refs/heads/main/x.yaml',
      );
    });

    it('bounds other integration types to the folder of the entity file', async () => {
      // The same Gerrit names with encoded slashes and dots.
      await expectRejected(
        'https://gerrit.example.com/plugins/gitiles/src%2Fbranch%2Fmain%2Fatt/+/refs/heads/main/catalog-info.yaml',
        '%2e%2e/%2e%2e/%2e%2e/%2e%2e/%2e%2e/victim/+/refs/heads/main/x.yaml',
      );
      await expectRejected(
        'https://gerrit.example.com/plugins/gitiles/team/-/blob/x/att/+/refs/heads/main/catalog-info.yaml',
        '..%2f..%2f..%2f..%2f..%2fvictim/+/refs/heads/main/x.yaml',
      );
      // A Bitbucket Server URL shape on a Harness host.
      await expectRejected(
        'https://app.harness.io/projects/p/repos/r/browse/a/catalog-info.yaml',
        '../x.yaml',
      );

      // Inside the folder of the entity file is still read.
      const readUrl = okReadUrl();
      expect(
        (
          await typedReader(readUrl).read(
            entity(
              'url:https://gerrit.example.com/plugins/gitiles/src/branch/main/att/+/refs/heads/main/catalog-info.yaml',
            ),
            spec('./workflows/x.yaml'),
          )
        ).error,
      ).toBeUndefined();
      expect(readUrl).toHaveBeenLastCalledWith(
        'https://gerrit.example.com/plugins/gitiles/src/branch/main/att/+/refs/heads/main/workflows/x.yaml',
      );
    });

    it('keeps the GitHub boundary for a folder named like a GitLab URL', async () => {
      const readUrl = okReadUrl();
      expect(
        (
          await typedReader(readUrl).read(
            entity(
              'url:https://github.com/my-org/my-repo/blob/main/-/blob/x/catalog-info.yaml',
            ),
            spec('../../../order.yaml'),
          )
        ).error,
      ).toBeUndefined();
      expect(readUrl).toHaveBeenLastCalledWith(
        'https://github.com/my-org/my-repo/tree/main/order.yaml',
      );
    });
  });

  it('says that folder-bounded hosts read only the folder of the entity file', async () => {
    const readUrl = jest.fn();
    const reader = readerOf(readUrl, {
      integrations: ScmIntegrations.fromConfig(
        new ConfigReader({
          integrations: {
            github: [{ host: 'github.com' }],
            gerrit: [
              {
                host: 'gerrit.example.com',
                gitilesBaseUrl: 'https://gerrit.example.com/plugins/gitiles',
              },
            ],
          },
        }),
      ),
    });
    const gerrit = entity(
      'url:https://gerrit.example.com/plugins/gitiles/team/proj/+/refs/heads/main/a/catalog-info.yaml',
    );
    for (const target of ['../w.yaml', '/w.yaml', '%2e%2e/w.yaml']) {
      const message = (await reader.read(gerrit, spec(target))).error?.message;
      expect(message).toContain(
        'must stay in the folder of the entity file or below it',
      );
      expect(message).not.toContain('repository of the entity');
      expect(message).toContain('temporal.definitions.allow');
    }
    const github = await reader.read(
      entity(
        'url:https://github.com/my-org/my-repo/blob/main/catalog-info.yaml',
      ),
      spec('../w.yaml'),
    );
    expect(github.error?.message).toContain(
      'must stay in the repository of the entity',
    );
    expect(readUrl).not.toHaveBeenCalled();
  });

  it('bounds a file at the root of a bucket host by that host', async () => {
    const readUrl = jest.fn(async () => ({
      buffer: async () => Buffer.from('document: {dsl: 1.0.0}\ndo: []\n'),
    }));
    const reader = readerOf(readUrl, {
      integrations: ScmIntegrations.fromConfig(
        new ConfigReader({
          integrations: {
            github: [{ host: 'github.com' }],
            gerrit: [
              {
                host: 'gerrit.example.com',
                gitilesBaseUrl: 'https://gerrit.example.com/plugins/gitiles',
              },
            ],
          },
        }),
      ),
    });
    const bucketRoot = entity(
      'url:https://my-bucket.s3.us-east-1.amazonaws.com/catalog-info.yaml',
    );
    for (const [target, url] of [
      ['./w.yaml', 'https://my-bucket.s3.us-east-1.amazonaws.com/w.yaml'],
      ['w.yaml', 'https://my-bucket.s3.us-east-1.amazonaws.com/w.yaml'],
      [
        './workflows/w.yaml',
        'https://my-bucket.s3.us-east-1.amazonaws.com/workflows/w.yaml',
      ],
    ]) {
      expect(
        (await reader.read(bucketRoot, spec(target))).error,
      ).toBeUndefined();
      expect(readUrl).toHaveBeenLastCalledWith(url);
    }
    readUrl.mockClear();

    const rejected: [ReturnType<typeof entity>, string][] = [
      [bucketRoot, '../w.yaml'],
      [bucketRoot, '%2e%2e/w.yaml'],
      [bucketRoot, './../other-bucket/w.yaml'],
      [bucketRoot, '/w.yaml'],
      [bucketRoot, './'],
      [bucketRoot, '//other-bucket.s3.us-east-1.amazonaws.com/w.yaml'],
      // On path-style hosts the first segment is the bucket, so the host
      // root is not a boundary.
      [
        entity('url:https://s3.us-east-1.amazonaws.com/catalog-info.yaml'),
        './other-bucket/w.yaml',
      ],
      [
        entity('url:https://s3.amazonaws.com/catalog-info.yaml'),
        './other-bucket/w.yaml',
      ],
      [
        entity('url:https://s3-us-west-2.amazonaws.com/catalog-info.yaml'),
        './other-bucket/w.yaml',
      ],
      // Hosts with an integration have no files at their root.
      [
        entity('url:https://github.com/catalog-info.yaml'),
        './my-org/my-repo/blob/main/w.yaml',
      ],
      [
        entity('url:https://gerrit.example.com/catalog-info.yaml'),
        './plugins/gitiles/proj/+/refs/heads/main/w.yaml',
      ],
    ];
    for (const [ent, target] of rejected) {
      const result = await reader.read(ent, spec(target));
      expect(result.error?.kind).toBe('read');
      expect(result.error?.message).toContain('temporal.definitions.allow');
    }
    expect(readUrl).not.toHaveBeenCalled();
  });

  it('checks long hostnames of entity locations in linear time', async () => {
    const readUrl = jest.fn(async () => ({
      buffer: async () => Buffer.from('document: {dsl: 1.0.0}\ndo: []\n'),
    }));
    const reader = readerOf(readUrl);
    for (const host of [
      `s3.${'-'.repeat(60)}.amazonaws.com.`,
      `s3${'-'.repeat(60)}.amazonaws.com.cn.`,
      `s3.${'-a'.repeat(30)}.amazonaws.co`,
    ]) {
      const start = Date.now();
      await reader.read(
        entity(`url:https://${host}/catalog-info.yaml`),
        spec('./w.yaml'),
      );
      // Backtracking over each way to split the dashes takes seconds.
      expect(Date.now() - start).toBeLessThan(500);
    }
    for (const host of [
      's3.dualstack.eu-central-1.amazonaws.com',
      's3.cn-north-1.amazonaws.com.cn',
      's3-external-1.amazonaws.com',
    ]) {
      const result = await reader.read(
        entity(`url:https://${host}/catalog-info.yaml`),
        spec('./other-bucket/w.yaml'),
      );
      expect(result.error?.message).toContain('temporal.definitions.allow');
    }
  });

  it('stops reading at the size limit', async () => {
    const big = Buffer.alloc(64, 'a');
    const stream = Readable.from([big, big, big]);
    const readUrl = jest.fn(async () => ({
      buffer: async () => Buffer.concat([big, big, big]),
      stream: () => stream,
    }));
    const allow = [{ host: 'raw.example.com' }];
    const result = await readerOf(readUrl, { maxBytes: 100, allow }).read(
      entity(),
      spec('https://raw.example.com/order.yaml'),
    );
    expect(result.error).toEqual({
      kind: 'tooLarge',
      message: 'The file is larger than 100 bytes',
    });
    expect(result.content).toBeUndefined();
    expect(stream.destroyed).toBe(true);

    const noStream = jest.fn(async () => ({
      buffer: async () => Buffer.concat([big, big]),
    }));
    expect(
      (
        await readerOf(noStream, { maxBytes: 100, allow }).read(
          entity(),
          spec('https://raw.example.com/order.yaml'),
        )
      ).error?.kind,
    ).toBe('tooLarge');
  });

  it('reports files that cannot be read', async () => {
    const missing = jest.fn(async () => {
      throw new NotFoundError('nope');
    });
    expect(
      (
        await readerOf(missing, {
          allow: [{ host: 'raw.example.com' }],
        }).read(entity(), spec('https://raw.example.com/order.yaml'))
      ).error,
    ).toEqual({ kind: 'read', message: 'The file was not found' });

    const notAllowed = jest.fn(async () => {
      throw new Error('Reading from https://evil.example.com is not allowed');
    });
    const result = await readerOf(notAllowed, {
      allow: [{ host: 'evil.example.com' }],
    }).read(entity(), spec('https://evil.example.com/order.yaml'));
    expect(result.error?.kind).toBe('read');
    expect(result.error?.message).toContain('integrations');
  });

  it('accepts only http and https URLs and needs a location for paths', async () => {
    const readUrl = jest.fn();
    const reader = readerOf(readUrl);
    expect(
      (await reader.read(entity(), spec('ftp://example.com/a.yaml'))).error,
    ).toEqual({ kind: 'read', message: 'Only http and https URLs are read' });
    expect(
      (await reader.read(entity(), spec('./a.yaml'))).error?.message,
    ).toContain('no location');
    expect(
      (await reader.read(entity('file:/catalog/entities.yaml'), spec('a.yaml')))
        .error?.message,
    ).toContain('temporal.definitions.readFileLocations');
    expect(readUrl).not.toHaveBeenCalled();
  });

  it('reads files next to a file location only when allowed and inside its folder', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tp-def-'));
    try {
      mkdirSync(join(dir, 'workflows'));
      writeFileSync(join(dir, 'workflows', 'order.yaml'), fixture);
      writeFileSync(join(dir, 'big.yaml'), Buffer.alloc(200, 'a'));
      const reader = readerOf(jest.fn(), {
        readFileLocations: true,
        maxBytes: 150 + fixture.length,
      });
      const location = `file:${join(dir, 'entities.yaml')}`;
      const ok = await reader.read(
        entity(location),
        spec('./workflows/order.yaml'),
      );
      expect(ok.error).toBeUndefined();
      expect(ok.url).toBeUndefined();
      expect(ok.tasks).toHaveLength(19);
      expect(
        (await reader.read(entity(location), spec('../outside.yaml'))).error
          ?.message,
      ).toContain('stay in the folder');
      expect(
        (await reader.read(entity(location), spec('missing.yaml'))).error,
      ).toEqual({ kind: 'read', message: 'The file was not found' });
      const small = readerOf(jest.fn(), {
        readFileLocations: true,
        maxBytes: 100,
      });
      expect(
        (await small.read(entity(location), spec('big.yaml'))).error?.kind,
      ).toBe('tooLarge');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reads only regular files in the real folder of a file location', async () => {
    const root = mkdtempSync(join(tmpdir(), 'tp-def-'));
    try {
      const dir = join(root, 'catalog');
      mkdirSync(join(dir, 'workflows'), { recursive: true });
      mkdirSync(join(dir, 'folder.yaml'));
      writeFileSync(join(dir, 'workflows', 'order.yaml'), fixture);
      writeFileSync(join(root, 'secret.yaml'), fixture);
      symlinkSync(
        join(dir, 'workflows', 'order.yaml'),
        join(dir, 'inside.yaml'),
      );
      symlinkSync(join(root, 'secret.yaml'), join(dir, 'outside.yaml'));
      symlinkSync(root, join(dir, 'up'));
      symlinkSync('/dev/zero', join(dir, 'zero.yaml'));
      const reader = readerOf(jest.fn(), { readFileLocations: true });
      const location = entity(`file:${join(dir, 'entities.yaml')}`);
      const read = (target: string) => reader.read(location, spec(target));

      const inside = await read('./inside.yaml');
      expect(inside.error).toBeUndefined();
      expect(inside.tasks).toHaveLength(19);

      for (const target of ['./outside.yaml', './up/secret.yaml']) {
        const result = await read(target);
        expect(result.error).toEqual({
          kind: 'read',
          message:
            'A target next to a file location must stay in the folder of the entity file',
        });
        expect(result.content).toBeUndefined();
      }
      expect((await read('./folder.yaml')).error).toEqual({
        kind: 'read',
        message: 'The target is not a regular file',
      });
      // A device outside the folder is not opened at all.
      expect((await read('./zero.yaml')).error).toEqual({
        kind: 'read',
        message:
          'A target next to a file location must stay in the folder of the entity file',
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('answers the same for files outside the folder and opens none of them', async () => {
    const root = mkdtempSync(join(tmpdir(), 'tp-def-'));
    const opened: string[] = [];
    const realOpen = fsPromises.open;
    const spy = jest.spyOn(fsPromises, 'open').mockImplementation(((
      path: any,
      ...rest: any[]
    ) => {
      opened.push(String(path));
      return (realOpen as any)(path, ...rest);
    }) as any);
    try {
      const dir = join(root, 'catalog');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(root, 'secret.yaml'), fixture);
      symlinkSync(join(root, 'secret.yaml'), join(dir, 'existing.yaml'));
      symlinkSync(join(root, 'nothing.yaml'), join(dir, 'missing.yaml'));
      mkdirSync(join(root, 'locked'));
      writeFileSync(join(root, 'locked', 'a.yaml'), fixture);
      symlinkSync(join(root, 'locked', 'a.yaml'), join(dir, 'locked.yaml'));
      const reader = readerOf(jest.fn(), { readFileLocations: true });
      const location = entity(`file:${join(dir, 'entities.yaml')}`);
      const read = (target: string) => reader.read(location, spec(target));

      const results = [];
      for (const target of ['./existing.yaml', './missing.yaml']) {
        results.push(await read(target));
      }
      // A directory without the search permission, as for a normal user.
      chmodSync(join(root, 'locked'), 0o000);
      try {
        results.push(await read('./locked.yaml'));
      } finally {
        chmodSync(join(root, 'locked'), 0o755);
      }
      for (const result of results) {
        expect(result.error).toEqual({
          kind: 'read',
          message:
            'A target next to a file location must stay in the folder of the entity file',
        });
        expect(result.content).toBeUndefined();
      }
      expect(opened).toEqual([]);

      // A name that is missing in the folder is still reported as missing.
      expect((await read('./absent.yaml')).error).toEqual({
        kind: 'read',
        message: 'The file was not found',
      });
      expect(opened).toEqual([]);
    } finally {
      spy.mockRestore();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not wait on a FIFO next to a file location', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tp-def-'));
    try {
      execFileSync('mkfifo', [join(dir, 'fifo.yaml')]);
      const reader = readerOf(jest.fn(), { readFileLocations: true });
      const result = await reader.read(
        entity(`file:${join(dir, 'entities.yaml')}`),
        spec('./fifo.yaml'),
      );
      expect(result.error).toEqual({
        kind: 'read',
        message: 'The target is not a regular file',
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reads serverless-workflow definitions only from YAML files', async () => {
    const readUrl = jest.fn(async () => ({
      buffer: async () => Buffer.from('SECRET=1\n'),
    }));
    const reader = readerOf(readUrl, {
      allow: [{ host: 'raw.example.com' }],
    });
    const located = entity(
      'url:https://github.com/acme/flows/blob/main/catalog-info.yaml',
    );
    for (const target of [
      './.env',
      './config/app.json',
      './order.yaml.txt',
      'https://raw.example.com/acme/flows/.env',
    ]) {
      expect((await reader.read(located, spec(target))).error).toEqual({
        kind: 'read',
        message:
          'A serverless-workflow definition must be a .yaml or .yml file',
      });
    }
    expect(readUrl).not.toHaveBeenCalled();

    for (const target of ['./order.yml', './order.YAML']) {
      expect(
        (await reader.read(located, spec(target))).error?.message,
      ).not.toContain('.yaml or .yml');
    }
  });

  it('checks the extension in the path parameter of Azure DevOps URLs', async () => {
    const readUrl = jest.fn(async () => ({
      buffer: async () => Buffer.from(fixture),
    }));
    const integrations = ScmIntegrations.fromConfig(
      new ConfigReader({
        integrations: { azure: [{ host: 'dev.azure.com' }] },
      }),
    );
    const reader = readerOf(readUrl, { integrations });
    const located = entity(
      'url:https://dev.azure.com/my-org/my-project/_git/my-repo?path=/services/catalog-info.yaml&version=GBmain',
    );

    for (const target of ['./.env', './config/app.json']) {
      expect((await reader.read(located, spec(target))).error).toEqual({
        kind: 'read',
        message:
          'A serverless-workflow definition must be a .yaml or .yml file',
      });
    }
    expect(readUrl).not.toHaveBeenCalled();

    const ok = await reader.read(located, spec('./order.yaml'));
    expect(ok.error).toBeUndefined();
    expect(readUrl).toHaveBeenCalledTimes(1);
    expect(String((readUrl.mock.calls as unknown[][])[0][0])).toContain(
      'path=%2Fservices%2Forder.yaml',
    );
  });

  it('returns the text of a definition only when it can be parsed', async () => {
    const text = jest.fn<Promise<string>, []>();
    const readUrl = jest.fn(async () => ({
      buffer: async () => Buffer.from(await text()),
    }));
    const reader = readerOf(readUrl, {
      allow: [{ host: 'raw.example.com' }],
      cacheTtlSeconds: 0,
    });
    const read = () =>
      reader.read(entity(), spec('https://raw.example.com/order.yaml'));

    text.mockResolvedValue(fixture);
    const ok = await read();
    expect(ok.error).toBeUndefined();
    expect(ok.content).toBe(fixture);

    for (const [body, kind] of [
      ['token: abc\nother: [\n', 'parse'],
      ['token: abc\n', 'format'],
      ['TOKEN=abc\n', 'format'],
    ]) {
      text.mockResolvedValue(body);
      const result = await read();
      expect(result.error?.kind).toBe(kind);
      expect(result.content).toBeUndefined();
      expect(result.size).toBe(body.length);
    }
  });

  it('checks the configured limits and allowlist rules', () => {
    const urlReader = mockServices.urlReader.mock();
    expect(
      DefinitionReader.fromConfig(new ConfigReader({}), urlReader).maxBytes,
    ).toBe(1024 * 1024);
    expect(() =>
      DefinitionReader.fromConfig(
        new ConfigReader({ temporal: { definitions: { maxBytes: 0 } } }),
        urlReader,
      ),
    ).toThrow('temporal.definitions.maxBytes');
    expect(() =>
      DefinitionReader.fromConfig(
        new ConfigReader({
          temporal: {
            definitions: {
              allow: [
                {
                  host: 'raw.githubusercontent.com',
                  paths: ['/my-org/my-repo/'],
                },
              ],
            },
          },
        }),
        urlReader,
      ),
    ).not.toThrow();
    for (const badRule of [
      { host: 'bad/host' },
      { host: '*.*.com' },
      { host: 'example.com:99999' },
      { host: 'example.com', paths: ['relative/path'] },
      { host: 'example.com', paths: ['/org/../secret'] },
    ]) {
      expect(() =>
        DefinitionReader.fromConfig(
          new ConfigReader({ temporal: { definitions: { allow: [badRule] } } }),
          urlReader,
        ),
      ).toThrow('temporal.definitions.allow');
    }
  });

  it('warns on allow rules without paths for Backstage integration hosts and skips warning otherwise', () => {
    const urlReader = mockServices.urlReader.mock();
    const warnFor = (data: ConstructorParameters<typeof ConfigReader>[0]) => {
      const logger = mockServices.logger.mock();
      logger.child.mockReturnValue(logger);
      const reader = DefinitionReader.fromConfig(
        new ConfigReader(data),
        urlReader,
        logger,
      );
      return { logger, reader };
    };

    const exactIntegration = warnFor({
      integrations: { github: [{ host: 'git.example.com' }] },
      temporal: { definitions: { allow: [{ host: 'git.example.com' }] } },
    });
    expect(exactIntegration.reader).toBeInstanceOf(DefinitionReader);
    expect(exactIntegration.logger.child).toHaveBeenCalledWith({
      host: 'git.example.com',
    });
    expect(exactIntegration.logger.warn).toHaveBeenCalledTimes(1);
    expect(exactIntegration.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('paths'),
    );

    const builtInIntegration = warnFor({
      temporal: { definitions: { allow: [{ host: 'github.com' }] } },
    });
    expect(builtInIntegration.logger.warn).toHaveBeenCalledTimes(1);

    const wildcardIntegration = warnFor({
      integrations: { github: [{ host: 'git.example.com' }] },
      temporal: { definitions: { allow: [{ host: '*.example.com' }] } },
    });
    expect(wildcardIntegration.logger.child).toHaveBeenCalledWith({
      host: '*.example.com',
    });
    expect(wildcardIntegration.logger.warn).toHaveBeenCalledTimes(1);

    const withPaths = warnFor({
      integrations: { github: [{ host: 'git.example.com' }] },
      temporal: {
        definitions: {
          allow: [{ host: 'git.example.com', paths: ['/my-org/'] }],
        },
      },
    });
    expect(withPaths.logger.warn).not.toHaveBeenCalled();

    const nonIntegration = warnFor({
      temporal: {
        definitions: {
          allow: [
            { host: 'docs.internal.example.test' },
            { host: '*.unconfigured.test' },
          ],
        },
      },
    });
    expect(nonIntegration.logger.warn).not.toHaveBeenCalled();
  });

  describe('URL read cache and limits', () => {
    const location =
      'url:https://git.example.com/org/repo/blob/main/catalog-info.yaml';
    const target = (name: string) => spec(`./${name}.yaml`);
    const ok = () => ({
      buffer: async () => Buffer.from(fixture),
    });

    beforeEach(() => {
      jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
      jest.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    });
    afterEach(() => {
      jest.useRealTimers();
    });

    it('serves a repeated read from memory until the TTL ends', async () => {
      const readUrl = jest.fn(async () => ok());
      const reader = readerOf(readUrl, { cacheTtlSeconds: 30 });
      await reader.read(entity(location), target('a'));
      jest.advanceTimersByTime(29_000);
      const hit = await reader.read(entity(location), target('a'));
      expect(hit.size).toBe(Buffer.byteLength(fixture));
      expect(readUrl).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(2_000);
      await reader.read(entity(location), target('a'));
      expect(readUrl).toHaveBeenCalledTimes(2);

      await reader.read(entity(location), target('b'));
      expect(readUrl).toHaveBeenCalledTimes(3);
    });

    it('does not cache when the TTL is 0', async () => {
      const readUrl = jest.fn(async () => ok());
      const reader = readerOf(readUrl, { cacheTtlSeconds: 0 });
      await reader.read(entity(location), target('a'));
      await reader.read(entity(location), target('a'));
      expect(readUrl).toHaveBeenCalledTimes(2);
    });

    it('does not cache a failed read', async () => {
      const readUrl = jest
        .fn()
        .mockRejectedValueOnce(new Error('connection reset'))
        .mockResolvedValue(ok());
      const reader = readerOf(readUrl);
      const failed = await reader.read(entity(location), target('a'));
      expect(failed.error?.kind).toBe('read');
      const retried = await reader.read(entity(location), target('a'));
      expect(retried.error).toBeUndefined();
      expect(readUrl).toHaveBeenCalledTimes(2);
    });

    it('drops the least recently used entry above the capacity', async () => {
      const readUrl = jest.fn(async () => ok());
      const reader = readerOf(readUrl, { cacheMaxEntries: 2 });
      await reader.read(entity(location), target('a'));
      await reader.read(entity(location), target('b'));
      await reader.read(entity(location), target('a')); // a is now newest
      await reader.read(entity(location), target('c')); // drops b
      expect(readUrl).toHaveBeenCalledTimes(3);
      await reader.read(entity(location), target('a'));
      expect(readUrl).toHaveBeenCalledTimes(3);
      await reader.read(entity(location), target('b'));
      expect(readUrl).toHaveBeenCalledTimes(4);
    });

    it('shares one read between simultaneous requests for a URL', async () => {
      let release: () => void = () => {};
      const readUrl = jest.fn(
        () =>
          new Promise(resolve => {
            release = () => resolve(ok());
          }),
      );
      const reader = readerOf(readUrl);
      const first = reader.read(entity(location), target('a'));
      const second = reader.read(entity(location), target('a'));
      await Promise.resolve();
      release();
      const [one, two] = await Promise.all([first, second]);
      expect(readUrl).toHaveBeenCalledTimes(1);
      expect(one.error).toBeUndefined();
      expect(two.error).toBeUndefined();
    });

    it('runs at most maxConcurrentReads reads at once', async () => {
      const releases: Array<() => void> = [];
      const readUrl = jest.fn(
        () =>
          new Promise(resolve => {
            releases.push(() => resolve(ok()));
          }),
      );
      const reader = readerOf(readUrl, { maxConcurrentReads: 2 });
      const reads = ['a', 'b', 'c'].map(name =>
        reader.read(entity(location), target(name)),
      );
      await new Promise(resolve => setImmediate(resolve));
      expect(readUrl).toHaveBeenCalledTimes(2);
      releases[0]();
      await new Promise(resolve => setImmediate(resolve));
      expect(readUrl).toHaveBeenCalledTimes(3);
      releases[1]();
      releases[2]();
      const results = await Promise.all(reads);
      expect(results.every(r => !r.error)).toBe(true);
    });

    it('refuses reads above maxReadsPerMinute until the minute ends', async () => {
      const readUrl = jest.fn(async () => ok());
      const reader = readerOf(readUrl, {
        maxReadsPerMinute: 2,
        cacheTtlSeconds: 0,
      });
      await reader.read(entity(location), target('a'));
      await reader.read(entity(location), target('b'));
      const limited = await reader.read(entity(location), target('c'));
      expect(limited.error).toMatchObject({ kind: 'read' });
      expect(limited.error?.message).toMatch(/try again/);
      expect(readUrl).toHaveBeenCalledTimes(2);

      jest.advanceTimersByTime(60_000);
      const again = await reader.read(entity(location), target('c'));
      expect(again.error).toBeUndefined();
      expect(readUrl).toHaveBeenCalledTimes(3);
    });

    it('does not count cache hits against maxReadsPerMinute', async () => {
      const readUrl = jest.fn(async () => ok());
      const reader = readerOf(readUrl, { maxReadsPerMinute: 1 });
      for (let i = 0; i < 5; i++) {
        const result = await reader.read(entity(location), target('a'));
        expect(result.error).toBeUndefined();
      }
      expect(readUrl).toHaveBeenCalledTimes(1);
    });

    it('rejects invalid cache and limit settings', () => {
      const build = (definitions: Record<string, number>) =>
        DefinitionReader.fromConfig(
          new ConfigReader({ temporal: { definitions } }),
          mockServices.urlReader.mock(),
        );
      expect(() => build({ cacheTtlSeconds: -1 })).toThrow(/cacheTtlSeconds/);
      expect(() => build({ cacheMaxEntries: 0 })).toThrow(/cacheMaxEntries/);
      expect(() => build({ maxConcurrentReads: 0 })).toThrow(
        /maxConcurrentReads/,
      );
      expect(() => build({ maxReadsPerMinute: 1.5 })).toThrow(
        /maxReadsPerMinute/,
      );
      expect(() => build({ cacheTtlSeconds: 0 })).not.toThrow();
    });
  });

  describe('targets and settings without a matching rule', () => {
    const noRead = jest.fn(async () => {
      throw new Error('not read');
    });

    it.each([
      ['https://', 'spec.definition.target is not a valid URL'],
      ['https://exa mple.com/order.yaml', 'spec.definition.target is not a valid URL'],
    ])('reports the absolute target %s as an invalid URL', async (target, message) => {
      const result = await readerOf(noRead, {
        allow: [{ host: 'example.com' }],
      }).read(entity(), spec(target));
      expect(result).toEqual({
        format: 'serverless-workflow',
        target,
        tasks: [],
        error: { kind: 'read', message },
      });
      expect(noRead).not.toHaveBeenCalled();
    });

    it('reports a location annotation that cannot be parsed and a location type that is not read', async () => {
      const reader = readerOf(noRead, { readFileLocations: true });
      expect(
        (await reader.read(entity('no-type'), spec('./order.yaml'))).error,
      ).toEqual({
        kind: 'read',
        message: 'Invalid backstage.io/managed-by-location annotation',
      });
      expect(
        (await reader.read(entity('bootstrap:bootstrap'), spec('./order.yaml')))
          .error,
      ).toEqual({
        kind: 'read',
        message:
          'Locations of type bootstrap are not supported; use an absolute URL and allow it in temporal.definitions.allow',
      });
      expect(noRead).not.toHaveBeenCalled();
    });

    it('reports a file location whose folder does not exist like a file outside the folder', async () => {
      const missing = join(tmpdir(), 'definition-missing-folder', 'nested');
      const result = await readerOf(noRead, { readFileLocations: true }).read(
        entity(`file:${join(missing, 'catalog-info.yaml')}`),
        spec('./order.yaml'),
      );
      expect(result).toEqual({
        format: 'serverless-workflow',
        target: './order.yaml',
        tasks: [],
        url: undefined,
        error: {
          kind: 'read',
          message:
            'A target next to a file location must stay in the folder of the entity file',
        },
      });
    });

    it.each([
      ['', 'invalid host ""'],
      ['a:1:2', 'invalid host "a:1:2"'],
      [':8080', 'invalid host ":8080"'],
      ['example.com:', 'invalid host "example.com:"'],
      ['example.com:0', 'invalid host "example.com:0"'],
      ['example.com:70000', 'invalid host "example.com:70000"'],
      ['example.com:90-80', 'invalid host "example.com:90-80"'],
      ['example.com:1-2-3', 'invalid host "example.com:1-2-3"'],
      ['user@example.com', 'invalid host "user@example.com"'],
      ['exa[mple.com', 'invalid host "exa[mple.com"'],
      ['*.', 'invalid host wildcard "*."'],
      ['*.a.*.com', 'invalid host wildcard "*.a.*.com"'],
      ['*..example.com', 'invalid host wildcard "*..example.com"'],
      ['ex*mple.com', 'invalid host wildcard "ex*mple.com"'],
    ])('rejects the allowed host "%s"', (host, message) => {
      expect(() => readerOf(noRead, { allow: [{ host }] })).toThrow(
        new Error(`temporal.definitions.allow: ${message}`),
      );
    });

    it.each(['relative', '/a b', '/a\\b', '/a/../b'])(
      'rejects the allowed path "%s"',
      path => {
        expect(() =>
          readerOf(noRead, { allow: [{ host: 'example.com', paths: [path] }] }),
        ).toThrow(new Error(`temporal.definitions.allow: invalid path "${path}"`));
      },
    );

    it('matches the port of an allowed host: none, one, or a range', async () => {
      const read = async (host: string, target: string) => {
        const readUrl = jest.fn(async () => ({
          buffer: async () => Buffer.from(fixture),
        }));
        const result = await readerOf(readUrl, { allow: [{ host }] }).read(
          entity(),
          spec(target),
        );
        return result.error?.message ?? 'read';
      };
      expect(await read('example.com', 'https://example.com/a.yaml')).toBe(
        'read',
      );
      expect(await read('example.com', 'https://example.com:8443/a.yaml')).toBe(
        'Absolute definition URLs from example.com:8443 are not allowed; use a path relative to the entity, or add host: example.com:8443 under temporal.definitions.allow',
      );
      expect(await read('example.com:443', 'https://example.com/a.yaml')).toBe(
        'read',
      );
      expect(await read('example.com:80', 'http://example.com/a.yaml')).toBe(
        'read',
      );
      expect(
        await read('example.com:8000-8100', 'https://example.com:8050/a.yaml'),
      ).toBe('read');
      expect(
        await read('example.com:8000-8100', 'https://example.com:8101/a.yaml'),
      ).toBe(
        'Absolute definition URLs from example.com:8101 are not allowed; use a path relative to the entity, or add host: example.com:8101 under temporal.definitions.allow',
      );
      expect(
        await read('*.example.com', 'https://raw.example.com/a.yaml'),
      ).toBe('read');
      expect(await read('*.example.com', 'https://example.com/a.yaml')).toBe(
        'Absolute definition URLs from example.com are not allowed; use a path relative to the entity, or add host: example.com under temporal.definitions.allow',
      );
    });

    it('answers a file that passes the limit while it is read like a file that is too large', async () => {
      const readUrl = jest.fn(async () => ({
        buffer: async () => Buffer.alloc(0),
        stream: () => Readable.from([Buffer.alloc(6), Buffer.alloc(6)]),
      }));
      const result = await readerOf(readUrl, {
        maxBytes: 10,
        allow: [{ host: 'example.com' }],
      }).read(entity(), spec('https://example.com/a.yaml'));
      expect(result).toEqual({
        format: 'serverless-workflow',
        target: 'https://example.com/a.yaml',
        tasks: [],
        url: 'https://example.com/a.yaml',
        error: {
          kind: 'tooLarge',
          message: 'The file is larger than 10 bytes',
        },
      });
    });
  });
});
