# Security policy

## Reporting a vulnerability

Please do not open a public issue for a security problem. Report it
privately with GitHub's private vulnerability reporting:

1. Open the [Security tab](https://github.com/kwkevinchan/backstage-plugin-temporal/security)
   of the repository.
2. Choose **Report a vulnerability** and describe the problem, the affected
   packages and versions, and how to reproduce it.

The maintainer will reply as soon as possible. Once a fix is released, the advisory
is published with credit to the reporter, unless you prefer otherwise.

## Supported versions

Only the latest released version of each package gets security fixes. The
project supports one Backstage release line at a time (see the
[compatibility table](README.md#compatibility)).

## Scope

In scope: the published packages in `plugins/` (the Backstage plugins and
their modules), and `@kwkevinchan/temporal-workflow-kit`, which is
experimental and not published yet. The development packages in `packages/` are
examples and are not published.

Problems in Temporal, Backstage or other dependencies should be reported to
those projects. See the [security notes](README.md#security) in the README
for how to run the plugin safely.
