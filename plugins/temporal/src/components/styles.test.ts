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

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tp } from './styles';

/** The files under `dir` that `keep` accepts, in every folder. */
function files(dir: string, keep: (name: string) => boolean): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return files(path, keep);
    return keep(entry.name) ? [path] : [];
  });
}

const read = (path: string) => readFileSync(path, 'utf8');
const src = join(__dirname, '..');
const stylesheets = files(__dirname, name => name.endsWith('.module.css')).map(
  path => ({ path, css: read(path).replace(/\/\*[\s\S]*?\*\//g, '') }),
);
const sources = files(
  src,
  name => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name),
).map(read);

describe('plugin styles', () => {
  const defined = new Set(
    stylesheets.flatMap(({ css }) =>
      [...css.matchAll(/\.(tp-[a-z0-9-]+)/g)].map(match => match[1]),
    ),
  );

  it('have the classes that the components use', () => {
    const used = new Set<string>();
    const prefixes = new Set<string>();
    for (const source of sources) {
      for (const [, name, end] of source.matchAll(
        /['"`](tp-[a-z0-9-]+)(['"`]|\$\{)/g,
      )) {
        if (end === '${') prefixes.add(name);
        else used.add(name);
      }
    }
    expect(used.size).toBeGreaterThan(100);
    expect([...used].filter(name => !defined.has(name))).toEqual([]);
    // `tp-tone-${tone}` and the like: at least one class with the prefix.
    expect(
      [...prefixes].filter(
        prefix => ![...defined].some(name => name.startsWith(prefix)),
      ),
    ).toEqual([]);
  });

  it('keep the keyframes of an animation in the stylesheet that uses it', () => {
    // Keyframe names are scoped to their stylesheet, like class names.
    const missing: string[] = [];
    let animations = 0;
    for (const { path, css } of stylesheets) {
      const keyframes = new Set(
        [...css.matchAll(/@keyframes\s+([\w-]+)/g)].map(match => match[1]),
      );
      for (const [, name] of css.matchAll(/animation:\s*([a-z][\w-]*)/g)) {
        if (name === 'none') continue;
        animations += 1;
        if (!keyframes.has(name)) missing.push(`${name} in ${path}`);
      }
    }
    expect(animations).toBeGreaterThan(0);
    expect(missing).toEqual([]);
  });
});

describe('tp', () => {
  it('joins the names, and returns a name that is not a class of the styles as it is', () => {
    expect(tp('tp-node', 'tp-tone-danger')).toBe('tp-node tp-tone-danger');
    expect(tp('tp-node', 'some-other-class')).toBe(
      'tp-node some-other-class',
    );
    expect(tp()).toBe('');
  });
});
