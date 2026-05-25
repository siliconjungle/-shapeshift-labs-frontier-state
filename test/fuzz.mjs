import assert from 'node:assert';
import { applyPatchImmutable } from '@shapeshift-labs/frontier/patch';
import { createStateEngine, mapPath, mapTextPosition } from '../dist/index.js';

const args = parseArgs(process.argv.slice(2));
const cases = readPositiveInt(args.cases, 500);
const steps = readPositiveInt(args.steps, 24);
const seed = readPositiveInt(args.seed, 0x57a7e);
const rng = mulberry32(seed);

for (let id = 0; id < cases; id++) {
  const localRng = mulberry32((rng() * 0xffffffff) >>> 0);
  runCase(id, localRng);
}

console.log('frontier state fuzz passed cases=' + cases + ' steps=' + steps + ' seed=' + seed);

function runCase(caseId, rng) {
  let expected = makeDocument(caseId, rng);
  const state = createStateEngine(clone(expected), {
    diff: {
      arrayKey: 'id',
      adaptive: true,
      adaptiveThreshold: 2
    }
  });

  let observed = clone(state.get());
  let routed = 0;
  let fieldRoutes = 0;
  let rangeRoutes = 0;

  state.watch([], (patch) => {
    routed += patch.length;
    observed = applyPatchImmutable(observed, patch);
  });
  state.watch({ path: ['rows', '*'], fields: [['score'], ['done']] }, (patch) => {
    fieldRoutes += patch.length;
  });
  state.watch({ path: ['rows', '*'], range: { rowStart: 0, rowEnd: 4 } }, (patch) => {
    rangeRoutes += patch.length;
  });

  for (let step = 0; step < steps; step++) {
    const choice = randomInt(rng, 8);
    if (choice === 0 && expected.rows.length > 0) {
      const rowIndex = randomInt(rng, expected.rows.length);
      const score = expected.rows[rowIndex].score + 1 + randomInt(rng, 5);
      const patch = [[0, ['rows', rowIndex, 'score'], score]];
      expected.rows[rowIndex].score = score;
      state.commitPatch(patch);
    } else {
      const next = clone(expected);
      mutateDocument(next, rng, choice);
      const patch = state.commit(next);
      assert.deepStrictEqual(
        applyPatchImmutable(expected, patch),
        next,
        'commit patch should transform expected document'
      );
      if (patch.length > 0) {
        assert.ok(Array.isArray(mapPath(['rows'], patch, { validate: false })));
        assert.doesNotThrow(() => mapTextPosition(['text'], 0, patch, { validate: false }));
      }
      expected = next;
    }

    assert.deepStrictEqual(state.get(), expected, 'state engine value should match expected after step ' + step);
    assert.deepStrictEqual(observed, expected, 'root watcher should replay state after step ' + step);
  }

  const view = state.view('/rows');
  assert.deepStrictEqual(view.value(), expected.rows);
  const refreshed = view.refresh();
  assert.strictEqual(Array.isArray(refreshed), true);
  view.dispose();

  const profile = state.getProfile();
  assert.strictEqual(profile.plans?.state?.routing, 'patch-router');
  state.loadProfile(profile);
  assert.strictEqual(state.equals(expected), true);
  assert.ok(routed > 0);
  assert.ok(fieldRoutes >= 0);
  assert.ok(rangeRoutes >= 0);
}

function mutateDocument(doc, rng, choice) {
  if (choice === 1 && doc.rows.length > 0) {
    const row = doc.rows[randomInt(rng, doc.rows.length)];
    row.done = !row.done;
    row.revision++;
    return;
  }
  if (choice === 2 && doc.rows.length > 0) {
    const row = doc.rows[randomInt(rng, doc.rows.length)];
    row.name += '-x';
    row.revision++;
    return;
  }
  if (choice === 3 || doc.rows.length === 0) {
    const id = 'row-' + doc.nextId++;
    doc.rows.push({
      id,
      name: 'Row ' + id,
      score: randomInt(rng, 1000),
      done: false,
      revision: 0
    });
    return;
  }
  if (choice === 4 && doc.rows.length > 1) {
    doc.rows.splice(randomInt(rng, doc.rows.length), 1);
    return;
  }
  if (choice === 5) {
    const index = randomInt(rng, doc.text.length + 1);
    doc.text = doc.text.slice(0, index) + String.fromCharCode(97 + randomInt(rng, 26)) + doc.text.slice(index);
    return;
  }
  if (choice === 6 && doc.text.length > 0) {
    const index = randomInt(rng, doc.text.length);
    doc.text = doc.text.slice(0, index) + doc.text.slice(index + 1);
    return;
  }
  doc.meta.tick++;
  doc.meta.active = !doc.meta.active;
}

function makeDocument(caseId, rng) {
  const rowCount = 3 + randomInt(rng, 5);
  const rows = new Array(rowCount);
  for (let index = 0; index < rowCount; index++) {
    rows[index] = {
      id: 'case-' + caseId + '-' + index,
      name: 'Row ' + index,
      score: randomInt(rng, 100),
      done: randomInt(rng, 2) === 0,
      revision: 0
    };
  }
  return {
    rows,
    text: 'hello-' + caseId,
    meta: {
      active: true,
      tick: 0
    },
    nextId: rowCount
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function randomInt(rng, max) {
  return Math.floor(rng() * max);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--cases') out.cases = argv[++i];
    else if (arg === '--steps') out.steps = argv[++i];
    else if (arg === '--seed') out.seed = argv[++i];
    else throw new Error('unknown argument: ' + arg);
  }
  return out;
}

function readPositiveInt(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

function mulberry32(seed) {
  let value = seed >>> 0;
  return function next() {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
