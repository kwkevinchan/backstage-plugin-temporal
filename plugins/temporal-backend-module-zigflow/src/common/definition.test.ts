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
  buildEntityDefinitionPath,
  findSymbolLines,
  sourceLanguageOf,
  walkDefinitionTasks,
} from './definition';

describe('workflow definitions', () => {
  it('builds the path of a definition', () => {
    expect(
      buildEntityDefinitionPath({
        kind: 'TemporalWorkflow',
        namespace: 'default',
        name: 'Flow',
      }),
    ).toBe('/entities/temporalworkflow/default/flow/definition');
  });

  it('walks the tasks with their pointers and Zigflow task paths', () => {
    const seen: [string, string, boolean, string | undefined][] = [];
    walkDefinitionTasks(
      {
        do: [
          { 'a/b': { set: {} } },
          { t: { try: [{ x: { set: {} } }], catch: { do: [{ y: {} }] } } },
          { f: { fork: { branches: [{ br: { do: [{ z: {} }] } }] } } },
          { l: { for: { in: '${ . }' }, do: [{ s: {} }] } },
          'not a task',
          { two: {}, keys: {} },
        ],
      },
      v => seen.push([v.pointer, v.taskPath.join('.'), v.inFork, v.parent]),
    );
    expect(seen).toEqual([
      ['/do/0/a~1b', 'a/b', false, undefined],
      ['/do/1/t', 't', false, undefined],
      ['/do/1/t/try/0/x', 't.try.x', false, '/do/1/t'],
      ['/do/1/t/catch/do/0/y', 't.catch.y', false, '/do/1/t'],
      ['/do/2/f', 'f', false, undefined],
      ['/do/2/f/fork/branches/0/br', 'f.br', true, '/do/2/f'],
      [
        '/do/2/f/fork/branches/0/br/do/0/z',
        'f.br.z',
        true,
        '/do/2/f/fork/branches/0/br',
      ],
      ['/do/3/l', 'l', false, undefined],
      ['/do/3/l/do/0/s', 'l.s', false, '/do/3/l'],
    ]);
  });
});

describe('sourceLanguageOf', () => {
  it('knows the language from the extension', () => {
    expect(sourceLanguageOf('./src/workflows.ts')).toBe('typescript');
    expect(sourceLanguageOf('https://x/y/w.mjs?ref=main')).toBe('javascript');
    expect(sourceLanguageOf('./w.py')).toBe('python');
    expect(sourceLanguageOf('./w.go')).toBe('go');
    expect(sourceLanguageOf('./W.java')).toBe('java');
    expect(sourceLanguageOf('./README')).toBe('text');
  });
});

describe('findSymbolLines', () => {
  const ts = [
    "import { sleep } from '@temporalio/workflow';", // 1
    '', // 2
    'export async function orderWorkflow(id: string) {', // 3
    '  if (id) {', // 4
    '    await sleep(1);', // 5
    '  }', // 6
    '  return id;', // 7
    '}', // 8
    '', // 9
    'export const agentWorkflow = async (q: string) => {', // 10
    '  return q;', // 11
    '};', // 12
  ].join('\n');

  it('finds a TypeScript function to its closing brace', () => {
    expect(findSymbolLines(ts, 'orderWorkflow', 'typescript')).toEqual({
      startLine: 3,
      endLine: 8,
    });
    expect(findSymbolLines(ts, 'agentWorkflow', 'typescript')).toEqual({
      startLine: 10,
      endLine: 12,
    });
  });

  it('skips default values and return types to find the body', () => {
    const source = [
      'export async function demoAgent(partial: Partial<In> = {}): Promise<{ ok: boolean }> {', // 1
      '  const a = { b: 1 };', // 2
      '  return { ok: true };', // 3
      '}', // 4
      'const oneLine = () => { return 1; };', // 5
    ].join('\n');
    expect(findSymbolLines(source, 'demoAgent', 'typescript')).toEqual({
      startLine: 1,
      endLine: 4,
    });
    expect(findSymbolLines(source, 'oneLine', 'typescript')).toEqual({
      startLine: 5,
      endLine: 5,
    });
  });

  it('finds a Python function by its indented block', () => {
    const py = [
      '@workflow.defn', // 1
      'class Order:', // 2
      '    @workflow.run', // 3
      '    async def run(self, id: str) -> str:', // 4
      '        await sleep(1)', // 5
      '', // 6
      '        return id', // 7
      '', // 8
      'def other():', // 9
      '    pass', // 10
    ].join('\n');
    expect(findSymbolLines(py, 'Order.run', 'python')).toEqual({
      startLine: 4,
      endLine: 7,
    });
  });

  it('finds a Go function and leaves out names that are not declared', () => {
    const go =
      'package w\n\nfunc OrderWorkflow(ctx workflow.Context) error {\n\treturn nil\n}\n';
    expect(findSymbolLines(go, 'OrderWorkflow', 'go')).toEqual({
      startLine: 3,
      endLine: 5,
    });
    expect(
      findSymbolLines(ts, 'missingWorkflow', 'typescript'),
    ).toBeUndefined();
    // A call is not a declaration.
    expect(
      findSymbolLines('await sleep(1);', 'sleep', 'typescript'),
    ).toBeUndefined();
  });
});
