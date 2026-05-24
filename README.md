# Frontier State

Patch-routed app-state subscriptions and maintained views for Frontier.

This package sits above `@shapeshift-labs/frontier`. It keeps app-state routing and view maintenance out of the small JSON diff/apply core package.

## Install

```sh
npm install @shapeshift-labs/frontier @shapeshift-labs/frontier-state
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

## License

MIT. See [LICENSE](./LICENSE).
