# Frontier State

Patch-routed app-state subscriptions and maintained views for Frontier.

This package sits above [`@shapeshift-labs/frontier`](https://www.npmjs.com/package/@shapeshift-labs/frontier) and [`@shapeshift-labs/frontier-engine`](https://www.npmjs.com/package/@shapeshift-labs/frontier-engine). It keeps app-state routing, owned commits, and view maintenance out of the small JSON diff/apply core package.

- npm: [`@shapeshift-labs/frontier-state`](https://www.npmjs.com/package/@shapeshift-labs/frontier-state)
- source: [`siliconjungle/-shapeshift-labs-frontier`](https://github.com/siliconjungle/-shapeshift-labs-frontier/tree/main/packages/frontier-state)
- license: MIT

## Related Packages

- [`@shapeshift-labs/frontier`](https://www.npmjs.com/package/@shapeshift-labs/frontier): core JSON diff/apply primitives used by state commits.
- [`@shapeshift-labs/frontier-engine`](https://www.npmjs.com/package/@shapeshift-labs/frontier-engine): planned diff engine and adaptive profiles for profiled commits.
- [`@shapeshift-labs/frontier-query`](https://www.npmjs.com/package/@shapeshift-labs/frontier-query): shared selector and table vocabulary.
- [`@shapeshift-labs/frontier-state-cache`](https://www.npmjs.com/package/@shapeshift-labs/frontier-state-cache): normalized query-result cache; related to state but intentionally not a dependency.
- [`@shapeshift-labs/frontier-mutation`](https://www.npmjs.com/package/@shapeshift-labs/frontier-mutation): explicit mutation plans that can commit through state-engine structural interfaces.

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
  mapTextPositions
} from '@shapeshift-labs/frontier-state';
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
npm run bench
npm run pack:dry
```

## Benchmarks

Run the package-local benchmark:

```sh
npm run bench
```

Latest local package benchmark on Node v26.1.0, darwin arm64, 3 rounds:

| Fixture | Median | p95 |
| --- | ---: | ---: |
| Patch router exact path dispatch | 0.04 us | 0.04 us |
| State commit, 1k rows one edit | 392.57 us | 414.56 us |
| Owned patch commit | 1.99 us | 2.55 us |
| Text position mapping | 0.05 us | 0.05 us |

These are Frontier-only package measurements, not competitor comparisons.

## License

MIT. See [LICENSE](./LICENSE).
