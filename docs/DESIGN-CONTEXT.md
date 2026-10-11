# Querying retained game design context

`query_design_context` retrieves connected names from a local REA-SON version 1
checkpoint so an agent can discuss a design change using retained study. The
equivalent CLI operation is `query-design-context`. Both use the same provider.
SON remains the owner of the study records; Nostalgia reads an exported snapshot.

The operation preserves design properties, questions, revisions, relationships,
linked observations, study criteria and predictions, and recorded checks. It
returns supplied confidence and authority labels without authenticating them.
File and checkpoint checksums establish integrity against supplied identities,
not the truth of a claim or the current state of a game.

## Query inputs

Save a request with an absolute checkpoint path:

```json
{
  "checkpoint_path": "C:/projects/bdos-arpg/study-checkpoint.json",
  "terms": ["camera", "targeting"],
  "hops": 1,
  "limit": 30
}
```

```powershell
node dist/cli.js query-design-context request.json
```

Call `query_design_context` through MCP with the same JSON object. A SON client
can retain the JSON result of `son_checkpoint` as the input file. Pass the
checkpoint object itself, not an MCP content wrapper or a replication contract.
Updating the live ledger does not update an earlier export.

Use `name_ids` to start from known stable identities. `terms` use literal,
case-insensitive substring matching across each latest name's name, description,
questions, and properties. Terms are alternatives; their matches are unioned
with explicit name IDs. This is not semantic search or a natural-language query
parser. An agent translates the player's question into relevant terms and follows
the returned relationships.

At least one term or name ID is required. `hops` defaults to 1 and allows 0 through
3; `limit` defaults to 30 and allows 1 through 100. An optional `expected_sha256`
pins the complete checkpoint file identity. Unknown explicit name IDs fail;
unmatched terms return an empty result with coverage information.

## What the result means

Matching and traversal use the latest revision of each named part. The result
also retains selected parts' earlier revisions and their evidence. It traverses
relations in both directions to find relevant neighbors, while returning each
relation's declared direction. Structural parent links remain distinct from
declared dependencies or explanations.

Coverage reports matches, names reachable within the requested hop distance,
returned names, and truncation. Relations touching the returned names can refer
to names beyond the boundary. Follow those identities with another query when
they matter; a bounded result is not the complete graph. Related study records
and checks provide context, not new validation performed by the query.

Malformed, oversized, changed, nonregular, unsupported, checksum-mismatched, and
structurally inconsistent checkpoints fail. The reader validates the checkpoint
fields it consumes and preserves additional upstream fields. It is not a full
REA-SON restore operation or evidence-authentication substitute.

## Using the context as a studio

For a first-person Diablo proposal, first establish the experience Bdo wants and
the qualities to retain. Retrieve the relevant camera, targeting, encounter,
progression, and presentation records as available. Missing records are gaps to
study; they are not evidence that a mechanic or relationship is absent.

The agent should present:

- The requested experience and proposed interpretation.
- Relevant source observations and design principles, with their supporting
  references, conditions, and uncertainty.
- Candidate designs, expected consequences, and a recommendation with reasons.
- The smallest playable comparison that could settle the important tradeoff.
- Preserved qualities, requested differences, and separate technical and player
  acceptance checks.

Retain these decisions and later playtest findings in SON through its study and
naming operations, then export a new checkpoint for subsequent queries. Use
properties to retain scoped domain information rather than changing the fork's
general relation vocabulary for every game. This reader does not create designs,
write the graph, generate code, or alter a running game.

## Storage decision with current resources

The first implementation queries SON exports in memory. It adds no service or
package and preserves the existing record ownership boundary. This is a bounded
consumer implementation, not a claim that snapshots will suit a complete game
library. Measure representative project sizes and queries before selecting an
additional index or storage engine.

| Option | Documented capability | Decision for this release |
| --- | --- | --- |
| SON checkpoint reader | Existing retained names, relations, revisions, studies, observations, and checks | Use first; test the handoff and evidence semantics without duplicating study state |
| SQLite through Node | Embedded file or memory databases with prepared statements; built-in module API | Candidate derived index if measured snapshot costs justify it; graph modeling and traversal remain application responsibilities |
| Neo4j | JavaScript driver connects to a database instance and queries through Cypher | Revisit when shared concurrent graph work or graph query requirements justify operating another database |
| Kuzu | Embedded graph engine with an in-process client | Additional engine and integration are unnecessary for the first checkpoint consumer; maintenance and packaging need a fresh check before adoption |

Research references checked on 2026-10-10:
[Node SQLite API](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html),
[Neo4j JavaScript driver](https://neo4j.com/docs/javascript-manual/current/), and
[Kuzu embedded graph introduction](https://kuzudb.github.io/docs/get-started/).
The current local Node version is 24.11.1; `node:sqlite` is experimental on that
version. Current Node 24 documentation marks it a release candidate beginning
with 24.15.0. This release does not use that module or require a Node upgrade.

## Verified scope

The repository's 12 tests pass, including five design-context tests covering
compiled CLI and real stdio MCP parity, retained record fields and uncertainty,
latest-revision matching, graph direction and bounds, refusal paths, cancellation,
and unchanged inputs. Independent checks compare traversal with a separate graph
oracle and validate canonical checksums against the local SON implementation.

A checkpoint exported by the actual local SON ledger also passes the CLI/MCP
handoff: three latest names, four retained revisions, one inferred observation,
and an open question. Its data is an original synthetic design exercise.
This establishes checkpoint consumption; Diablo study, a playable scene, and
player evaluation remain work for the broader acceptance journey.

See [the broader acceptance journey](REA-SON-JOURNEY.md) for the source experiment,
playable reconstruction, intentional change, and evaluation requirements.
