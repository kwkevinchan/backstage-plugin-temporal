---
'@kwkevinchan/backstage-plugin-temporal-backend': minor
---

The operations answer more precisely:

- The details of a run that continued as new have `continuedAsNewRunId`, the run it continued as. Signal of such a run answers 409 with the same field in the error body.
- **Breaking:** rerun only takes a closed run: it answers 409 while the run is running.
- The errors a custom action throws get the status of what they mean: Backstage errors keep theirs, a workflow the Temporal client does not find is 404, an update that fails is 400, an update that does not finish in time is 503, gRPC errors are mapped like those of the built-in operations, anything else stays 500. A client that cannot connect is 503. Every call of the action's client shares a deadline of 60 seconds; an action extends it for its own calls with `client.connection.withDeadline`.
- **Breaking:** a workflow opened without `entityRef`: a request without access and a request for a workflow that does not exist get the same answer (404), unless the list permission allows every workflow. A caller that no permission could allow is refused with 403 before the workflow is read. With `entityRef`, a workflow that does not belong to the entity gets the same answer as one that does not exist.
