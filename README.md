# Frontier State

Reserved package name for the future Frontier app-state layer.

This package is not ready for production use. It exists so the package and repository names are reserved while the state engine boundary is finalized.

- npm: [`@shapeshift-labs/frontier-state`](https://www.npmjs.com/package/@shapeshift-labs/frontier-state)
- source: [`siliconjungle/-shapeshift-labs-frontier-state`](https://github.com/siliconjungle/-shapeshift-labs-frontier-state)
- core package: [`@shapeshift-labs/frontier`](https://www.npmjs.com/package/@shapeshift-labs/frontier)
- license: MIT

## Intended Scope

When this package graduates from placeholder status, it is expected to contain:

- patch routing and subscriptions;
- owned app-state commits;
- maintained derived views;
- JSON path and text-position mapping through Frontier patches.

It should depend on `@shapeshift-labs/frontier` and stay separate from CRDT documents, sync providers, rich text, logging, and patch transport codecs.

## Current Status

Use [`@shapeshift-labs/frontier`](https://www.npmjs.com/package/@shapeshift-labs/frontier) for the stable JSON diff/apply core.

The state package is reserved only. No runtime API is exported yet.

## Package Family

Published or active packages:

- [`@shapeshift-labs/frontier`](https://www.npmjs.com/package/@shapeshift-labs/frontier)
- [`@shapeshift-labs/frontier-codec`](https://www.npmjs.com/package/@shapeshift-labs/frontier-codec)
- [`@shapeshift-labs/frontier-mutation`](https://www.npmjs.com/package/@shapeshift-labs/frontier-mutation)

Reserved future packages:

- `@shapeshift-labs/frontier-engine`
- `@shapeshift-labs/frontier-crdt`
- `@shapeshift-labs/frontier-crdt-sync`
- `@shapeshift-labs/frontier-richtext`
- `@shapeshift-labs/frontier-logging`
- `@shapeshift-labs/frontier-state-cache`
- `@shapeshift-labs/frontier-event-log`
- `@shapeshift-labs/frontier-schema`

## License

MIT. See [LICENSE](./LICENSE).
