# Frontier State

Patch-routed app-state subscriptions and maintained views for Frontier.

This package sits above [`@shapeshift-labs/frontier`](https://www.npmjs.com/package/@shapeshift-labs/frontier) and [`@shapeshift-labs/frontier-engine`](https://www.npmjs.com/package/@shapeshift-labs/frontier-engine). It keeps app-state routing, owned commits, and view maintenance out of the small JSON diff/apply core package.

- npm: [`@shapeshift-labs/frontier-state`](https://www.npmjs.com/package/@shapeshift-labs/frontier-state)
- source: [`siliconjungle/-shapeshift-labs-frontier-state`](https://github.com/siliconjungle/-shapeshift-labs-frontier-state)
- license: MIT

## Related Packages

The published Frontier package family is generated from one shared package catalog so READMEs stay in sync across packages:

- [`@shapeshift-labs/frontier`](https://www.npmjs.com/package/@shapeshift-labs/frontier): Core JSON diff/apply, compact patch tuples, JSON Pointer, equality, clone, validation, Unicode helpers.
- [`@shapeshift-labs/frontier-query`](https://www.npmjs.com/package/@shapeshift-labs/frontier-query): Shared query-key, selector path, condition, entity identity, and table-shape primitives.
- [`@shapeshift-labs/frontier-codec`](https://www.npmjs.com/package/@shapeshift-labs/frontier-codec): Patch serialization, binary frames, canonical JSON, and patch-history codecs.
- [`@shapeshift-labs/frontier-engine`](https://www.npmjs.com/package/@shapeshift-labs/frontier-engine): Stateful planned diff engine, adaptive profiles, schema plans, and engine-level history helpers.
- [`@shapeshift-labs/frontier-state-cache`](https://www.npmjs.com/package/@shapeshift-labs/frontier-state-cache): Normalized query-result cache with entity/query watchers, persistence, change logs, optimistic layers, and mutation bridge.
- [`@shapeshift-labs/frontier-state-cache-idb`](https://www.npmjs.com/package/@shapeshift-labs/frontier-state-cache-idb): IndexedDB persistence adapter for Frontier state-cache snapshots.
- [`@shapeshift-labs/frontier-state-cache-file`](https://www.npmjs.com/package/@shapeshift-labs/frontier-state-cache-file): Structured file persistence adapter for Frontier state-cache snapshots and change logs.
- [`@shapeshift-labs/frontier-state-cache-sql`](https://www.npmjs.com/package/@shapeshift-labs/frontier-state-cache-sql): SQL persistence adapter for Frontier state-cache snapshots and change logs.
- [`@shapeshift-labs/frontier-schema`](https://www.npmjs.com/package/@shapeshift-labs/frontier-schema): JSON Schema validation, Frontier profile generation, CloudEvent envelopes, and query/table schema helpers.
- [`@shapeshift-labs/frontier-event-log`](https://www.npmjs.com/package/@shapeshift-labs/frontier-event-log): Bounded event logs, replay cursors, consumer acknowledgements, keyed compaction, checkpoints, and Frontier patch event records.
- [`@shapeshift-labs/frontier-logging`](https://www.npmjs.com/package/@shapeshift-labs/frontier-logging): Opt-in structured logging, browser telemetry, file sinks, exporters, benchmark traces, and Frontier patch/update summaries.
- [`@shapeshift-labs/frontier-mutation`](https://www.npmjs.com/package/@shapeshift-labs/frontier-mutation): Explicit mutation and selector plans compiled to Frontier patches or CRDT operations.
- [`@shapeshift-labs/frontier-crdt`](https://www.npmjs.com/package/@shapeshift-labs/frontier-crdt): Native CRDT documents, update tooling, awareness, branches, conflict introspection, version frames, and undo.
- [`@shapeshift-labs/frontier-crdt-sync`](https://www.npmjs.com/package/@shapeshift-labs/frontier-crdt-sync): CRDT sync endpoints, repo/storage/provider contracts, document URLs, local networks, model checking, forensics, and text binding contracts.
- [`@shapeshift-labs/frontier-crdt-websocket`](https://www.npmjs.com/package/@shapeshift-labs/frontier-crdt-websocket): WebSocket client/server transports for Frontier CRDT sync providers.
- [`@shapeshift-labs/frontier-react`](https://www.npmjs.com/package/@shapeshift-labs/frontier-react): React external-store hooks and adapters for Frontier state, cache, and CRDT surfaces.
- [`@shapeshift-labs/frontier-richtext`](https://www.npmjs.com/package/@shapeshift-labs/frontier-richtext): Rich text Delta normalization/application, marks, embeds, ranges, and cursor/selection transforms for local editor integrations.

Package source repositories:

- [`siliconjungle/-shapeshift-labs-frontier`](https://github.com/siliconjungle/-shapeshift-labs-frontier)
- [`siliconjungle/-shapeshift-labs-frontier-query`](https://github.com/siliconjungle/-shapeshift-labs-frontier-query)
- [`siliconjungle/-shapeshift-labs-frontier-codec`](https://github.com/siliconjungle/-shapeshift-labs-frontier-codec)
- [`siliconjungle/-shapeshift-labs-frontier-engine`](https://github.com/siliconjungle/-shapeshift-labs-frontier-engine)
- [`siliconjungle/-shapeshift-labs-frontier-state`](https://github.com/siliconjungle/-shapeshift-labs-frontier-state)
- [`siliconjungle/-shapeshift-labs-frontier-state-cache`](https://github.com/siliconjungle/-shapeshift-labs-frontier-state-cache)
- [`siliconjungle/-shapeshift-labs-frontier-state-cache-idb`](https://github.com/siliconjungle/-shapeshift-labs-frontier-state-cache-idb)
- [`siliconjungle/-shapeshift-labs-frontier-state-cache-file`](https://github.com/siliconjungle/-shapeshift-labs-frontier-state-cache-file)
- [`siliconjungle/-shapeshift-labs-frontier-state-cache-sql`](https://github.com/siliconjungle/-shapeshift-labs-frontier-state-cache-sql)
- [`siliconjungle/-shapeshift-labs-frontier-schema`](https://github.com/siliconjungle/-shapeshift-labs-frontier-schema)
- [`siliconjungle/-shapeshift-labs-frontier-event-log`](https://github.com/siliconjungle/-shapeshift-labs-frontier-event-log)
- [`siliconjungle/-shapeshift-labs-frontier-logging`](https://github.com/siliconjungle/-shapeshift-labs-frontier-logging)
- [`siliconjungle/-shapeshift-labs-frontier-mutation`](https://github.com/siliconjungle/-shapeshift-labs-frontier-mutation)
- [`siliconjungle/-shapeshift-labs-frontier-crdt`](https://github.com/siliconjungle/-shapeshift-labs-frontier-crdt)
- [`siliconjungle/-shapeshift-labs-frontier-crdt-sync`](https://github.com/siliconjungle/-shapeshift-labs-frontier-crdt-sync)
- [`siliconjungle/-shapeshift-labs-frontier-crdt-websocket`](https://github.com/siliconjungle/-shapeshift-labs-frontier-crdt-websocket)
- [`siliconjungle/-shapeshift-labs-frontier-react`](https://github.com/siliconjungle/-shapeshift-labs-frontier-react)
- [`siliconjungle/-shapeshift-labs-frontier-richtext`](https://github.com/siliconjungle/-shapeshift-labs-frontier-richtext)

## Planned Realtime and Game Packages

The following repositories are reserved placeholders for future realtime and game-facing Frontier packages. They are not production-ready packages and should not be treated as benchmarked or stable npm surfaces yet.

- [`@shapeshift-labs/frontier-realtime`](https://github.com/siliconjungle/-shapeshift-labs-frontier-realtime): planned realtime command, tick, snapshot, prediction, reconciliation, interpolation, and rollback primitives.
- [`@shapeshift-labs/frontier-realtime-server`](https://github.com/siliconjungle/-shapeshift-labs-frontier-realtime-server): planned authoritative server runtime for rooms, ticks, validation, lag-compensation history, and replication policy.
- [`@shapeshift-labs/frontier-realtime-websocket`](https://github.com/siliconjungle/-shapeshift-labs-frontier-realtime-websocket): planned WebSocket transport for realtime commands and snapshots.
- [`@shapeshift-labs/frontier-game`](https://github.com/siliconjungle/-shapeshift-labs-frontier-game): planned game-facing entity, component, player, room, ownership, and replication vocabulary above realtime.

## Install

```sh
npm install @shapeshift-labs/frontier @shapeshift-labs/frontier-engine @shapeshift-labs/frontier-state
```

## Usage

```ts
import { createStateEngine } from '@shapeshift-labs/frontier-state';

const state = createStateEngine({
  todos: [{ id: 'a', done: false }]
}, {
  diff: { arrayKey: 'id' }
});

state.watch('/todos/0/done', (patch) => {
  console.log(patch);
});

state.commit({
  todos: [{ id: 'a', done: true }]
});
```

## API

```ts
import {
  createPatchRouter,
  createStateEngine,
  createStatePatchEnvelope,
  mapPath,
  mapTextPosition,
  mapTextPositions,
  type Patch,
  type StateEngine,
  type TextPosition
} from '@shapeshift-labs/frontier-state';
```

### `createStateEngine(initial?, options?)`

Creates an owned app-state engine with reusable diff planning, patch routing, subscriptions, and maintained views.

```ts
const state = createStateEngine({ count: 1 });
const patch = state.commit({ count: 2 });

state.commitPatch([[0, ['count'], 3]]);
console.log(state.get());
```

### Basis-Checked Patches

State engines expose a monotonic non-CRDT patch basis. Use `commitWithBasis()` or `createStatePatchEnvelope()` to attach the state version a patch was authored against, then use `commitPatchWithBasis()` to reject or route stale patches without applying them.

```ts
const local = createStateEngine({ count: 1 });
const envelope = local.commitWithBasis({ count: 2 });

const remote = createStateEngine({ count: 1 });
remote.commitPatchWithBasis(envelope);

const stale = remote.commitPatchWithBasis(envelope, { onStale: 'route' });
console.log(stale.status); // "routed"
```

### Patch Router

`createPatchRouter()` routes compact Frontier patches to exact, wildcard, row-field, and range watchers without making the core diff/apply package own subscriptions.

```ts
const router = createPatchRouter();
const subscription = router.watch('/rows/*/done', (patch) => {
  console.log(patch);
});

router.route([[0, ['rows', 4, 'done'], true]]);
subscription.unsubscribe();
```

### Maintained Views

State views keep a derived slice up to date from routed patches. Exact-path views repair incrementally; filtered/projected views refresh when they need broader source context.

```ts
const view = state.view('/todos');
console.log(view.value());
view.dispose();
```

### Path Mapping

Path and text-position helpers map client cursors and stored paths through compact Frontier patch operations.

```ts
const nextPath = mapPath(['rows', 2, 'title'], patch);
const nextCursor = mapTextPosition(['body'], 4, patch);
```

## Subpath Imports

```ts
import { createStateEngine } from '@shapeshift-labs/frontier-state/state';
import { mapTextPosition } from '@shapeshift-labs/frontier-state/path-map';
```

## Package Scope

This package is intentionally limited to:

- Patch routing and subscriptions.
- Owned app-state commits.
- Non-CRDT patch basis envelopes for stale-patch rejection or routing.
- Maintained derived views.
- JSON path and text-position mapping through Frontier patches.

It does not expose CRDT documents, sync providers, awareness, rich text, logging, or patch transport codecs.

## TypeScript

The package ships ESM JavaScript plus `.d.ts` declarations for the root export and public subpaths. The package-local TypeScript source lives in `src/` and compiles directly to `dist/`.

## Validation

```sh
npm test
npm run fuzz
npm run bench
npm run pack:dry
```

The package test suite covers root and subpath imports, router dispatch, state commits, owned patch commits, maintained views, profile round-trips, and path/text-position mapping. The fuzzer replays random app-state commits and direct patch commits through state subscriptions.

## Benchmarks

Run the package-local benchmark:

```sh
npm run bench
```

Latest local package benchmark on Node v26.1.0, darwin arm64, 9 rounds:

| Fixture | Median | p95 |
| --- | ---: | ---: |
| Patch router exact path dispatch | 0.04 us | 0.05 us |
| State commit, 1k rows one edit | 229.71 us | 236.44 us |
| Owned patch commit | 1.15 us | 1.39 us |
| Patch envelope create | 0.02 us | 0.02 us |
| Owned patch commit with basis | 0.85 us | 1.34 us |
| Stale patch basis reject | 0.03 us | 0.03 us |
| Stale patch basis route | 0.04 us | 0.25 us |
| Text position mapping | 0.03 us | 0.09 us |

These are Frontier-only package measurements, not competitor comparisons.

## License

MIT. See [LICENSE](./LICENSE).
