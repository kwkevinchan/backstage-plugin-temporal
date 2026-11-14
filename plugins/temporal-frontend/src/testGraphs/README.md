# Graph responses for the frontend tests

Graph responses (`GET .../graph`) of recorded histories, for the tests of
the event group views. The frontend tests do not run backend code, so
`scripts/event-group-graphs.mjs` reads the histories with the backend's
graph builder and writes one file per response here. Do not edit the files;
when the backend changes the shape of the graph, write them again:

```sh
yarn sync:test-graphs        # writes the files
yarn sync:test-graphs:check  # fails when a file is out of date
```

| File                         | History                                                        |
| ---------------------------- | -------------------------------------------------------------- |
| `loopGraph.ts`               | `test-fixtures/event-groups/loop-ts-sdk-1.25.json`             |
| `loopGraphPayloadsHidden.ts` | the same, for a caller without the permission to read payloads |
| `parallelGraph.ts`           | `test-fixtures/event-groups/parallel.json`                     |
| `ambiguousGraph.ts`          | `test-fixtures/event-groups/ambiguous.json`                    |
| `codecLoopGraph.ts`          | `test-fixtures/event-groups/codec-loop.json`                   |
| `agentGraph.ts`              | `test-fixtures/llm-integrations/vercel-ai-sdk-agent.json`      |

The script reads the histories like the backend tests do
(`readHistoryFixture`), with their times and durations in the form the
backend reads from Temporal.
