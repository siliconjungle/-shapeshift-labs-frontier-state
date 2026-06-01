import assert from 'node:assert';
import {
  createPatchRouter,
  createStateEngine,
  createStatePatchEnvelope,
  mapPath,
  mapTextPosition,
  mapTextPositions
} from '../dist/index.js';
import { mapPath as mapPathSubpath } from '../dist/path-map.js';
import {
  createFrontierRegistry,
  frontierRegistryImpact
} from '@shapeshift-labs/frontier/registry';

assert.strictEqual(typeof createPatchRouter, 'function');
assert.strictEqual(typeof createStateEngine, 'function');
assert.strictEqual(typeof createStatePatchEnvelope, 'function');
assert.strictEqual(typeof mapPath, 'function');
assert.strictEqual(mapPathSubpath, mapPath);

const router = createPatchRouter();
let routed = 0;
router.watch('/todos/0/done', () => {
  routed++;
});
assert.strictEqual(router.route([[0, ['todos', 0, 'done'], true]]), 1);
assert.strictEqual(routed, 1);

const state = createStateEngine({ todos: [{ id: 'a', done: false }], text: 'hello' }, { diff: { arrayKey: 'id' } });
let patches = 0;
state.watch('/todos/0/done', () => {
  patches++;
});
const patch = state.commit({ todos: [{ id: 'a', done: true }], text: 'hello' });
assert.ok(patch.length > 0);
assert.strictEqual(patches, 1);
assert.deepStrictEqual(state.get(), { todos: [{ id: 'a', done: true }], text: 'hello' });
assert.strictEqual(state.getBasis(), 1);

let migrationReport;
const migratedState = createStateEngine(
  { $version: '1', todos: [{ id: 'a', text: 'old' }] },
  {
    migration: {
      migrateInitial(value) {
        return {
          kind: 'frontier.migration.runtime-data.result',
          data: { $version: '2', todos: [{ id: 'a', title: value.todos[0].text }] },
          version: '2',
          changed: true,
          report: { kind: 'frontier.migration.report', source: 'idb:app-state' }
        };
      },
      onReport(report) {
        migrationReport = report;
      }
    }
  }
);
assert.deepStrictEqual(migratedState.get(), { $version: '2', todos: [{ id: 'a', title: 'old' }] });
assert.deepStrictEqual(migrationReport, { kind: 'frontier.migration.report', source: 'idb:app-state' });

const authored = createStateEngine({ todos: [{ id: 'a', done: false }], text: 'hello' }, { diff: { arrayKey: 'id' } });
const envelope = authored.commitWithBasis(
  { todos: [{ id: 'a', done: true }], text: 'hello' },
  { metadata: { origin: 'unit' } }
);
assert.strictEqual(envelope.kind, 'frontier.state.patch');
assert.strictEqual(envelope.basis, 0);
assert.strictEqual(envelope.nextBasis, 1);
assert.deepStrictEqual(envelope.metadata, { origin: 'unit' });

const receiving = createStateEngine({ todos: [{ id: 'a', done: false }], text: 'hello' }, { diff: { arrayKey: 'id' } });
let basisRoutes = 0;
receiving.watch('/todos/0/done', () => {
  basisRoutes++;
});
const appliedEnvelope = receiving.commitPatchWithBasis(envelope);
assert.strictEqual(appliedEnvelope.status, 'applied');
assert.strictEqual(appliedEnvelope.applied, true);
assert.strictEqual(appliedEnvelope.stale, false);
assert.strictEqual(receiving.getBasis(), 1);
assert.deepStrictEqual(receiving.get(), { todos: [{ id: 'a', done: true }], text: 'hello' });
assert.strictEqual(basisRoutes, 1);

const rejectedEnvelope = receiving.commitPatchWithBasis(envelope);
assert.strictEqual(rejectedEnvelope.status, 'rejected');
assert.strictEqual(rejectedEnvelope.applied, false);
assert.strictEqual(rejectedEnvelope.stale, true);
assert.strictEqual(rejectedEnvelope.reason, 'basis-mismatch');
assert.strictEqual(receiving.getBasis(), 1);
assert.throws(() => receiving.commitPatch(envelope), /state patch basis validation failed/);

const routedEnvelope = receiving.commitPatchWithBasis(envelope, { onStale: 'route' });
assert.strictEqual(routedEnvelope.status, 'routed');
assert.strictEqual(routedEnvelope.applied, false);
assert.strictEqual(routedEnvelope.routed, 1);
assert.strictEqual(receiving.getBasis(), 1);
assert.strictEqual(basisRoutes, 2);

const applyStale = receiving.commitPatchWithBasis(envelope, { onStale: 'apply' });
assert.strictEqual(applyStale.status, 'applied');
assert.strictEqual(applyStale.stale, true);
assert.strictEqual(applyStale.nextBasis, 2);
assert.strictEqual(receiving.getBasis(), 2);

const rawEnvelope = createStatePatchEnvelope([[0, ['text'], 'updated']], receiving.getBasis());
const rawApplied = receiving.commitPatchWithBasis(rawEnvelope);
assert.strictEqual(rawApplied.status, 'applied');
assert.strictEqual(rawApplied.nextBasis, 3);
assert.strictEqual(receiving.getBasis(), 3);
assert.deepStrictEqual(receiving.get(), { todos: [{ id: 'a', done: true }], text: 'updated' });

const appRegistry = createFrontierRegistry({ generatedAt: () => 456 });
const registeredState = createStateEngine(
  { todos: [{ id: 'a', done: false }] },
  {
    diff: { arrayKey: 'id' },
    registry: {
      registry: appRegistry,
      id: 'app.todos.state',
      feature: 'todos',
      owner: 'state-team',
      source: { file: 'src/features/todos/state.ts', exportName: 'createTodosState' },
      tags: ['app-state']
    }
  }
);
registeredState.watch('/todos/0/done', () => undefined);
registeredState.commit({ todos: [{ id: 'a', done: true }] });
const stateGraph = appRegistry.inspect();
assert.strictEqual(stateGraph.generatedAt, 456);
assert.ok(stateGraph.entries.some((entry) => entry.id === 'app.todos.state' && entry.kind === 'state'));
assert.ok(stateGraph.entries.some((entry) => entry.kind === 'subscription'));
assert.ok(stateGraph.edges.some((edge) => edge.kind === 'declares-read' && edge.to === 'path:/todos/0/done'));
assert.ok(stateGraph.records.some((record) => record.entryId === 'app.todos.state'));
assert.ok(stateGraph.edges.some((edge) => edge.from.startsWith('record:') && edge.to === 'path:/todos/0/done'));
const stateImpact = frontierRegistryImpact(stateGraph, { paths: ['/todos/0/done'] });
assert.ok(stateImpact.entries.some((entry) => entry.kind === 'subscription'));

const mapped = mapPath(['todos', 0, 'done'], [[1, ['todos', 0, 'done']]], { validate: false });
assert.strictEqual(mapped, null);

assert.deepStrictEqual(
  mapTextPosition(['text'], 2, [[5, ['text'], 1, 0, 'X']], { validate: false }),
  { path: ['text'], offset: 3 }
);
assert.deepStrictEqual(
  mapTextPositions([{ path: ['text'], offset: 2 }], [[5, ['text'], 1, 0, 'X']], { validate: false }),
  [{ path: ['text'], offset: 3 }]
);

assert.strictEqual(state.createCrdtDocument, undefined);
assert.strictEqual(state.createLogger, undefined);
