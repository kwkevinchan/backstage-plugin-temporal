#!/usr/bin/env node
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

/**
 * Pins every @backstage/* package to the exact versions of the Backstage
 * release in backstage.json, through root `resolutions`.
 *
 * `backstage:^` ranges let a fresh install pick newer patch and minor
 * versions. The development workspace should instead run exactly the
 * supported release, so these resolutions are generated from the official
 * release manifest. Published packages are not affected: root resolutions
 * are never part of a published package.
 *
 * Usage:
 *   node scripts/pin-backstage-release.mjs           # write resolutions
 *   node scripts/pin-backstage-release.mjs --check   # fail if out of date
 *   node scripts/pin-backstage-release.mjs --release 1.56.2  # also update backstage.json
 */

import { readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const check = args.includes('--check');
const releaseIdx = args.indexOf('--release');

const backstageJson = JSON.parse(readFileSync('backstage.json', 'utf8'));
if (releaseIdx !== -1) {
  backstageJson.version = args[releaseIdx + 1];
  writeFileSync(
    'backstage.json',
    `${JSON.stringify(backstageJson, null, 2)}\n`,
  );
}
const release = backstageJson.version;

const res = await fetch(
  `https://versions.backstage.io/v1/releases/${release}/manifest.json`,
);
if (!res.ok) {
  console.error(
    `Could not fetch manifest for release ${release}: ${res.status}`,
  );
  process.exit(1);
}
const manifest = await res.json();

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const others = Object.fromEntries(
  Object.entries(pkg.resolutions ?? {}).filter(
    ([n]) => !n.startsWith('@backstage/'),
  ),
);
const pinned = Object.fromEntries(
  manifest.packages
    .map(p => [p.name, p.version])
    .sort(([a], [b]) => a.localeCompare(b)),
);
const next = { ...others, ...pinned };

if (check) {
  const same = JSON.stringify(pkg.resolutions ?? {}) === JSON.stringify(next);
  if (!same) {
    console.error(
      `Root resolutions do not match Backstage ${release}; run this script without --check`,
    );
    process.exit(1);
  }
  console.log(`Root resolutions match Backstage ${release}`);
} else {
  pkg.resolutions = next;
  writeFileSync('package.json', `${JSON.stringify(pkg, null, 2)}\n`);
  console.log(
    `Pinned ${
      Object.keys(pinned).length
    } @backstage/* packages to release ${release}`,
  );
}
