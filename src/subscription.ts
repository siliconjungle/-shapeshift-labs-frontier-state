import {
  OP_SET,
  OP_REMOVE,
  OP_TRUNCATE,
  OP_APPEND,
  OP_ASSIGN,
  OP_STRING_SPLICE,
  OP_ARRAY_SPLICE,
  OP_ARRAY_MOVE,
  OP_STRING_COPY,
  OP_ARRAY_ASSIGN,
  OP_ARRAY_OBJECT_ASSIGN,
  OP_ARRAY_TUPLE_ASSIGN,
  OP_ARRAY_OBJECT_FIELD_ASSIGN,
  OP_SCALAR_ARRAY_REPLACE,
  OP_ARRAY_TWO_FIELD_INSERT
} from '@shapeshift-labs/frontier/constants';
import { applyPatch } from '@shapeshift-labs/frontier/apply';
import { cloneJson } from '@shapeshift-labs/frontier/clone';
import { diff } from '@shapeshift-labs/frontier/diff';
import { createDiffEngine } from '@shapeshift-labs/frontier-engine/engine';
import { setOwnValue } from './object.js';
import { getPath, parsePointer } from '@shapeshift-labs/frontier/pointer';
import {
  createStateProfilePlansSnapshot,
  readProfilePlans,
  type StateProfilePlanStats
} from '@shapeshift-labs/frontier-engine/profile';
import type {
  DeltaView,
  DeltaViewOptions,
  DiffOptions,
  DiffProfile,
  JsonPath,
  JsonValue,
  ObjectKey,
  Patch,
  PatchOperation,
  PatchRouter,
  PatchSubscription,
  PatchWatchCallback,
  StateBasisToken,
  StateCommitWithBasisOptions,
  StateEngine,
  StateEngineOptions,
  StatePatchCommitOptions,
  StatePatchCommitReason,
  StatePatchCommitResult,
  StatePatchEnvelope,
  StatePatchEnvelopeOptions,
  StatePatchInput,
  TrainingSample,
  WatchOptions,
  WatchRange,
  WatchPath
} from './types.js';

const WILDCARD = '*';
const hasOwn = Object.prototype.hasOwnProperty;

type ViewDiffFunction = (source: JsonValue, target: JsonValue) => Patch;

type RouteNode = {
  watchers: WatchEntry[];
  children: Map<string | number, RouteNode>;
  wildcard: RouteNode | null;
};

type WatchEntry = {
  active: boolean;
  callback: PatchWatchCallback;
  nodes: RouteNode[];
  indexBuckets: WatchEntry[][];
  range: NormalizedWatchRange | null;
  rangeSelectors: RangeSelector[];
  rangeBasePath: JsonPath | null;
  rangeFieldPath: JsonPath | null;
  pending: Patch | null;
  routeMark: number;
  deliveryMark: number;
  genericOnlyPaths: number;
  wildcardPaths: number;
};

type RouteIndexes = {
  exactByKey: Map<string, WatchEntry[]>;
  rowFieldExactByShape: Map<string, Map<string | number, WatchEntry[]>>;
  rowFieldWildcardByShape: Map<string, WatchEntry[]>;
  rangeByBase: Map<string, WatchEntry[]>;
  rangeWatchers: WatchEntry[];
  operationRouteCache: WeakMap<PatchOperation, OperationRouteCache>;
  lastOperation: PatchOperation | null;
  lastOperationRouteCache: OperationRouteCache | null;
  maxIndexedDepth: number;
  maxRowFieldSuffixByBase: Map<string, number>;
  genericOnlyPathCount: number;
  wildcardPathCount: number;
  version: number;
};

type NormalizedWatchRange = {
  rowStart: number;
  rowEnd: number;
  columnStart: number;
  columnEnd: number;
  hasColumn: boolean;
};

type RangeSelector = {
  basePath: JsonPath;
  baseKey: string;
  fieldPath: JsonPath;
};

type OperationRouteCache = {
  version: number;
  code: number;
  watchers: WatchEntry[];
  path?: JsonPath;
  pathSnapshot?: JsonPath;
  rowIndexes?: number[];
  rowIndexSnapshot?: number[];
  rowIndexSensitive?: boolean;
  fields?: JsonPath[];
  fieldSnapshots?: JsonPath[];
  singleNestedField?: boolean;
  base0?: string | number;
  field0?: string | number;
  field1?: string | number;
};

type DeltaViewPlan = {
  canRepair: boolean;
  canRepairExact: boolean;
  basePath: JsonPath;
  tailPath: JsonPath;
  keyBy?: DeltaViewOptions['keyBy'];
  rowToViewKey: Map<string, string>;
};

type DeltaViewEntry = {
  included: boolean;
  viewKey?: string;
  value?: JsonValue;
};

type WatchCall = {
  path: WatchPath | WatchOptions;
  fieldsOrCallback: WatchPath[] | PatchWatchCallback;
  callback?: PatchWatchCallback;
};

export function createPatchRouter(): PatchRouter {
  let root = createRouteNode();
  let activeCount = 0;
  let routeMark = 1;
  let deliveryMark = 1;
  let singleRouteDepth = 0;
  const singleMatches: WatchEntry[] = [];
  const entries = new Set<WatchEntry>();
  const indexes = createRouteIndexes();
  let singletonRouteKind = 0;
  let singletonExactEntry: WatchEntry | null = null;
  let singletonExactPath: JsonPath | null = null;
  let singletonRowFieldEntry: WatchEntry | null = null;
  let singletonRowFieldBase0: string | number | null = null;
  let singletonRowField0: string | number | null = null;
  let singletonRowField1: string | number | null = null;

  function watch(pathOrOptions: WatchPath | WatchOptions, fieldsOrCallback: WatchPath[] | PatchWatchCallback, callback?: PatchWatchCallback): PatchSubscription {
    const parsed = parseWatchCall({ path: pathOrOptions, fieldsOrCallback, callback });
    const entry: WatchEntry = {
      active: true,
      callback: parsed.callback,
      nodes: [],
      indexBuckets: [],
      range: parsed.range,
      rangeSelectors: [],
      rangeBasePath: null,
      rangeFieldPath: null,
      pending: null,
      routeMark: 0,
      deliveryMark: 0,
      genericOnlyPaths: 0,
      wildcardPaths: 0
    };

    const paths = expandWatchPaths(parsed.path, parsed.fields);
    for (let i = 0, length = paths.length; i < length; i++) {
      if (parsed.range === null) {
        insertWatchPath(root, paths[i], entry);
        indexWatchPath(indexes, paths[i], entry);
      } else {
        indexRangeWatchPath(indexes, paths[i], entry, parsed.range);
      }
    }
    entries.add(entry);
    if (parsed.range === null && activeCount === 0 && paths.length === 1) {
      if (!hasWildcardSegment(paths[0])) {
        singletonRouteKind = 1;
        singletonExactEntry = entry;
        singletonExactPath = paths[0];
        singletonRowFieldEntry = null;
        singletonRowFieldBase0 = null;
        singletonRowField0 = null;
        singletonRowField1 = null;
      } else if (isSingletonRowFieldWildcardPath(paths[0])) {
        singletonRouteKind = 2;
        singletonExactEntry = null;
        singletonExactPath = null;
        singletonRowFieldEntry = entry;
        singletonRowFieldBase0 = paths[0][0];
        singletonRowField0 = paths[0][2];
        singletonRowField1 = paths[0][3];
      } else {
        singletonRouteKind = 0;
        singletonExactEntry = null;
        singletonExactPath = null;
        singletonRowFieldEntry = null;
        singletonRowFieldBase0 = null;
        singletonRowField0 = null;
        singletonRowField1 = null;
      }
    } else {
      singletonRouteKind = 0;
      singletonExactEntry = null;
      singletonExactPath = null;
      singletonRowFieldEntry = null;
      singletonRowFieldBase0 = null;
      singletonRowField0 = null;
      singletonRowField1 = null;
    }
    activeCount++;
    indexes.lastOperation = null;
    indexes.lastOperationRouteCache = null;
    indexes.version++;

    return {
      get active() {
        return entry.active;
      },
      unsubscribe() {
        if (!entry.active) return;
        entry.active = false;
        entry.pending = null;
        for (let i = 0, length = entry.nodes.length; i < length; i++) {
          removeWatcher(entry.nodes[i], entry);
        }
        entry.nodes.length = 0;
        for (let i = 0, length = entry.indexBuckets.length; i < length; i++) {
          removeIndexWatcher(entry.indexBuckets[i], entry);
        }
        entry.indexBuckets.length = 0;
        entry.rangeSelectors.length = 0;
        entry.rangeBasePath = null;
        entry.rangeFieldPath = null;
        indexes.genericOnlyPathCount -= entry.genericOnlyPaths;
        indexes.wildcardPathCount -= entry.wildcardPaths;
        entry.genericOnlyPaths = 0;
        entry.wildcardPaths = 0;
        entries.delete(entry);
        activeCount--;
        if (singletonExactEntry === entry) {
          singletonRouteKind = 0;
          singletonExactEntry = null;
          singletonExactPath = null;
        }
        if (singletonRowFieldEntry === entry) {
          singletonRouteKind = 0;
          singletonRowFieldEntry = null;
          singletonRowFieldBase0 = null;
          singletonRowField0 = null;
          singletonRowField1 = null;
        }
        indexes.lastOperation = null;
        indexes.lastOperationRouteCache = null;
        indexes.version++;
      }
    };
  }

  function route(patch: Patch): number {
    if (!Array.isArray(patch) || patch.length === 0 || activeCount === 0) return 0;

    if (patch.length === 1) {
      const op = patch[0];
      if (singletonRouteKind === 1) {
        const singletonCount = routeSingletonExact(singletonExactEntry as WatchEntry, singletonExactPath as JsonPath, op, patch);
        if (singletonCount === 1 && (singletonExactEntry as WatchEntry).active) {
          (singletonExactEntry as WatchEntry).callback(patch);
        }
        if (singletonCount !== -1) return singletonCount;
      } else if (singletonRouteKind === 2) {
        const singletonRowFieldCount = routeSingletonRowField(
          singletonRowFieldEntry as WatchEntry,
          singletonRowFieldBase0,
          singletonRowField0,
          singletonRowField1,
          op,
          patch
        );
        if (singletonRowFieldCount === 1 && (singletonRowFieldEntry as WatchEntry).active) {
          (singletonRowFieldEntry as WatchEntry).callback(patch);
        }
        if (singletonRowFieldCount !== -1) return singletonRowFieldCount;
      }
      const cachedCount = dispatchCachedOperationRoute(indexes, op, patch);
      if (cachedCount !== -1) return cachedCount;

      const matches = singleRouteDepth === 0 ? singleMatches : [];
      matches.length = 0;
      singleRouteDepth++;
      try {
        const mark = nextRouteMark();
        if (!routePlainOperation(root, indexes, op, matches, mark) && !routeIndexedOperation(indexes, op, matches, mark)) {
          routeOperation(root, op, matches, mark);
        }
        writeCachedOperationRoute(indexes, op, matches);
        const count = matches.length;
        for (let i = 0; i < count; i++) {
          const entry = matches[i];
          if (entry.active) entry.callback(patch);
        }
        return count;
      } finally {
        singleRouteDepth--;
        if (matches === singleMatches) matches.length = 0;
      }
    }

    const seen: WatchEntry[] = [];
    const deliveries: WatchEntry[] = [];
    const currentDeliveryMark = nextDeliveryMark();
    for (let i = 0, length = patch.length; i < length; i++) {
      const mark = nextRouteMark();
      if (!routeIndexedOperation(indexes, patch[i], seen, mark)) {
        routeOperation(root, patch[i], seen, mark);
      }
      for (let j = 0, seenLength = seen.length; j < seenLength; j++) {
        const entry = seen[j];
        if (entry.pending === null) {
          entry.pending = [patch[i]];
          if (entry.deliveryMark !== currentDeliveryMark) {
            entry.deliveryMark = currentDeliveryMark;
            deliveries[deliveries.length] = entry;
          }
        } else {
          entry.pending[entry.pending.length] = patch[i];
        }
      }
      seen.length = 0;
    }

    for (let i = 0, length = deliveries.length; i < length; i++) {
      const entry = deliveries[i];
      const pending = entry.pending;
      entry.pending = null;
      if (entry.active && pending !== null && pending.length !== 0) {
        entry.callback(pending);
      }
    }

    return deliveries.length;
  }

  function nextRouteMark(): number {
    routeMark++;
    if (routeMark === 2147483647) {
      resetRouteMarks(entries);
      routeMark = 1;
    }
    return routeMark;
  }

  function nextDeliveryMark(): number {
    deliveryMark++;
    if (deliveryMark === 2147483647) {
      resetDeliveryMarks(entries);
      deliveryMark = 1;
    }
    return deliveryMark;
  }

  function clear() {
    for (const entry of entries) {
      entry.active = false;
      entry.pending = null;
      entry.nodes.length = 0;
      entry.indexBuckets.length = 0;
      entry.rangeSelectors.length = 0;
      entry.rangeBasePath = null;
      entry.rangeFieldPath = null;
      entry.genericOnlyPaths = 0;
      entry.wildcardPaths = 0;
    }
    entries.clear();
    clearRouteIndexes(indexes);
    root = createRouteNode();
    activeCount = 0;
    singletonRouteKind = 0;
    singletonExactEntry = null;
    singletonExactPath = null;
    singletonRowFieldEntry = null;
    singletonRowFieldBase0 = null;
    singletonRowField0 = null;
    singletonRowField1 = null;
    indexes.version++;
  }

  return {
    get size() {
      return activeCount;
    },
    watch,
    route,
    clear
  };
}

export function createStatePatchEnvelope(
  patch: Patch,
  basis: StateBasisToken,
  options: StatePatchEnvelopeOptions = {}
): StatePatchEnvelope {
  if (!Array.isArray(patch)) throw new TypeError('state patch envelope patch must be an array');
  const normalizedBasis = readStateBasisToken(basis, 'state patch basis');
  const envelope: StatePatchEnvelope = {
    kind: 'frontier.state.patch',
    patch,
    basis: normalizedBasis,
    nextBasis: readStateBasisToken(
      options.nextBasis !== undefined ? options.nextBasis : normalizedBasis + (patch.length === 0 ? 0 : 1),
      'state patch nextBasis'
    )
  };
  if (options.metadata !== undefined) envelope.metadata = cloneJson(options.metadata);
  return envelope;
}

export function createStateEngine(initial?: JsonValue, options?: StateEngineOptions): StateEngine {
  const router = createPatchRouter();
  const routePatch = router.route;
  const diffEngine = createDiffEngine((options && options.diff) as any);
  let profilePlans = readProfilePlans((options && options.diff && options.diff.profile) as any);
  const statePlanStats: StateProfilePlanStats = {
    watches: 0,
    exactWatches: 0,
    wildcardWatches: 0,
    fieldWatches: 0,
    rangeWatches: 0
  };
  let current = initial;
  let basis = readStateBasisToken(options && options.basis !== undefined ? options.basis : 0, 'state basis');

  function watch(pathOrOptions: WatchPath | WatchOptions, fieldsOrCallback: WatchPath[] | PatchWatchCallback, callback?: PatchWatchCallback): PatchSubscription {
    observeStateWatchPlan(statePlanStats, pathOrOptions, fieldsOrCallback);
    return router.watch(pathOrOptions as any, fieldsOrCallback as any, callback as any);
  }

  function commit(next: JsonValue, options?: DiffOptions): Patch {
    const patch = current === undefined
      ? [[OP_SET, [], cloneJson(next)] as PatchOperation]
      : diffEngine.diff(current, next, options as any);
    current = next;
    routeAndAdvancePatch(patch);
    return patch;
  }

  function commitWithBasis(next: JsonValue, options?: StateCommitWithBasisOptions): StatePatchEnvelope {
    const patchBasis = basis;
    const patch = commit(next, options);
    return createStatePatchEnvelope(patch, patchBasis, { nextBasis: basis, metadata: options && options.metadata });
  }

  function commitPatch(input: StatePatchInput, options?: StatePatchCommitOptions): JsonValue | undefined {
    if (isStatePatchEnvelope(input) || options !== undefined && options.basis !== undefined) {
      const result = commitPatchWithBasis(input, options);
      if (!result.applied && result.status === 'rejected') {
        throw new TypeError('state patch basis validation failed: ' + result.reason);
      }
      return result.value;
    }
    applyAndRoutePatch(input as Patch);
    return current;
  }

  function commitPatchWithBasis(input: StatePatchInput, options: StatePatchCommitOptions = {}): StatePatchCommitResult {
    const envelope = isStatePatchEnvelope(input) ? input : null;
    const patch = envelope ? envelope.patch : input as Patch;
    const patchBasis = readStateBasisToken(
      options.basis !== undefined ? options.basis : envelope ? envelope.basis : basis,
      'state patch basis'
    );
    const currentBasis = basis;
    const stale = patchBasis !== currentBasis;
    const reason: StatePatchCommitReason | undefined = stale ? 'basis-mismatch' : patch.length === 0 ? 'empty-patch' : undefined;
    const onStale = options.onStale || 'reject';

    if (stale && onStale !== 'apply') {
      const routed = onStale === 'route' ? routePatch(patch) : 0;
      return {
        status: onStale === 'route' ? 'routed' : 'rejected',
        applied: false,
        stale: true,
        routed,
        patch,
        basis: patchBasis,
        currentBasis,
        nextBasis: basis,
        value: current,
        reason
      };
    }

    const nextBasis = readPatchNextBasis(
      patch,
      currentBasis,
      options.nextBasis !== undefined ? options.nextBasis : stale && onStale === 'apply' ? undefined : envelope && envelope.nextBasis
    );
    const routed = applyAndRoutePatch(patch, nextBasis);
    return {
      status: 'applied',
      applied: true,
      stale,
      routed,
      patch,
      basis: patchBasis,
      currentBasis,
      nextBasis: basis,
      value: current,
      reason
    };
  }

  function createPatchEnvelope(patch: Patch, options?: StatePatchEnvelopeOptions): StatePatchEnvelope {
    return createStatePatchEnvelope(patch, basis, options);
  }

  function applyAndRoutePatch(patch: Patch, nextBasis?: StateBasisToken): number {
    if (current !== undefined) {
      const fast = applyStatePatchFast(current, patch);
      current = fast === NO_STATE_PATCH_FAST_PATH ? applyPatch(current, patch) : fast;
    }
    return routeAndAdvancePatch(patch, nextBasis);
  }

  function routeAndAdvancePatch(patch: Patch, nextBasis?: StateBasisToken): number {
    const routed = routePatch(patch);
    if (patch.length !== 0) basis = nextBasis === undefined ? basis + 1 : nextBasis;
    return routed;
  }

  function view(pathOrOptions: WatchPath | DeltaViewOptions): DeltaView {
    return createDeltaView(
      () => current,
      watch,
      typeof pathOrOptions === 'object' && !Array.isArray(pathOrOptions)
        ? pathOrOptions
        : { path: pathOrOptions },
      options && options.diff ? diffEngine.diff : undefined
    );
  }

  function clear() {
    router.clear();
    diffEngine.clear();
  }

  function equals(next: JsonValue, options?: DiffOptions): boolean {
    return current !== undefined && diffEngine.equals(current, next, options as any);
  }

  function train(samples: TrainingSample[]): DiffProfile {
    return diffEngine.train(samples as any) as any;
  }

  function getProfile(): DiffProfile {
    const profile = diffEngine.getProfile();
    const plans = createStateProfilePlansSnapshot((profilePlans || profile.plans) as any, statePlanStats);
    return (plans === undefined ? profile : { ...profile, plans }) as any;
  }

  function loadProfile(profile?: DiffProfile | null): void {
    profilePlans = readProfilePlans(profile as any);
    diffEngine.loadProfile(profile as any);
  }

  return {
    get() {
      return current;
    },
    getBasis() {
      return basis;
    },
    createPatchEnvelope,
    watch,
    commit,
    commitWithBasis,
    set: commit,
    commitPatch,
    commitPatchWithBasis,
    view,
    equals,
    train,
    getProfile,
    loadProfile,
    clear
  };
}

function isStatePatchEnvelope(value: StatePatchInput): value is StatePatchEnvelope {
  return value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (value as StatePatchEnvelope).kind === 'frontier.state.patch' &&
    Array.isArray((value as StatePatchEnvelope).patch);
}

function readPatchNextBasis(
  patch: Patch,
  currentBasis: StateBasisToken,
  value: StateBasisToken | null | false | undefined
): StateBasisToken {
  if (patch.length === 0) return currentBasis;
  const nextBasis = value === undefined || value === null || value === false
    ? currentBasis + 1
    : readStateBasisToken(value, 'state patch nextBasis');
  if (nextBasis <= currentBasis) {
    throw new RangeError('state patch nextBasis must advance the current basis');
  }
  return nextBasis;
}

function readStateBasisToken(value: unknown, label: string): StateBasisToken {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError(label + ' must be a non-negative safe integer');
  }
  return value as number;
}

function observeStateWatchPlan(
  stats: StateProfilePlanStats,
  pathOrOptions: WatchPath | WatchOptions,
  fieldsOrCallback: WatchPath[] | PatchWatchCallback
): void {
  stats.watches++;
  const optionsLike = pathOrOptions !== null && typeof pathOrOptions === 'object' && !Array.isArray(pathOrOptions);
  const hasFields = Array.isArray(fieldsOrCallback) || (optionsLike && Array.isArray((pathOrOptions as WatchOptions).fields));
  const hasRange = optionsLike && (pathOrOptions as WatchOptions).range !== undefined;
  const path = optionsLike ? (pathOrOptions as WatchOptions).path : pathOrOptions as WatchPath;
  if (hasFields) stats.fieldWatches++;
  if (hasRange) stats.rangeWatches++;
  if (watchPathHasWildcard(path)) stats.wildcardWatches++;
  else stats.exactWatches++;
}

function watchPathHasWildcard(path: WatchPath | undefined): boolean {
  if (path === undefined) return false;
  if (typeof path === 'string') return path.indexOf('*') !== -1;
  for (let i = 0, length = path.length; i < length; i++) {
    if (path[i] === '*') return true;
  }
  return false;
}

const NO_STATE_PATCH_FAST_PATH = Symbol('noStatePatchFastPath');
const SKIP_DELTA_VIEW_PATCH = Symbol('skipDeltaViewPatch');

function applyStatePatchFast(current: JsonValue, patch: Patch): JsonValue | typeof NO_STATE_PATCH_FAST_PATH {
  if (patch.length === 0) return current;
  if (patch.length === 1) return applyStateSinglePatchFast(current, patch[0]);
  const sameParentSet = tryApplyStateSameParentSetPatch(current, patch);
  if (sameParentSet !== NO_STATE_PATCH_FAST_PATH) return sameParentSet;
  if (!canApplyStatePatchFast(patch)) return NO_STATE_PATCH_FAST_PATH;

  let root = current;
  for (let i = 0, length = patch.length; i < length; i++) {
    const op = patch[i];
    switch (op[0]) {
      case OP_SET:
        root = applyStateSet(root, op[1], op[2]);
        break;
      case OP_REMOVE:
        root = applyStateRemove(root, op[1]);
        break;
      case OP_TRUNCATE:
        applyStateTruncate(root, op[1], op[2]);
        break;
      case OP_APPEND:
        applyStateAppend(root, op[1], op[2]);
        break;
      case OP_SCALAR_ARRAY_REPLACE:
        root = applyStateSet(root, op[1], op[2].slice());
        break;
      case OP_ASSIGN:
        applyStateAssign(root, op[1], op[2]);
        break;
      case OP_ARRAY_SPLICE:
        applyStateArraySplice(root, op[1], op[2], op[3], op[4]);
        break;
      case OP_ARRAY_MOVE:
        applyStateArrayMove(root, op[1], op[2], op[3]);
        break;
      case OP_ARRAY_ASSIGN:
        applyStateArrayAssign(root, op[1], op[2], op[3]);
        break;
      case OP_ARRAY_OBJECT_ASSIGN:
        applyStateArrayObjectAssign(root, op[1], op[2], op[3]);
        break;
      case OP_ARRAY_TUPLE_ASSIGN:
        applyStateArrayTupleAssign(root, op[1], op[2], op[3], op[4]);
        break;
      case OP_ARRAY_OBJECT_FIELD_ASSIGN:
        root = applyStateArrayObjectFieldAssign(root, op[1], op[2], op[3], op[4]);
        break;
      case OP_ARRAY_TWO_FIELD_INSERT:
        applyStateArrayTwoFieldInsert(root, op[1], op[2], op[3], op[4], op[5], op[6]);
        break;
      case OP_STRING_SPLICE:
        root = applyStateStringSplice(root, op[1], op[2], op[3], op[4]);
        break;
      case OP_STRING_COPY:
        root = applyStateStringCopy(root, op[1], op[2], op[3], op[4]);
        break;
    }
  }
  return root;
}

function tryApplyStateSameParentSetPatch(current: JsonValue, patch: Patch): JsonValue | typeof NO_STATE_PATCH_FAST_PATH {
  const length = patch.length;
  if (length < 8) return NO_STATE_PATCH_FAST_PATH;

  const first = patch[0];
  if (first[0] !== OP_SET) return NO_STATE_PATCH_FAST_PATH;
  const firstPath = first[1];
  const pathLength = firstPath.length;
  if (pathLength === 0 || pathLength > 128) return NO_STATE_PATCH_FAST_PATH;
  const parentDepth = pathLength - 1;

  for (let i = 1; i < length; i++) {
    const op = patch[i];
    if (op[0] !== OP_SET) return NO_STATE_PATCH_FAST_PATH;
    const path = op[1];
    if (path.length !== pathLength || !sameStatePathPrefix(firstPath, path, parentDepth)) {
      return NO_STATE_PATCH_FAST_PATH;
    }
  }

  let parent = current as any;
  for (let i = 0; i < parentDepth; i++) parent = parent[firstPath[i]];
  if (parent === null || typeof parent !== 'object') return NO_STATE_PATCH_FAST_PATH;

  for (let i = 0; i < length; i++) {
    const op = patch[i];
    const key = op[1][parentDepth];
    if (key === '__proto__') {
      setOwnValue(parent, key, op[2]);
    } else {
      parent[key] = op[2];
    }
  }
  return current;
}

function sameStatePathPrefix(left: JsonPath, right: JsonPath, length: number): boolean {
  for (let i = 0; i < length; i++) {
    if (left[i] !== right[i]) return false;
  }
  return true;
}

function applyStateSinglePatchFast(current: JsonValue, op: PatchOperation): JsonValue | typeof NO_STATE_PATCH_FAST_PATH {
  switch (op[0]) {
    case OP_SET:
      return applyStateSet(current, op[1], op[2]);
    case OP_REMOVE:
      return applyStateRemove(current, op[1]);
    case OP_TRUNCATE:
      applyStateTruncate(current, op[1], op[2]);
      return current;
    case OP_APPEND:
      applyStateAppend(current, op[1], op[2]);
      return current;
    case OP_SCALAR_ARRAY_REPLACE:
      return applyStateSet(current, op[1], op[2].slice());
    case OP_ASSIGN:
      applyStateAssign(current, op[1], op[2]);
      return current;
    case OP_ARRAY_SPLICE:
      applyStateArraySplice(current, op[1], op[2], op[3], op[4]);
      return current;
    case OP_ARRAY_MOVE:
      applyStateArrayMove(current, op[1], op[2], op[3]);
      return current;
    case OP_ARRAY_ASSIGN:
      applyStateArrayAssign(current, op[1], op[2], op[3]);
      return current;
    case OP_ARRAY_OBJECT_ASSIGN:
      applyStateArrayObjectAssign(current, op[1], op[2], op[3]);
      return current;
    case OP_ARRAY_TUPLE_ASSIGN:
      applyStateArrayTupleAssign(current, op[1], op[2], op[3], op[4]);
      return current;
    case OP_ARRAY_OBJECT_FIELD_ASSIGN:
      return applyStateArrayObjectFieldAssign(current, op[1], op[2], op[3], op[4]);
    case OP_ARRAY_TWO_FIELD_INSERT:
      applyStateArrayTwoFieldInsert(current, op[1], op[2], op[3], op[4], op[5], op[6]);
      return current;
    case OP_STRING_SPLICE:
      return applyStateStringSplice(current, op[1], op[2], op[3], op[4]);
    case OP_STRING_COPY:
      return applyStateStringCopy(current, op[1], op[2], op[3], op[4]);
    default:
      return NO_STATE_PATCH_FAST_PATH;
  }
}

function canApplyStatePatchFast(patch: Patch): boolean {
  for (let i = 0, length = patch.length; i < length; i++) {
    const code = patch[i][0];
    if (
      code !== OP_SET &&
      code !== OP_REMOVE &&
      code !== OP_TRUNCATE &&
      code !== OP_APPEND &&
      code !== OP_SCALAR_ARRAY_REPLACE &&
      code !== OP_ASSIGN &&
      code !== OP_ARRAY_SPLICE &&
      code !== OP_ARRAY_MOVE &&
      code !== OP_ARRAY_ASSIGN &&
      code !== OP_ARRAY_OBJECT_ASSIGN &&
      code !== OP_ARRAY_TUPLE_ASSIGN &&
      code !== OP_ARRAY_OBJECT_FIELD_ASSIGN &&
      code !== OP_ARRAY_TWO_FIELD_INSERT &&
      code !== OP_STRING_SPLICE &&
      code !== OP_STRING_COPY
    ) {
      return false;
    }
  }
  return true;
}

function applyStateRemove(current: JsonValue, path: JsonPath): JsonValue {
  if (path.length === 0) throw new TypeError('cannot remove the root value');
  const parent = readStateParent(current, path) as any;
  delete parent[path[path.length - 1]];
  return current;
}

function applyStateSet(current: JsonValue, path: JsonPath, value: JsonValue): JsonValue {
  if (path.length === 0) return value;
  if (path.length === 4) {
    const parent = (current as any)[path[0]][path[1]][path[2]];
    const key = path[3];
    if (key === '__proto__') {
      setOwnValue(parent, key, value);
    } else {
      parent[key] = value;
    }
    return current;
  }
  let parent = current as any;
  for (let i = 0, last = path.length - 1; i < last; i++) {
    parent = parent[path[i]];
  }
  const key = path[path.length - 1];
  if (key === '__proto__') {
    setOwnValue(parent, key, value);
  } else {
    parent[key] = value;
  }
  return current;
}

function applyStateTruncate(current: JsonValue, path: JsonPath, length: number): void {
  const array = readStateTarget(current, path) as any[];
  array.length = length;
}

function applyStateAppend(current: JsonValue, path: JsonPath, values: JsonValue[]): void {
  const array = readStateTarget(current, path) as any[];
  const offset = array.length;
  for (let i = 0, length = values.length; i < length; i++) array[offset + i] = values[i];
}

function applyStateAssign(current: JsonValue, path: JsonPath, values: Record<string, JsonValue>): void {
  const object = readStateTarget(current, path) as any;
  const keys = Object.keys(values);
  if (!hasOwn.call(values, '__proto__')) {
    for (let i = 0, length = keys.length; i < length; i++) {
      const key = keys[i];
      object[key] = values[key];
    }
    return;
  }

  for (let i = 0, length = keys.length; i < length; i++) {
    const key = keys[i];
    if (key === '__proto__') {
      setOwnValue(object, key, values[key]);
    } else {
      object[key] = values[key];
    }
  }
}

function applyStateArraySplice(current: JsonValue, path: JsonPath, start: number, deleteCount: number, values: JsonValue[]): void {
  const array = readStateTarget(current, path) as any[];
  const insertCount = values.length;
  if (insertCount === 0) {
    array.splice(start, deleteCount);
    return;
  }
  if (insertCount === deleteCount) {
    for (let i = 0; i < insertCount; i++) array[start + i] = values[i];
    return;
  }
  array.splice(start, deleteCount, ...values);
}

function applyStateArrayMove(current: JsonValue, path: JsonPath, from: number, to: number): void {
  if (from === to) return;
  const array = readStateTarget(current, path) as any[];
  const value = array[from];
  array.splice(from, 1);
  array.splice(to, 0, value);
}

function applyStateArrayAssign(current: JsonValue, path: JsonPath, indexes: number[], values: JsonValue[]): void {
  const array = readStateTarget(current, path) as any[];
  for (let i = 0, length = indexes.length; i < length; i++) {
    array[indexes[i]] = values[i];
  }
}

function applyStateArrayObjectAssign(current: JsonValue, path: JsonPath, indexes: number[], values: Record<string, JsonValue>[]): void {
  const array = readStateTarget(current, path) as any[];
  for (let i = 0, length = indexes.length; i < length; i++) {
    applyStateAssign(array[indexes[i]], [], values[i]);
  }
}

function applyStateArrayTupleAssign(
  current: JsonValue,
  path: JsonPath,
  rowIndexes: number[],
  fieldIndexes: number[],
  values: JsonValue[]
): void {
  const array = readStateTarget(current, path) as any[];
  for (let i = 0, length = rowIndexes.length; i < length; i++) {
    array[rowIndexes[i]][fieldIndexes[i]] = values[i];
  }
}

function applyStateArrayTwoFieldInsert(
  current: JsonValue,
  path: JsonPath,
  start: number,
  key0: string,
  key1: string,
  values0: JsonValue[],
  values1: JsonValue[]
): void {
  const array = readStateTarget(current, path) as any[];
  const length = values0.length;
  const inserted = new Array(length);
  if (key0 === 'position' && key1 === 'char') {
    for (let i = 0; i < length; i++) inserted[i] = { position: values0[i], char: values1[i] };
  } else if (key0 === 'id' && key1 === 'value') {
    for (let i = 0; i < length; i++) inserted[i] = { id: values0[i], value: values1[i] };
  } else {
    for (let i = 0; i < length; i++) {
      const row: Record<string, JsonValue> = {};
      if (key0 === '__proto__') setOwnValue(row, key0, values0[i]);
      else row[key0] = values0[i];
      if (key1 === '__proto__') setOwnValue(row, key1, values1[i]);
      else row[key1] = values1[i];
      inserted[i] = row;
    }
  }
  array.splice(start, 0, ...inserted);
}

function applyStateArrayObjectFieldAssign(
  current: JsonValue,
  path: JsonPath,
  rowIndexes: number[],
  fields: JsonPath[],
  values: JsonValue[]
): JsonValue {
  const array = path.length === 1
    ? (current as any)[path[0]]
    : readStateTarget(current, path) as any[];
  if (fields.length === 1) {
    const field = fields[0];
    if (field.length === 1) {
      const key = field[0];
      if (key !== '__proto__') {
        for (let i = 0, length = rowIndexes.length; i < length; i++) {
          array[rowIndexes[i]][key] = values[i];
        }
      } else {
        for (let i = 0, length = rowIndexes.length; i < length; i++) {
          setOwnValue(array[rowIndexes[i]], key, values[i]);
        }
      }
      return current;
    }
    if (field.length === 2) {
      const parentKey = field[0];
      const childKey = field[1];
      if (childKey !== '__proto__') {
        for (let i = 0, length = rowIndexes.length; i < length; i++) {
          array[rowIndexes[i]][parentKey][childKey] = values[i];
        }
      } else {
        for (let i = 0, length = rowIndexes.length; i < length; i++) {
          setOwnValue(array[rowIndexes[i]][parentKey], childKey, values[i]);
        }
      }
      return current;
    }
  }

  let cursor = 0;
  for (let rowOffset = 0, rowCount = rowIndexes.length; rowOffset < rowCount; rowOffset++) {
    const row = array[rowIndexes[rowOffset]];
    for (let fieldIndex = 0, fieldCount = fields.length; fieldIndex < fieldCount; fieldIndex++) {
      applyStateRelativeField(row, fields[fieldIndex], values[cursor++]);
    }
  }
  return current;
}

function applyStateStringSplice(current: JsonValue, path: JsonPath, start: number, deleteCount: number, insert: string): JsonValue {
  if (path.length === 0) {
    const text = current as string;
    return text.slice(0, start) + insert + text.slice(start + deleteCount);
  }
  const parent = readStateParent(current, path) as any;
  const key = path[path.length - 1];
  const text = parent[key];
  setOwnValue(parent, key, text.slice(0, start) + insert + text.slice(start + deleteCount));
  return current;
}

function applyStateStringCopy(current: JsonValue, path: JsonPath, targetStart: number, sourceStart: number, count: number): JsonValue {
  if (path.length === 0) {
    const text = current as string;
    return text.slice(0, targetStart) + text.slice(sourceStart, sourceStart + count) + text.slice(targetStart);
  }
  const parent = readStateParent(current, path) as any;
  const key = path[path.length - 1];
  const text = parent[key];
  setOwnValue(parent, key, text.slice(0, targetStart) + text.slice(sourceStart, sourceStart + count) + text.slice(targetStart));
  return current;
}

function applyStateRelativeField(row: JsonValue, field: JsonPath, value: JsonValue): void {
  const parent = readStateParent(row, field) as any;
  setOwnValue(parent, field[field.length - 1], value);
}

function readStateTarget(root: JsonValue, path: JsonPath): JsonValue {
  return path.length === 0 ? root : (readStateParent(root, path) as any)[path[path.length - 1]];
}

function readStateParent(root: JsonValue, path: JsonPath): JsonValue {
  let parent = root as any;
  for (let i = 0, last = path.length - 1; i < last; i++) {
    parent = parent[path[i]];
  }
  return parent;
}

function createDeltaView(
  readSource: () => JsonValue | undefined,
  watchSource: StateEngine['watch'],
  options: DeltaViewOptions,
  diffView: ViewDiffFunction = diff
): DeltaView {
  let current = buildViewValue(readSource(), options);
  let disposed = false;
  const plan = createDeltaViewPlan(readSource(), options);
  const listeners = new Set<PatchWatchCallback>();
  const sourceSubscription = watchSource(options, refreshFromSource);

  function refreshFromSource(sourcePatch?: Patch): Patch {
    if (disposed) return [];
    if (sourcePatch !== undefined) {
      const repaired = refreshDeltaViewIncremental(readSource(), options, plan, current, sourcePatch, diffView);
      if (repaired !== null) {
        current = repaired.value;
        if (repaired.patch.length !== 0) {
          for (const listener of listeners) listener(repaired.patch);
        }
        return repaired.patch;
      }
    }
    const next = buildViewValue(readSource(), options);
    const patch = diffView(
      current === undefined ? null : current,
      next === undefined ? null : next
    );
    current = next;
    resetDeltaViewPlanIndex(plan, readSource(), options);
    if (patch.length !== 0) {
      for (const listener of listeners) listener(patch);
    }
    return patch;
  }

  return {
    value() {
      return current;
    },
    onPatch(callback: PatchWatchCallback): PatchSubscription {
      if (typeof callback !== 'function') throw new TypeError('view patch callback must be a function');
      let active = true;
      listeners.add(callback);
      return {
        get active() {
          return active;
        },
        unsubscribe() {
          if (!active) return;
          active = false;
          listeners.delete(callback);
        }
      };
    },
    refresh: refreshFromSource,
    dispose() {
      if (disposed) return;
      disposed = true;
      sourceSubscription.unsubscribe();
      listeners.clear();
    }
  };
}

function createDeltaViewPlan(source: JsonValue | undefined, options: DeltaViewOptions): DeltaViewPlan {
  const path = normalizeWatchPath(options.path === undefined ? [] : options.path, 'view path');
  const wildcardIndex = path.indexOf(WILDCARD);
  const canRepair = wildcardIndex !== -1 && options.keyBy !== undefined;
  const canRepairExact = wildcardIndex === -1 && options.include === undefined && options.project === undefined;
  const plan: DeltaViewPlan = {
    canRepair,
    canRepairExact,
    basePath: canRepair ? path.slice(0, wildcardIndex) : canRepairExact ? path : [],
    tailPath: canRepair ? path.slice(wildcardIndex + 1) : [],
    keyBy: options.keyBy,
    rowToViewKey: new Map()
  };
  resetDeltaViewPlanIndex(plan, source, options);
  return plan;
}

function resetDeltaViewPlanIndex(plan: DeltaViewPlan, source: JsonValue | undefined, options: DeltaViewOptions): void {
  plan.rowToViewKey.clear();
  if (!plan.canRepair || source === undefined) return;
  const collection = getPath(source, plan.basePath);
  if (collection === null || typeof collection !== 'object') return;
  iterateCollection(collection, (item, key) => {
    const entry = readDeltaViewEntry(item, key, plan, options);
    if (entry.included && entry.viewKey !== undefined) {
      plan.rowToViewKey.set(makeDeltaViewRowKey(key), entry.viewKey);
    }
  });
}

function refreshDeltaViewIncremental(
  source: JsonValue | undefined,
  options: DeltaViewOptions,
  plan: DeltaViewPlan,
  current: JsonValue | undefined,
  sourcePatch: Patch,
  diffView: ViewDiffFunction
): { value: JsonValue | undefined; patch: Patch } | null {
  if (plan.canRepairExact) {
    return refreshExactDeltaViewIncremental(current, plan, sourcePatch);
  }

  if (!plan.canRepair || source === undefined || current === undefined || current === null || typeof current !== 'object' || Array.isArray(current)) {
    return null;
  }

  const touchedRows = new Map<string, ObjectKey>();
  if (!collectDeltaViewTouchedRows(sourcePatch, plan, touchedRows)) return null;
  if (touchedRows.size === 0) {
    return { value: current, patch: [] };
  }

  const collection = getPath(source, plan.basePath);
  if (collection === null || typeof collection !== 'object') return null;

  const nextView = current as Record<string, JsonValue>;
  const outPatch: Patch = [];
  for (const [rowKeyId, rowKey] of touchedRows) {
    const oldViewKey = plan.rowToViewKey.get(rowKeyId);
    const row = readCollectionValue(collection, rowKey);
    const entry = row === undefined
      ? { included: false } as DeltaViewEntry
      : readDeltaViewEntry(row, rowKey, plan, options);

    if (!entry.included || entry.viewKey === undefined || entry.value === undefined) {
      if (oldViewKey !== undefined) {
        delete nextView[oldViewKey];
        plan.rowToViewKey.delete(rowKeyId);
        outPatch[outPatch.length] = [OP_REMOVE, [oldViewKey]];
      }
      continue;
    }

    const newViewKey = entry.viewKey;

    if (oldViewKey !== undefined && oldViewKey !== newViewKey) {
      delete nextView[oldViewKey];
      outPatch[outPatch.length] = [OP_REMOVE, [oldViewKey]];
    }

    const oldValue = oldViewKey === undefined || oldViewKey !== newViewKey
      ? undefined
      : (current as any)[newViewKey] as JsonValue | undefined;
    nextView[newViewKey] = entry.value;
    plan.rowToViewKey.set(rowKeyId, newViewKey);

    if (oldValue === undefined || oldViewKey !== newViewKey) {
      outPatch[outPatch.length] = [OP_SET, [newViewKey], entry.value];
    } else {
      if (diffView !== diff || !appendDeltaViewEntryPatchFast(outPatch, newViewKey, oldValue, entry.value)) {
        appendPrefixedPatch(outPatch, newViewKey, diffView(oldValue, entry.value));
      }
    }
  }

  return {
    value: current,
    patch: outPatch
  };
}

function refreshExactDeltaViewIncremental(
  current: JsonValue | undefined,
  plan: DeltaViewPlan,
  sourcePatch: Patch
): { value: JsonValue | undefined; patch: Patch } | null {
  if (current === undefined) return null;

  const patch: Patch = [];
  for (let i = 0, length = sourcePatch.length; i < length; i++) {
    const relative = readExactDeltaViewPatchOperation(sourcePatch[i], plan.basePath);
    if (relative === null) return null;
    if (relative !== SKIP_DELTA_VIEW_PATCH) patch[patch.length] = relative;
  }

  if (patch.length === 0) return { value: current, patch };
  return { value: applyPatch(current, patch, { cloneValues: true }), patch };
}

function readExactDeltaViewPatchOperation(op: PatchOperation, basePath: JsonPath): PatchOperation | typeof SKIP_DELTA_VIEW_PATCH | null {
  const path = op[1];
  if (isPathPrefix(basePath, path)) {
    if (op[0] === OP_REMOVE && path.length === basePath.length) return null;
    const relative = cloneJson(op) as PatchOperation;
    relative[1] = path.slice(basePath.length);
    return relative;
  }
  return isPathPrefix(path, basePath) ? null : SKIP_DELTA_VIEW_PATCH;
}

function readDeltaViewEntry(
  row: JsonValue,
  rowKey: ObjectKey,
  plan: DeltaViewPlan,
  options: DeltaViewOptions
): DeltaViewEntry {
  const value = plan.tailPath.length === 0 ? row : getPath(row, plan.tailPath);
  if (value === undefined) return { included: false };
  if (options.include && !options.include(value, rowKey)) return { included: false };
  const viewKey = readViewKey(plan.keyBy as any, value, rowKey);
  if (viewKey === null || viewKey === undefined) return { included: false };
  return {
    included: true,
    viewKey: String(viewKey),
    value: options.project ? options.project(value, rowKey) : cloneJson(value)
  };
}

function collectDeltaViewTouchedRows(sourcePatch: Patch, plan: DeltaViewPlan, touchedRows: Map<string, ObjectKey>): boolean {
  for (let i = 0, length = sourcePatch.length; i < length; i++) {
    const op = sourcePatch[i];
    switch (op[0]) {
      case OP_ARRAY_OBJECT_FIELD_ASSIGN:
        if (samePathSnapshot(plan.basePath, op[1])) {
          addDeltaViewRowIndexes(touchedRows, op[2]);
        } else if (pathOverlaps(plan.basePath, op[1])) {
          return false;
        }
        break;
      case OP_ARRAY_OBJECT_ASSIGN:
      case OP_ARRAY_TUPLE_ASSIGN:
        if (samePathSnapshot(plan.basePath, op[1])) {
          addDeltaViewRowIndexes(touchedRows, op[2]);
        } else if (pathOverlaps(plan.basePath, op[1])) {
          return false;
        }
        break;
      case OP_ARRAY_ASSIGN:
        if (samePathSnapshot(plan.basePath, op[1])) {
          addDeltaViewRowIndexes(touchedRows, op[2]);
        } else if (!collectDeltaViewRowFromPath(op[1], plan, touchedRows)) {
          return false;
        }
        break;
      case OP_TRUNCATE:
      case OP_APPEND:
      case OP_ARRAY_SPLICE:
      case OP_ARRAY_TWO_FIELD_INSERT:
      case OP_ARRAY_MOVE:
        if (samePathSnapshot(plan.basePath, op[1]) || isPathPrefix(op[1], plan.basePath)) {
          return false;
        }
        if (!collectDeltaViewRowFromPath(op[1], plan, touchedRows)) return false;
        break;
      default:
        if (!collectDeltaViewRowFromPath(op[1], plan, touchedRows)) return false;
        break;
    }
  }
  return true;
}

function addDeltaViewRowIndexes(touchedRows: Map<string, ObjectKey>, rowIndexes: number[]): void {
  for (let i = 0, length = rowIndexes.length; i < length; i++) {
    const rowKey = rowIndexes[i];
    touchedRows.set(makeDeltaViewRowKey(rowKey), rowKey);
  }
}

function collectDeltaViewRowFromPath(path: JsonPath, plan: DeltaViewPlan, touchedRows: Map<string, ObjectKey>): boolean {
  const basePath = plan.basePath;
  if (path.length <= basePath.length) {
    return !isPathPrefix(path, basePath);
  }
  if (!isPathPrefix(basePath, path)) return true;
  const rowKey = path[basePath.length];
  touchedRows.set(makeDeltaViewRowKey(rowKey), rowKey);
  return true;
}

function appendPrefixedPatch(out: Patch, segment: string, patch: Patch): void {
  for (let i = 0, length = patch.length; i < length; i++) {
    const op = patch[i] as any;
    op[1] = [segment].concat(op[1]);
    out[out.length] = op;
  }
}

function appendDeltaViewEntryPatchFast(out: Patch, viewKey: string, source: JsonValue, target: JsonValue): boolean {
  if (source === target) return true;
  if (
    source === null ||
    target === null ||
    typeof source !== 'object' ||
    typeof target !== 'object' ||
    Array.isArray(source) ||
    Array.isArray(target)
  ) {
    return false;
  }

  const sourceObject = source as Record<string, JsonValue>;
  const targetObject = target as Record<string, JsonValue>;
  const keys = Object.keys(targetObject);
  if (keys.length === 0 || keys.length > 8 || Object.keys(sourceObject).length !== keys.length) return false;

  let changedKey: string | null = null;
  let changedValue: JsonValue | null = null;
  let changedCount = 0;
  let assign: Record<string, JsonValue> | null = null;
  for (let i = 0, length = keys.length; i < length; i++) {
    const key = keys[i];
    if (key === '__proto__') return false;
    if (!hasOwn.call(sourceObject, key)) return false;
    const sourceValue = sourceObject[key];
    const targetValue = targetObject[key];
    if (sourceValue === targetValue) continue;
    if (!isDeltaViewScalar(sourceValue) || !isDeltaViewScalar(targetValue)) return false;
    if (changedCount === 1) {
      assign = {};
      assign[changedKey as string] = changedValue as JsonValue;
    }
    changedKey = key;
    changedValue = targetValue;
    if (assign !== null) assign[key] = targetValue;
    changedCount++;
  }

  if (changedCount === 0) return true;
  if (changedCount === 1) {
    out[out.length] = [OP_SET, [viewKey, changedKey as string], changedValue as JsonValue];
  } else {
    out[out.length] = [OP_ASSIGN, [viewKey], assign as Record<string, JsonValue>];
  }
  return true;
}

function isDeltaViewScalar(value: JsonValue): boolean {
  return value === null || typeof value !== 'object';
}

function readCollectionValue(collection: JsonValue, key: ObjectKey): JsonValue | undefined {
  if (Array.isArray(collection)) return collection[key as number];
  if (collection !== null && typeof collection === 'object') return (collection as any)[key];
  return undefined;
}

function makeDeltaViewRowKey(key: ObjectKey): string {
  return typeof key + ':' + String(key);
}

function parseWatchCall(call: WatchCall): { path: JsonPath; fields?: JsonPath[]; range: NormalizedWatchRange | null; callback: PatchWatchCallback } {
  let path: WatchPath | undefined;
  let fields: WatchPath[] | undefined;
  let range: WatchRange | undefined;
  let callback: PatchWatchCallback | undefined;

  if (typeof call.path === 'object' && !Array.isArray(call.path)) {
    path = call.path.path;
    fields = call.path.fields;
    range = call.path.range;
    callback = call.fieldsOrCallback as PatchWatchCallback;
  } else {
    path = call.path as WatchPath;
    if (typeof call.fieldsOrCallback === 'function') {
      callback = call.fieldsOrCallback;
    } else {
      fields = call.fieldsOrCallback;
      callback = call.callback;
    }
  }

  if (typeof callback !== 'function') throw new TypeError('watch callback must be a function');
  return {
    path: normalizeWatchPath(path === undefined ? [] : path, 'watch path'),
    fields: normalizeFields(fields),
    range: normalizeWatchRange(range),
    callback
  };
}

function normalizeWatchRange(range: WatchRange | undefined): NormalizedWatchRange | null {
  if (range === undefined || range === null) return null;
  if (typeof range !== 'object') throw new TypeError('watch range must be an object');

  const rowStart = normalizeRangeBound(
    readFirstDefined(range.start, range.rowStart, range.startRow),
    0,
    'watch range row start'
  );
  const rowEnd = normalizeRangeBound(
    readFirstDefined(range.end, range.rowEnd, range.endRow),
    Number.MAX_SAFE_INTEGER,
    'watch range row end'
  );
  const columnStartValue = readFirstDefined(range.columnStart, range.startColumn);
  const columnEndValue = readFirstDefined(range.columnEnd, range.endColumn);
  const hasColumn = columnStartValue !== undefined || columnEndValue !== undefined;
  const columnStart = normalizeRangeBound(columnStartValue, 0, 'watch range column start');
  const columnEnd = normalizeRangeBound(columnEndValue, Number.MAX_SAFE_INTEGER, 'watch range column end');

  if (rowStart > rowEnd) throw new RangeError('watch range row start must be <= row end');
  if (columnStart > columnEnd) throw new RangeError('watch range column start must be <= column end');
  return { rowStart, rowEnd, columnStart, columnEnd, hasColumn };
}

function readFirstDefined(...values: Array<number | undefined>): number | undefined {
  for (let i = 0, length = values.length; i < length; i++) {
    if (values[i] !== undefined) return values[i];
  }
  return undefined;
}

function normalizeRangeBound(value: number | undefined, fallback: number, label: string): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) {
    throw new RangeError(label + ' must be a non-negative safe integer');
  }
  return value;
}

function normalizeFields(fields: WatchPath[] | undefined): JsonPath[] | undefined {
  if (fields === undefined || fields === null) return undefined;
  if (!Array.isArray(fields)) throw new TypeError('watch fields must be an array');
  const out: JsonPath[] = [];
  for (let i = 0, length = fields.length; i < length; i++) {
    out[out.length] = normalizeWatchPath(fields[i], 'watch field');
  }
  return out;
}

function normalizeWatchPath(path: WatchPath, label: string): JsonPath {
  if (Array.isArray(path)) return path.slice();
  if (typeof path !== 'string') throw new TypeError(label + ' must be a path array or string');
  if (path === '') return [];
  if (path.charCodeAt(0) === 47) return normalizePointerPath(parsePointer(path));
  return parseRelativePath(path);
}

function normalizePointerPath(path: JsonPath): JsonPath {
  const out: JsonPath = [];
  for (let i = 0, length = path.length; i < length; i++) {
    out[out.length] = typeof path[i] === 'string' ? readSimplePathSegment(path[i] as string) : path[i];
  }
  return out;
}

function parseRelativePath(path: string): JsonPath {
  if (path === '') return [];
  const parts = path.split('/');
  const out: JsonPath = [];
  for (let i = 0, length = parts.length; i < length; i++) {
    out[out.length] = readSimplePathSegment(parts[i]);
  }
  return out;
}

function readSimplePathSegment(segment: string): string | number {
  if (segment === WILDCARD || segment === '') return segment;
  let code = segment.charCodeAt(0);
  if (code === 48) return segment.length === 1 ? 0 : segment;
  if (code < 49 || code > 57) return segment;
  let value = code - 48;
  for (let i = 1, length = segment.length; i < length; i++) {
    code = segment.charCodeAt(i) - 48;
    if (code < 0 || code > 9) return segment;
    value = value * 10 + code;
  }
  return Number.isSafeInteger(value) ? value : segment;
}

function expandWatchPaths(path: JsonPath, fields: JsonPath[] | undefined): JsonPath[] {
  if (fields === undefined || fields.length === 0) return [path];
  const out: JsonPath[] = [];
  for (let i = 0, length = fields.length; i < length; i++) {
    out[out.length] = path.concat(fields[i]);
  }
  return out;
}

function hasWildcardSegment(path: JsonPath): boolean {
  for (let i = 0, length = path.length; i < length; i++) {
    if (path[i] === WILDCARD) return true;
  }
  return false;
}

function isSingletonRowFieldWildcardPath(path: JsonPath): boolean {
  return path.length === 4 &&
    path[1] === WILDCARD &&
    path[0] !== WILDCARD &&
    path[2] !== WILDCARD &&
    path[3] !== WILDCARD;
}

function createRouteNode(): RouteNode {
  return {
    watchers: [],
    children: new Map(),
    wildcard: null
  };
}

function createRouteIndexes(): RouteIndexes {
  return {
    exactByKey: new Map(),
    rowFieldExactByShape: new Map(),
    rowFieldWildcardByShape: new Map(),
    rangeByBase: new Map(),
    rangeWatchers: [],
    operationRouteCache: new WeakMap(),
    lastOperation: null,
    lastOperationRouteCache: null,
    maxIndexedDepth: 0,
    maxRowFieldSuffixByBase: new Map(),
    genericOnlyPathCount: 0,
    wildcardPathCount: 0,
    version: 1
  };
}

function clearRouteIndexes(indexes: RouteIndexes): void {
  indexes.exactByKey.clear();
  indexes.rowFieldExactByShape.clear();
  indexes.rowFieldWildcardByShape.clear();
  indexes.rangeByBase.clear();
  indexes.rangeWatchers.length = 0;
  indexes.maxRowFieldSuffixByBase.clear();
  indexes.lastOperation = null;
  indexes.lastOperationRouteCache = null;
  indexes.maxIndexedDepth = 0;
  indexes.genericOnlyPathCount = 0;
  indexes.wildcardPathCount = 0;
}

function insertWatchPath(root: RouteNode, path: JsonPath, entry: WatchEntry): void {
  let node = root;
  for (let i = 0, length = path.length; i < length; i++) {
    const segment = path[i];
    if (segment === WILDCARD) {
      if (node.wildcard === null) node.wildcard = createRouteNode();
      node = node.wildcard;
    } else {
      let child = node.children.get(segment);
      if (child === undefined) {
        child = createRouteNode();
        node.children.set(segment, child);
      }
      node = child;
    }
  }
  node.watchers[node.watchers.length] = entry;
  entry.nodes[entry.nodes.length] = node;
}

function removeWatcher(node: RouteNode, entry: WatchEntry): void {
  const index = node.watchers.indexOf(entry);
  if (index !== -1) node.watchers.splice(index, 1);
}

function removeIndexWatcher(bucket: WatchEntry[], entry: WatchEntry): void {
  const index = bucket.indexOf(entry);
  if (index !== -1) bucket.splice(index, 1);
}

function indexWatchPath(indexes: RouteIndexes, path: JsonPath, entry: WatchEntry): void {
  let wildcardIndex = -1;
  for (let i = 0, length = path.length; i < length; i++) {
    if (path[i] === WILDCARD) {
      entry.wildcardPaths++;
      indexes.wildcardPathCount++;
      if (wildcardIndex !== -1) {
        entry.genericOnlyPaths++;
        indexes.genericOnlyPathCount++;
        return;
      }
      wildcardIndex = i;
    }
  }

  if (path.length > indexes.maxIndexedDepth) indexes.maxIndexedDepth = path.length;
  if (wildcardIndex === -1) {
    const exactBucket = readIndexBucket(indexes.exactByKey, makePathKey(path));
    exactBucket[exactBucket.length] = entry;
    entry.indexBuckets[entry.indexBuckets.length] = exactBucket;
    for (let i = 0, length = path.length; i < length; i++) {
      if (typeof path[i] !== 'number') continue;
      const shapeKey = makeShapeKey(path, i, path, i + 1, path.length);
      rememberMaxRowFieldSuffixDepth(indexes, makePathKeyPrefix(path, i), path.length - i - 1);
      const rowMap = readRowFieldExactMap(indexes, shapeKey);
      const rowBucket = readIndexBucket(rowMap, path[i]);
      rowBucket[rowBucket.length] = entry;
      entry.indexBuckets[entry.indexBuckets.length] = rowBucket;
    }
    return;
  }

  const shapeKey = makeShapeKey(path, wildcardIndex, path, wildcardIndex + 1, path.length);
  rememberMaxRowFieldSuffixDepth(indexes, makePathKeyPrefix(path, wildcardIndex), path.length - wildcardIndex - 1);
  const wildcardBucket = readIndexBucket(indexes.rowFieldWildcardByShape, shapeKey);
  wildcardBucket[wildcardBucket.length] = entry;
  entry.indexBuckets[entry.indexBuckets.length] = wildcardBucket;
}

function indexRangeWatchPath(indexes: RouteIndexes, path: JsonPath, entry: WatchEntry, range: NormalizedWatchRange): void {
  let firstWildcard = -1;
  let wildcardCount = 0;
  for (let i = 0, length = path.length; i < length; i++) {
    if (path[i] !== WILDCARD) continue;
    if (firstWildcard === -1) firstWildcard = i;
    wildcardCount++;
  }
  if (firstWildcard === -1) throw new TypeError('watch range requires a path with at least one * segment');
  if (wildcardCount > 2) throw new TypeError('watch range supports at most two * segments');

  const basePath = path.slice(0, firstWildcard);
  const fieldPath = path.slice(firstWildcard + 1);
  if (range.hasColumn && fieldPath.indexOf(WILDCARD) === -1) {
    throw new TypeError('watch range column bounds require a second * segment');
  }
  const baseKey = makePathKey(basePath);
  entry.rangeBasePath = entry.rangeBasePath === null ? basePath : entry.rangeBasePath;
  entry.rangeFieldPath = entry.rangeFieldPath === null ? fieldPath : entry.rangeFieldPath;
  entry.rangeSelectors[entry.rangeSelectors.length] = { basePath, baseKey, fieldPath };

  const bucket = readIndexBucket(indexes.rangeByBase, baseKey);
  if (bucket.indexOf(entry) === -1) {
    bucket[bucket.length] = entry;
    entry.indexBuckets[entry.indexBuckets.length] = bucket;
  }
  if (indexes.rangeWatchers.indexOf(entry) === -1) {
    indexes.rangeWatchers[indexes.rangeWatchers.length] = entry;
    entry.indexBuckets[entry.indexBuckets.length] = indexes.rangeWatchers;
  }
  entry.range = range;
}

function dispatchCachedOperationRoute(indexes: RouteIndexes, op: PatchOperation, patch: Patch): number {
  const cached = readValidCachedOperationRoute(indexes, op);
  return cached === null ? -1 : dispatchCachedWatchers(cached.watchers, patch);
}

function readValidCachedOperationRoute(indexes: RouteIndexes, op: PatchOperation): OperationRouteCache | null {
  let cached = indexes.lastOperation === op ? indexes.lastOperationRouteCache : null;
  if (cached === null) {
    const mapped = indexes.operationRouteCache.get(op);
    if (mapped === undefined) return null;
    indexes.lastOperation = op;
    indexes.lastOperationRouteCache = mapped;
    cached = mapped;
  }
  if (cached !== undefined && cached.singleNestedField === true) {
    return isSingleNestedFieldCachedOperationRoute(indexes, cached, op) ? cached : null;
  }
  if (
    cached.version !== indexes.version ||
    cached.code !== op[0] ||
    cached.path !== op[1] ||
    cached.pathSnapshot === undefined ||
    !samePathSnapshot(cached.pathSnapshot, op[1])
  ) {
    return null;
  }
  if (op[0] === OP_ARRAY_OBJECT_FIELD_ASSIGN) {
    if (
      cached.rowIndexes !== op[2] ||
      cached.fields !== op[3] ||
      cached.fieldSnapshots === undefined ||
      (cached.rowIndexSensitive === true && (
        cached.rowIndexSnapshot === undefined ||
        !sameNumberSnapshot(cached.rowIndexSnapshot, op[2])
      )) ||
      !sameFieldSnapshots(cached.fieldSnapshots, op[3])
    ) {
      return null;
    }
  }
  return cached;
}

function isSingleNestedFieldCachedOperationRoute(
  indexes: RouteIndexes,
  cached: OperationRouteCache,
  op: PatchOperation
): boolean {
  if (
    cached.version !== indexes.version ||
    op[0] !== OP_ARRAY_OBJECT_FIELD_ASSIGN ||
    cached.path !== op[1] ||
    cached.fields !== op[3]
  ) {
    return false;
  }

  const base = op[1];
  const fields = op[3];
  if (
    base.length !== 1 ||
    base[0] !== cached.base0 ||
    fields.length !== 1
  ) {
    return false;
  }

  const field = fields[0];
  if (
    field.length !== 2 ||
    field[0] !== cached.field0 ||
    field[1] !== cached.field1
  ) {
    return false;
  }

  if (
    cached.rowIndexSensitive === true &&
    (
      cached.rowIndexes !== op[2] ||
      cached.rowIndexSnapshot === undefined ||
      !sameNumberSnapshot(cached.rowIndexSnapshot, op[2])
    )
  ) {
    return false;
  }

  return true;
}

function writeCachedOperationRoute(indexes: RouteIndexes, op: PatchOperation, seen: WatchEntry[]): void {
  if (!isCacheableRouteOperation(op)) return;
  const cached: OperationRouteCache = {
    version: indexes.version,
    code: op[0],
    watchers: seen.slice(),
    path: op[1],
    pathSnapshot: op[1].slice()
  };
  if (op[0] === OP_ARRAY_OBJECT_FIELD_ASSIGN) {
    cached.rowIndexes = op[2];
    cached.rowIndexSensitive = isRowIndexSensitiveArrayObjectFieldAssign(indexes, op[1], op[3]);
    if (cached.rowIndexSensitive) cached.rowIndexSnapshot = op[2].slice();
    cached.fields = op[3];
    cached.fieldSnapshots = copyFieldSnapshots(op[3]);
    if (op[1].length === 1 && op[3].length === 1 && op[3][0].length === 2) {
      cached.singleNestedField = true;
      cached.base0 = op[1][0];
      cached.field0 = op[3][0][0];
      cached.field1 = op[3][0][1];
    }
  }
  indexes.operationRouteCache.set(op, cached);
  indexes.lastOperation = op;
  indexes.lastOperationRouteCache = cached;
}

function dispatchCachedWatchers(watchers: WatchEntry[], patch: Patch): number {
  const length = watchers.length;
  if (length === 1) {
    watchers[0].callback(patch);
    return 1;
  }
  let count = 0;
  for (let i = 0; i < length; i++) {
    const entry = watchers[i];
    if (entry.active) {
      entry.callback(patch);
      count++;
    }
  }
  return count;
}

function isRowIndexSensitiveArrayObjectFieldAssign(indexes: RouteIndexes, base: JsonPath, fields: JsonPath[]): boolean {
  const rangeBucket = indexes.rangeByBase.get(makePathKey(base));
  if (rangeBucket !== undefined && rangeBucket.length !== 0) return true;
  for (let fieldIndex = 0, fieldCount = fields.length; fieldIndex < fieldCount; fieldIndex++) {
    const field = fields[fieldIndex];
    for (let prefixLength = 0, prefixCount = field.length; prefixLength <= prefixCount; prefixLength++) {
      const rowMap = indexes.rowFieldExactByShape.get(makeShapeKey(base, base.length, field, 0, prefixLength));
      if (rowMap === undefined) continue;
      for (const bucket of rowMap.values()) {
        if (bucket.length !== 0) return true;
      }
    }
  }
  return false;
}

function samePathSnapshot(snapshot: JsonPath, path: JsonPath): boolean {
  if (snapshot.length !== path.length) return false;
  for (let i = 0, length = snapshot.length; i < length; i++) {
    if (snapshot[i] !== path[i]) return false;
  }
  return true;
}

function sameNumberSnapshot(snapshot: number[], values: number[]): boolean {
  const length = snapshot.length;
  if (length !== values.length) return false;
  switch (length) {
    case 0:
      return true;
    case 1:
      return snapshot[0] === values[0];
    case 2:
      return snapshot[0] === values[0] &&
        snapshot[1] === values[1];
    case 4:
      return snapshot[0] === values[0] &&
        snapshot[1] === values[1] &&
        snapshot[2] === values[2] &&
        snapshot[3] === values[3];
    case 8:
      return snapshot[0] === values[0] &&
        snapshot[1] === values[1] &&
        snapshot[2] === values[2] &&
        snapshot[3] === values[3] &&
        snapshot[4] === values[4] &&
        snapshot[5] === values[5] &&
        snapshot[6] === values[6] &&
        snapshot[7] === values[7];
    case 16:
      return snapshot[0] === values[0] &&
        snapshot[1] === values[1] &&
        snapshot[2] === values[2] &&
        snapshot[3] === values[3] &&
        snapshot[4] === values[4] &&
        snapshot[5] === values[5] &&
        snapshot[6] === values[6] &&
        snapshot[7] === values[7] &&
        snapshot[8] === values[8] &&
        snapshot[9] === values[9] &&
        snapshot[10] === values[10] &&
        snapshot[11] === values[11] &&
        snapshot[12] === values[12] &&
        snapshot[13] === values[13] &&
        snapshot[14] === values[14] &&
        snapshot[15] === values[15];
  }
  for (let i = 0; i < length; i++) {
    if (snapshot[i] !== values[i]) return false;
  }
  return true;
}

function sameFieldSnapshots(snapshots: JsonPath[], fields: JsonPath[]): boolean {
  if (snapshots.length !== fields.length) return false;
  for (let i = 0, length = snapshots.length; i < length; i++) {
    if (!samePathSnapshot(snapshots[i], fields[i])) return false;
  }
  return true;
}

function copyFieldSnapshots(fields: JsonPath[]): JsonPath[] {
  const out: JsonPath[] = [];
  for (let i = 0, length = fields.length; i < length; i++) {
    out[out.length] = fields[i].slice();
  }
  return out;
}

function isCacheableRouteOperation(op: PatchOperation): boolean {
  return op[0] === OP_ARRAY_OBJECT_FIELD_ASSIGN;
}

function routeSingletonExact(entry: WatchEntry, watchPath: JsonPath, op: PatchOperation, patch: Patch): number {
  switch (op[0]) {
    case OP_SET:
    case OP_SCALAR_ARRAY_REPLACE:
    case OP_REMOVE:
      {
        const opPath = op[1];
        const length = watchPath.length;
        if (length === opPath.length) {
          if (
            length === 4
              ? watchPath[0] === opPath[0] &&
                watchPath[1] === opPath[1] &&
                watchPath[2] === opPath[2] &&
                watchPath[3] === opPath[3]
              : isPathPrefix(watchPath, opPath)
          ) {
            return 1;
          }
          return 0;
        }
        if (pathOverlaps(watchPath, opPath)) {
          return 1;
        }
      }
      return 0;
    case OP_TRUNCATE:
    case OP_APPEND:
    case OP_ARRAY_SPLICE:
    case OP_ARRAY_TWO_FIELD_INSERT:
    case OP_ARRAY_MOVE:
      if (pathOverlaps(watchPath, op[1])) {
        return 1;
      }
      return 0;
    case OP_STRING_SPLICE:
    case OP_STRING_COPY:
      if (isPathPrefix(watchPath, op[1])) {
        return 1;
      }
      return 0;
    default:
      return -1;
  }
}

function routeSingletonRowField(
  entry: WatchEntry,
  base0: string | number | null,
  field0: string | number | null,
  field1: string | number | null,
  op: PatchOperation,
  patch: Patch
): number {
  if (op[0] !== OP_ARRAY_OBJECT_FIELD_ASSIGN) return -1;
  const base = op[1];
  if (base.length !== 1 || base[0] !== base0) return 0;
  const fields = op[3];
  if (fields.length !== 1) return -1;
  const field = fields[0];
  if (field.length !== 2) return -1;
  if (field[0] === field0 && field[1] === field1) {
    return 1;
  }
  return 0;
}

function pathOverlaps(left: JsonPath, right: JsonPath): boolean {
  const leftLength = left.length;
  const rightLength = right.length;
  const length = leftLength < rightLength ? leftLength : rightLength;
  if (length === 4) {
    return left[0] === right[0] &&
      left[1] === right[1] &&
      left[2] === right[2] &&
      left[3] === right[3];
  }
  for (let i = 0; i < length; i++) {
    if (left[i] !== right[i]) return false;
  }
  return true;
}

function isPathPrefix(prefix: JsonPath, path: JsonPath): boolean {
  if (prefix.length > path.length) return false;
  for (let i = 0, length = prefix.length; i < length; i++) {
    if (prefix[i] !== path[i]) return false;
  }
  return true;
}

function routePlainOperation(root: RouteNode, indexes: RouteIndexes, op: PatchOperation, seen: WatchEntry[], mark: number): boolean {
  if (indexes.wildcardPathCount !== 0) return false;
  switch (op[0]) {
    case OP_SET:
    case OP_SCALAR_ARRAY_REPLACE:
    case OP_REMOVE:
    case OP_TRUNCATE:
    case OP_APPEND:
    case OP_ARRAY_SPLICE:
    case OP_ARRAY_TWO_FIELD_INSERT:
    case OP_ARRAY_MOVE:
      collectPlainPath(root, op[1], op[1].length < indexes.maxIndexedDepth, seen, mark);
      collectRangeOperation(indexes, op, seen, mark);
      return true;
    case OP_STRING_SPLICE:
    case OP_STRING_COPY:
      collectPlainPath(root, op[1], false, seen, mark);
      collectRangeOperation(indexes, op, seen, mark);
      return true;
    default:
      return false;
  }
}

function routeIndexedOperation(indexes: RouteIndexes, op: PatchOperation, seen: WatchEntry[], mark: number): boolean {
  collectRangeOperation(indexes, op, seen, mark);
  if (indexes.genericOnlyPathCount !== 0) return false;

  if (op[0] === OP_ARRAY_OBJECT_FIELD_ASSIGN) {
    if (!canUseIndexedArrayObjectFieldAssign(indexes, op[1], op[3])) return false;
    collectExactPathPrefixes(indexes, op[1], seen, mark);
    collectIndexedArrayObjectFieldAssign(indexes, op[1], op[2], op[3], seen, mark);
    return true;
  }
  return false;
}

function collectIndexedArrayObjectFieldAssign(
  routeIndexes: RouteIndexes,
  base: JsonPath,
  rowIndexes: number[],
  fields: JsonPath[],
  seen: WatchEntry[],
  mark: number
): void {
  for (let fieldIndex = 0, fieldCount = fields.length; fieldIndex < fieldCount; fieldIndex++) {
    const field = fields[fieldIndex];
    for (let prefixLength = 0, prefixCount = field.length; prefixLength <= prefixCount; prefixLength++) {
      const shapeKey = makeShapeKey(base, base.length, field, 0, prefixLength);
      addIndexBucket(routeIndexes.rowFieldWildcardByShape.get(shapeKey), seen, mark);
      const rowMap = routeIndexes.rowFieldExactByShape.get(shapeKey);
      if (rowMap === undefined) continue;
      for (let i = 0, length = rowIndexes.length; i < length; i++) {
        addIndexBucket(rowMap.get(rowIndexes[i]), seen, mark);
      }
    }
  }
}

function collectRangeOperation(indexes: RouteIndexes, op: PatchOperation, seen: WatchEntry[], mark: number): boolean {
  if (indexes.rangeWatchers.length === 0) return false;

  switch (op[0]) {
    case OP_ARRAY_OBJECT_FIELD_ASSIGN:
      return collectRangeArrayObjectFieldAssign(indexes, op[1], op[2], op[3], seen, mark);
    case OP_ARRAY_ASSIGN:
    case OP_ARRAY_OBJECT_ASSIGN:
      return collectRangeRowAssign(indexes, op[1], op[2], seen, mark);
    case OP_ARRAY_TUPLE_ASSIGN:
      return collectRangeTupleAssign(indexes, op[1], op[2], op[3], seen, mark);
    case OP_SET:
    case OP_SCALAR_ARRAY_REPLACE:
    case OP_REMOVE:
    case OP_ASSIGN:
    case OP_TRUNCATE:
    case OP_APPEND:
    case OP_ARRAY_SPLICE:
    case OP_ARRAY_TWO_FIELD_INSERT:
    case OP_ARRAY_MOVE:
    case OP_STRING_SPLICE:
    case OP_STRING_COPY:
      return collectRangePath(indexes, op[1], seen, mark);
    default:
      return collectRangePath(indexes, [], seen, mark);
  }
}

function collectRangeArrayObjectFieldAssign(
  indexes: RouteIndexes,
  base: JsonPath,
  rowIndexes: number[],
  fields: JsonPath[],
  seen: WatchEntry[],
  mark: number
): boolean {
  const bucket = indexes.rangeByBase.get(makePathKey(base));
  if (bucket === undefined || bucket.length === 0) return false;

  let matched = false;
  for (let i = 0, length = bucket.length; i < length; i++) {
    const entry = bucket[i];
    const range = entry.range;
    if (range === null || !entry.active || !rangeIntersectsRows(range, rowIndexes)) continue;
    if (!rangeEntryMatchesArrayObjectFields(entry, base, fields, range)) continue;
    addRangeEntry(entry, seen, mark);
    matched = true;
  }
  return matched;
}

function collectRangeRowAssign(
  indexes: RouteIndexes,
  base: JsonPath,
  rowIndexes: number[],
  seen: WatchEntry[],
  mark: number
): boolean {
  const bucket = indexes.rangeByBase.get(makePathKey(base));
  if (bucket === undefined || bucket.length === 0) return false;

  let matched = false;
  for (let i = 0, length = bucket.length; i < length; i++) {
    const entry = bucket[i];
    const range = entry.range;
    if (range === null || !entry.active || !rangeIntersectsRows(range, rowIndexes)) continue;
    addRangeEntry(entry, seen, mark);
    matched = true;
  }
  return matched;
}

function collectRangeTupleAssign(
  indexes: RouteIndexes,
  base: JsonPath,
  rowIndexes: number[],
  fieldIndexes: number[],
  seen: WatchEntry[],
  mark: number
): boolean {
  const bucket = indexes.rangeByBase.get(makePathKey(base));
  if (bucket === undefined || bucket.length === 0) return false;

  let matched = false;
  for (let i = 0, length = bucket.length; i < length; i++) {
    const entry = bucket[i];
    const range = entry.range;
    if (range === null || !entry.active || !rangeIntersectsRowColumnPairs(range, rowIndexes, fieldIndexes)) continue;
    addRangeEntry(entry, seen, mark);
    matched = true;
  }
  return matched;
}

function collectRangePath(indexes: RouteIndexes, path: JsonPath, seen: WatchEntry[], mark: number): boolean {
  let matched = false;
  const entries = indexes.rangeWatchers;
  for (let i = 0, length = entries.length; i < length; i++) {
    const entry = entries[i];
    const range = entry.range;
    if (range === null || !entry.active || !rangeEntryMatchesPath(entry, path, range)) continue;
    addRangeEntry(entry, seen, mark);
    matched = true;
  }
  return matched;
}

function rangeEntryMatchesArrayObjectFields(entry: WatchEntry, base: JsonPath, fields: JsonPath[], range: NormalizedWatchRange): boolean {
  const baseKey = makePathKey(base);
  for (let selectorIndex = 0, selectorCount = entry.rangeSelectors.length; selectorIndex < selectorCount; selectorIndex++) {
    const selector = entry.rangeSelectors[selectorIndex];
    if (selector.baseKey !== baseKey) continue;
    for (let fieldIndex = 0, fieldCount = fields.length; fieldIndex < fieldCount; fieldIndex++) {
      if (rangeFieldOverlaps(selector.fieldPath, fields[fieldIndex], range)) return true;
    }
  }
  return false;
}

function rangeEntryMatchesPath(entry: WatchEntry, path: JsonPath, range: NormalizedWatchRange): boolean {
  for (let selectorIndex = 0, selectorCount = entry.rangeSelectors.length; selectorIndex < selectorCount; selectorIndex++) {
    const selector = entry.rangeSelectors[selectorIndex];
    const base = selector.basePath;
    if (path.length <= base.length) {
      if (isPathPrefix(path, base)) return true;
      continue;
    }
    if (!isPathPrefix(base, path)) continue;

    const row = path[base.length];
    if (typeof row !== 'number' || row < range.rowStart || row > range.rowEnd) continue;
    if (rangeFieldOverlaps(selector.fieldPath, path.slice(base.length + 1), range)) return true;
  }
  return false;
}

function rangeIntersectsRows(range: NormalizedWatchRange, rowIndexes: number[]): boolean {
  const start = range.rowStart;
  const end = range.rowEnd;
  for (let i = 0, length = rowIndexes.length; i < length; i++) {
    const row = rowIndexes[i];
    if (row >= start && row <= end) return true;
  }
  return false;
}

function rangeIntersectsRowColumnPairs(range: NormalizedWatchRange, rowIndexes: number[], fieldIndexes: number[]): boolean {
  const rowStart = range.rowStart;
  const rowEnd = range.rowEnd;
  const columnStart = range.columnStart;
  const columnEnd = range.columnEnd;
  for (let i = 0, length = rowIndexes.length; i < length; i++) {
    const row = rowIndexes[i];
    if (row < rowStart || row > rowEnd) continue;
    if (!range.hasColumn) return true;
    const column = fieldIndexes[i];
    if (column >= columnStart && column <= columnEnd) return true;
  }
  return false;
}

function rangeFieldOverlaps(watchField: JsonPath, patchField: JsonPath, range: NormalizedWatchRange): boolean {
  const minLength = watchField.length < patchField.length ? watchField.length : patchField.length;
  for (let i = 0; i < minLength; i++) {
    const watchSegment = watchField[i];
    const patchSegment = patchField[i];
    if (watchSegment === WILDCARD) {
      if (!range.hasColumn) continue;
      if (typeof patchSegment !== 'number' || patchSegment < range.columnStart || patchSegment > range.columnEnd) {
        return false;
      }
    } else if (watchSegment !== patchSegment) {
      return false;
    }
  }
  return true;
}

function addRangeEntry(entry: WatchEntry, seen: WatchEntry[], mark: number): void {
  if (entry.routeMark !== mark) {
    entry.routeMark = mark;
    seen[seen.length] = entry;
  }
}

function collectIndexedPath(indexes: RouteIndexes, path: JsonPath, seen: WatchEntry[], mark: number): void {
  for (let i = 0, length = path.length; i < length; i++) {
    if (typeof path[i] !== 'number') continue;
    for (let suffixLength = i + 1; suffixLength <= length; suffixLength++) {
      const shapeKey = makeShapeKey(path, i, path, i + 1, suffixLength);
      addIndexBucket(indexes.rowFieldWildcardByShape.get(shapeKey), seen, mark);
      const rowMap = indexes.rowFieldExactByShape.get(shapeKey);
      if (rowMap !== undefined) addIndexBucket(rowMap.get(path[i]), seen, mark);
    }
  }
}

function collectExactPathPrefixes(indexes: RouteIndexes, path: JsonPath, seen: WatchEntry[], mark: number): void {
  let key = '';
  addIndexBucket(indexes.exactByKey.get(key), seen, mark);
  for (let i = 0, length = path.length; i < length; i++) {
    key = appendSegmentKey(key, path[i]);
    addIndexBucket(indexes.exactByKey.get(key), seen, mark);
  }
}

function canUseIndexedArrayObjectFieldAssign(indexes: RouteIndexes, base: JsonPath, fields: JsonPath[]): boolean {
  const maxSuffixDepth = indexes.maxRowFieldSuffixByBase.get(makePathKey(base));
  if (maxSuffixDepth === undefined) return true;
  let minFieldDepth = 2147483647;
  for (let i = 0, length = fields.length; i < length; i++) {
    if (fields[i].length < minFieldDepth) minFieldDepth = fields[i].length;
  }
  return maxSuffixDepth <= minFieldDepth;
}

function rememberMaxRowFieldSuffixDepth(indexes: RouteIndexes, baseKey: string, suffixDepth: number): void {
  const previous = indexes.maxRowFieldSuffixByBase.get(baseKey);
  if (previous === undefined || suffixDepth > previous) {
    indexes.maxRowFieldSuffixByBase.set(baseKey, suffixDepth);
  }
}

function makePathKeyPrefix(path: JsonPath, end: number): string {
  let key = '';
  for (let i = 0; i < end; i++) {
    key = appendSegmentKey(key, path[i]);
  }
  return key;
}

function addIndexBucket(bucket: WatchEntry[] | undefined, seen: WatchEntry[], mark: number): void {
  if (bucket === undefined) return;
  for (let i = 0, length = bucket.length; i < length; i++) {
    const entry = bucket[i];
    if (entry.active && entry.routeMark !== mark) {
      entry.routeMark = mark;
      seen[seen.length] = entry;
    }
  }
}

function readRowFieldExactMap(indexes: RouteIndexes, shapeKey: string): Map<string | number, WatchEntry[]> {
  let rowMap = indexes.rowFieldExactByShape.get(shapeKey);
  if (rowMap === undefined) {
    rowMap = new Map();
    indexes.rowFieldExactByShape.set(shapeKey, rowMap);
  }
  return rowMap;
}

function readIndexBucket<TKey>(map: Map<TKey, WatchEntry[]>, key: TKey): WatchEntry[] {
  let bucket = map.get(key);
  if (bucket === undefined) {
    bucket = [];
    map.set(key, bucket);
  }
  return bucket;
}

function makePathKey(path: JsonPath): string {
  let key = '';
  for (let i = 0, length = path.length; i < length; i++) {
    key = appendSegmentKey(key, path[i]);
  }
  return key;
}

function makeShapeKey(
  baseSource: JsonPath,
  baseEnd: number,
  suffixSource: JsonPath,
  suffixStart: number,
  suffixEnd: number,
  skipBaseIndex = -1
): string {
  let key = '';
  for (let i = 0; i < baseEnd; i++) {
    if (i !== skipBaseIndex) key = appendSegmentKey(key, baseSource[i]);
  }
  key += '|';
  for (let i = suffixStart; i < suffixEnd; i++) {
    key = appendSegmentKey(key, suffixSource[i]);
  }
  return key;
}

function appendSegmentKey(key: string, segment: string | number): string {
  return typeof segment === 'number'
    ? key + '#' + segment + ';'
    : key + '$' + segment.length + ':' + segment;
}

function routeOperation(root: RouteNode, op: PatchOperation, seen: WatchEntry[], mark: number): void {
  switch (op[0]) {
    case OP_SET:
    case OP_SCALAR_ARRAY_REPLACE:
    case OP_REMOVE:
      collectPath(root, op[1], true, seen, mark);
      return;
    case OP_ASSIGN:
      collectAssignment(root, op[1], op[2], seen, mark);
      return;
    case OP_ARRAY_ASSIGN:
      collectArrayAssign(root, op[1], op[2], seen, mark);
      return;
    case OP_ARRAY_OBJECT_ASSIGN:
      collectArrayObjectAssign(root, op[1], op[2], op[3], seen, mark);
      return;
    case OP_ARRAY_TUPLE_ASSIGN:
      collectArrayTupleAssign(root, op[1], op[2], op[3], seen, mark);
      return;
    case OP_ARRAY_OBJECT_FIELD_ASSIGN:
      collectArrayObjectFieldAssign(root, op[1], op[2], op[3], seen, mark);
      return;
    case OP_TRUNCATE:
    case OP_APPEND:
    case OP_ARRAY_SPLICE:
    case OP_ARRAY_TWO_FIELD_INSERT:
    case OP_ARRAY_MOVE:
      collectPath(root, op[1], true, seen, mark);
      return;
    case OP_STRING_SPLICE:
    case OP_STRING_COPY:
      collectPath(root, op[1], false, seen, mark);
      return;
    default:
      collectPath(root, [], true, seen, mark);
  }
}

function collectAssignment(root: RouteNode, path: JsonPath, assign: JsonValue, seen: WatchEntry[], mark: number): void {
  collectPath(root, path, false, seen, mark);
  if (assign === null || typeof assign !== 'object' || Array.isArray(assign)) {
    collectPath(root, path, true, seen, mark);
    return;
  }

  for (const key in assign) {
    if (!hasOwn.call(assign, key)) continue;
    collectVirtualPath(root, path, key, null, true, seen, mark);
  }
}

function collectArrayAssign(root: RouteNode, path: JsonPath, indexes: number[], seen: WatchEntry[], mark: number): void {
  collectPath(root, path, false, seen, mark);
  for (let i = 0, length = indexes.length; i < length; i++) {
    collectVirtualPath(root, path, indexes[i], null, true, seen, mark);
  }
}

function collectArrayObjectAssign(
  root: RouteNode,
  path: JsonPath,
  indexes: number[],
  assigns: JsonValue[],
  seen: WatchEntry[],
  mark: number
): void {
  collectPath(root, path, false, seen, mark);
  for (let i = 0, length = indexes.length; i < length; i++) {
    collectVirtualAssignment(root, path, indexes[i], assigns[i], seen, mark);
  }
}

function collectArrayTupleAssign(
  root: RouteNode,
  path: JsonPath,
  indexes: number[],
  fieldIndexes: number[],
  seen: WatchEntry[],
  mark: number
): void {
  collectPath(root, path, false, seen, mark);
  for (let i = 0, length = indexes.length; i < length; i++) {
    collectVirtualPath(root, path, indexes[i], [fieldIndexes[i]], true, seen, mark);
  }
}

function collectArrayObjectFieldAssign(
  root: RouteNode,
  path: JsonPath,
  indexes: number[],
  fields: JsonPath[],
  seen: WatchEntry[],
  mark: number
): void {
  collectPath(root, path, false, seen, mark);
  for (let i = 0, indexLength = indexes.length; i < indexLength; i++) {
    for (let j = 0, fieldLength = fields.length; j < fieldLength; j++) {
      collectVirtualPath(root, path, indexes[i], fields[j], true, seen, mark);
    }
  }
}

function collectPath(root: RouteNode, path: JsonPath, includeDescendants: boolean, seen: WatchEntry[], mark: number): void {
  collectPrefixWatchers(root, path, 0, seen, mark);
  if (includeDescendants) {
    collectDescendantWatchers(root, path, 0, seen, mark);
  }
}

function collectPlainPath(root: RouteNode, path: JsonPath, includeDescendants: boolean, seen: WatchEntry[], mark: number): void {
  let node: RouteNode | undefined = root;
  addWatchers(node, seen, mark);
  for (let i = 0, length = path.length; i < length; i++) {
    node = node.children.get(path[i]);
    if (node === undefined) return;
    addWatchers(node, seen, mark);
  }
  if (includeDescendants) collectPlainDescendantWatchers(node, seen, mark);
}

function collectPlainDescendantWatchers(node: RouteNode, seen: WatchEntry[], mark: number): void {
  for (const child of node.children.values()) {
    collectPlainSubtreeWatchers(child, seen, mark);
  }
}

function collectPlainSubtreeWatchers(node: RouteNode, seen: WatchEntry[], mark: number): void {
  addWatchers(node, seen, mark);
  for (const child of node.children.values()) {
    collectPlainSubtreeWatchers(child, seen, mark);
  }
}

function collectPrefixWatchers(
  node: RouteNode | null | undefined,
  path: JsonPath,
  offset: number,
  seen: WatchEntry[],
  mark: number
): void {
  if (node === null || node === undefined) return;
  addWatchers(node, seen, mark);
  if (offset >= path.length) return;
  const segment = path[offset];
  collectPrefixWatchers(node.children.get(segment), path, offset + 1, seen, mark);
  collectPrefixWatchers(node.wildcard, path, offset + 1, seen, mark);
}

function collectDescendantWatchers(
  node: RouteNode | null | undefined,
  path: JsonPath,
  offset: number,
  seen: WatchEntry[],
  mark: number
): void {
  if (node === null || node === undefined) return;
  if (offset >= path.length) {
    collectSubtreeWatchers(node, seen, mark);
    return;
  }

  const segment = path[offset];
  collectDescendantWatchers(node.children.get(segment), path, offset + 1, seen, mark);
  collectDescendantWatchers(node.wildcard, path, offset + 1, seen, mark);
}

function collectSubtreeWatchers(node: RouteNode, seen: WatchEntry[], mark: number): void {
  addWatchers(node, seen, mark);
  if (node.wildcard !== null) collectSubtreeWatchers(node.wildcard, seen, mark);
  for (const child of node.children.values()) {
    collectSubtreeWatchers(child, seen, mark);
  }
}

function addWatchers(node: RouteNode, seen: WatchEntry[], mark: number): void {
  for (let i = 0, length = node.watchers.length; i < length; i++) {
    const entry = node.watchers[i];
    if (entry.active && entry.routeMark !== mark) {
      entry.routeMark = mark;
      seen[seen.length] = entry;
    }
  }
}

function resetRouteMarks(entries: Set<WatchEntry>): void {
  for (const entry of entries) {
    entry.routeMark = 0;
  }
}

function resetDeliveryMarks(entries: Set<WatchEntry>): void {
  for (const entry of entries) {
    entry.deliveryMark = 0;
  }
}

function collectVirtualAssignment(
  root: RouteNode,
  base: JsonPath,
  segment: string | number,
  assign: JsonValue,
  seen: WatchEntry[],
  mark: number
): void {
  collectVirtualPath(root, base, segment, null, false, seen, mark);
  if (assign === null || typeof assign !== 'object' || Array.isArray(assign)) {
    collectVirtualPath(root, base, segment, null, true, seen, mark);
    return;
  }

  for (const key in assign) {
    if (!hasOwn.call(assign, key)) continue;
    collectVirtualPath(root, base, segment, [key], true, seen, mark);
  }
}

function collectVirtualPath(
  root: RouteNode,
  base: JsonPath,
  segment: string | number,
  suffix: JsonPath | null,
  includeDescendants: boolean,
  seen: WatchEntry[],
  mark: number
): void {
  collectVirtualPrefixWatchers(root, base, segment, suffix, 0, seen, mark);
  if (includeDescendants) {
    collectVirtualDescendantWatchers(root, base, segment, suffix, 0, seen, mark);
  }
}

function collectVirtualPrefixWatchers(
  node: RouteNode | null | undefined,
  base: JsonPath,
  segment: string | number,
  suffix: JsonPath | null,
  offset: number,
  seen: WatchEntry[],
  mark: number
): void {
  if (node === null || node === undefined) return;
  addWatchers(node, seen, mark);
  const nextSegment = readVirtualSegment(base, segment, suffix, offset);
  if (nextSegment === VIRTUAL_PATH_END) return;
  collectVirtualPrefixWatchers(node.children.get(nextSegment), base, segment, suffix, offset + 1, seen, mark);
  collectVirtualPrefixWatchers(node.wildcard, base, segment, suffix, offset + 1, seen, mark);
}

function collectVirtualDescendantWatchers(
  node: RouteNode | null | undefined,
  base: JsonPath,
  segment: string | number,
  suffix: JsonPath | null,
  offset: number,
  seen: WatchEntry[],
  mark: number
): void {
  if (node === null || node === undefined) return;
  const nextSegment = readVirtualSegment(base, segment, suffix, offset);
  if (nextSegment === VIRTUAL_PATH_END) {
    collectSubtreeWatchers(node, seen, mark);
    return;
  }
  collectVirtualDescendantWatchers(node.children.get(nextSegment), base, segment, suffix, offset + 1, seen, mark);
  collectVirtualDescendantWatchers(node.wildcard, base, segment, suffix, offset + 1, seen, mark);
}

const VIRTUAL_PATH_END = Symbol('virtualPathEnd');

function readVirtualSegment(base: JsonPath, segment: string | number, suffix: JsonPath | null, offset: number): string | number | typeof VIRTUAL_PATH_END {
  if (offset < base.length) return base[offset];
  if (offset === base.length) return segment;
  const suffixOffset = offset - base.length - 1;
  if (suffix === null || suffixOffset >= suffix.length) return VIRTUAL_PATH_END;
  return suffix[suffixOffset];
}

function buildViewValue(source: JsonValue | undefined, options: DeltaViewOptions): JsonValue | undefined {
  if (source === undefined) return undefined;
  const path = normalizeWatchPath(options.path === undefined ? [] : options.path, 'view path');
  const wildcardIndex = path.indexOf(WILDCARD);
  if (wildcardIndex === -1) {
    const value = getPath(source, path);
    if (value === undefined) return undefined;
    const key = path.length === 0 ? '' : path[path.length - 1];
    if (options.include && !options.include(value, key)) return undefined;
    return options.project ? options.project(value, key) : cloneJson(value);
  }

  const basePath = path.slice(0, wildcardIndex);
  const tailPath = path.slice(wildcardIndex + 1);
  const collection = getPath(source, basePath);
  if (collection === null || typeof collection !== 'object') {
    return options.keyBy === undefined ? [] : {};
  }

  if (options.keyBy !== undefined) {
    const out = {};
    iterateCollection(collection, (item, key) => {
      const value = tailPath.length === 0 ? item : getPath(item, tailPath);
      if (value === undefined) return;
      if (options.include && !options.include(value, key)) return;
      const viewKey = readViewKey(options.keyBy as any, value, key);
      if (viewKey === null || viewKey === undefined) return;
      out[String(viewKey)] = options.project ? options.project(value, key) : cloneJson(value);
    });
    return out;
  }

  const out: JsonValue[] = [];
  iterateCollection(collection, (item, key) => {
    const value = tailPath.length === 0 ? item : getPath(item, tailPath);
    if (value === undefined) return;
    if (options.include && !options.include(value, key)) return;
    out[out.length] = options.project ? options.project(value, key) : cloneJson(value);
  });
  return out;
}

function iterateCollection(collection: JsonValue, callback: (item: JsonValue, key: ObjectKey) => void): void {
  if (Array.isArray(collection)) {
    for (let i = 0, length = collection.length; i < length; i++) {
      callback(collection[i], i);
    }
    return;
  }

  if (collection !== null && typeof collection === 'object') {
    for (const key in collection) {
      if (hasOwn.call(collection, key)) callback(collection[key], key);
    }
  }
}

function readViewKey(
  keyBy: ObjectKey | ((value: JsonValue, key: ObjectKey) => ObjectKey | null | undefined),
  value: JsonValue,
  key: ObjectKey
): ObjectKey | null | undefined {
  if (typeof keyBy === 'function') return keyBy(value, key);
  if (value !== null && typeof value === 'object') return value[keyBy as string];
  return undefined;
}
