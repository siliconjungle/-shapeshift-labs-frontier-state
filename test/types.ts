import {
  createPatchRouter,
  createStateEngine,
  createStatePatchEnvelope,
  mapPath,
  mapTextPosition,
  mapTextPositions,
  type DeltaView,
  type JsonPath,
  type JsonValue,
  type Patch,
  type PatchRouter,
  type PatchSubscription,
  type StatePatchCommitResult,
  type StatePatchEnvelope,
  type StateEngine,
  type TextPosition
} from '../dist/index.js';
import { mapPath as mapPathSubpath } from '../dist/path-map.js';

const initial: JsonValue = {
  rows: [
    { id: 'a', done: false, score: 1 },
    { id: 'b', done: true, score: 2 }
  ],
  text: 'hello'
};

const router: PatchRouter = createPatchRouter();
const routedSubscription: PatchSubscription = router.watch('/rows/0/done', (patch) => {
  const received: Patch = patch;
  void received;
});

const state: StateEngine = createStateEngine(initial, {
  diff: {
    arrayKey: 'id',
    adaptive: true
  }
});

const watched: PatchSubscription = state.watch('/rows/0/done', (patch) => {
  const received: Patch = patch;
  void received;
});

const patch: Patch = state.commit({
  rows: [
    { id: 'a', done: true, score: 1 },
    { id: 'b', done: true, score: 2 }
  ],
  text: 'hello!'
});
const committed: JsonValue | undefined = state.commitPatch([[0, ['meta'], { saved: true }]]);
const basis: number = state.getBasis();
const envelope: StatePatchEnvelope = state.commitWithBasis({
  rows: [
    { id: 'a', done: true, score: 2 },
    { id: 'b', done: true, score: 2 }
  ],
  text: 'hello!'
});
const manualEnvelope: StatePatchEnvelope = createStatePatchEnvelope([[0, ['meta', 'saved'], true]], basis);
const basisResult: StatePatchCommitResult = state.commitPatchWithBasis(manualEnvelope, { onStale: 'route' });
const view: DeltaView = state.view('/rows');
const value: JsonValue | undefined = state.get();
const equal: boolean = state.equals(value as JsonValue);
const profile = state.getProfile();
state.loadProfile(profile);

const path: JsonPath | null = mapPath(['rows', 0, 'done'], patch, { validate: false });
const subpath: JsonPath | null = mapPathSubpath(['rows', 0, 'done'], patch, { validate: false });
const position: TextPosition | null = mapTextPosition(['text'], 2, [[5, ['text'], 1, 0, 'x']], { validate: false });
const positions: Array<TextPosition | null> = mapTextPositions(
  [{ path: ['text'], offset: 2 }],
  [[5, ['text'], 1, 0, 'x']],
  { validate: false }
);

void routedSubscription;
void watched;
void committed;
void envelope;
void basisResult;
void view;
void equal;
void path;
void subpath;
void position;
void positions;
