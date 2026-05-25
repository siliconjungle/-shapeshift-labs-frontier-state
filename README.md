# Frontier State

Patch-routed app-state subscriptions and maintained views for Frontier.

This package sits above [`@shapeshift-labs/frontier`](https://www.npmjs.com/package/@shapeshift-labs/frontier) and [`@shapeshift-labs/frontier-engine`](https://www.npmjs.com/package/@shapeshift-labs/frontier-engine). It keeps app-state routing, owned commits, and view maintenance out of the small JSON diff/apply core package.

- npm: [`@shapeshift-labs/frontier-state`](https://www.npmjs.com/package/@shapeshift-labs/frontier-state)
- source: [`siliconjungle/-shapeshift-labs-frontier-state`](https://github.com/siliconjungle/-shapeshift-labs-frontier-state)
- license: MIT

## Related Packages

- [`@shapeshift-labs/frontier`](https://www.npmjs.com/package/@shapeshift-labs/frontier): core JSON diff/apply primitives used by state commits.
- [`@shapeshift-labs/frontier-engine`](https://www.npmjs.com/package/@shapeshift-labs/frontier-engine): planned diff engine and adaptive profiles for profiled commits.
- [`@shapeshift-labs/frontier-query`](https://www.npmjs.com/package/@shapeshift-labs/frontier-query): shared selector and table vocabulary.
- [`@shapeshift-labs/frontier-schema`](https://www.npmjs.com/package/@shapeshift-labs/frontier-schema): JSON Schema to engine profile conversion for state commit planning.
- [`@shapeshift-labs/frontier-state-cache`](https://www.npmjs.com/package/@shapeshift-labs/frontier-state-cache): normalized query-result cache; related to state but intentionally not a dependency.
- [`@shapeshift-labs/frontier-mutation`](https://www.npmjs.com/package/@shapeshift-labs/frontier-mutation): explicit mutation plans that can commit through state-engine structural interfaces.

Package source repositories:

- [`siliconjungle/-shapeshift-labs-frontier`](https://github.com/siliconjungle/-shapeshift-labs-frontier)
- [`siliconjungle/-shapeshift-labs-frontier-engine`](https://github.com/siliconjungle/-shapeshift-labs-frontier-engine)
- [`siliconjungle/-shapeshift-labs-frontier-query`](https://github.com/siliconjungle/-shapeshift-labs-frontier-query)
- [`siliconjungle/-shapeshift-labs-frontier-schema`](https://github.com/siliconjungle/-shapeshift-labs-frontier-schema)
- [`siliconjungle/-shapeshift-labs-frontier-state-cache`](https://github.com/siliconjungle/-shapeshift-labs-frontier-state-cache)
- [`siliconjungle/-shapeshift-labs-frontier-mutation`](https://github.com/siliconjungle/-shapeshift-labs-frontier-mutation)

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

Latest local package benchmark on Node v26.1.0, darwin arm64, 3 rounds:

| Fixture | Median | p95 |
| --- | ---: | ---: |
| Patch router exact path dispatch | 0.04 us | 0.05 us |
| State commit, 1k rows one edit | 231.63 us | 243.25 us |
| Owned patch commit | 1.12 us | 2.39 us |
| Text position mapping | 0.04 us | 0.04 us |

These are Frontier-only package measurements, not competitor comparisons.

## License

MIT. See [LICENSE](./LICENSE).
