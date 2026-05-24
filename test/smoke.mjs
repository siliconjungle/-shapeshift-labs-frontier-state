import assert from 'node:assert';
import {
  createPatchRouter,
  createStateEngine,
  mapPath,
  mapTextPosition,
  mapTextPositions
} from '../dist/index.js';
import { mapPath as mapPathSubpath } from '../dist/path-map.js';

assert.strictEqual(typeof createPatchRouter, 'function');
assert.strictEqual(typeof createStateEngine, 'function');
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
