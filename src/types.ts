import type {
  DiffOptions,
  DiffProfile,
  EngineOptions,
  TrainingSample
} from '@shapeshift-labs/frontier-engine/types';

export type {
  DiffOptions,
  DiffProfile,
  EngineOptions,
  TrainingSample
};

/** JSON primitive values supported by Frontier state patches. */
export type JsonPrimitive = null | boolean | number | string;

/** Any JSON-shaped value accepted by the state engine. */
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;

/** A plain JSON object. */
export interface JsonObject {
  [key: string]: JsonValue;
}

export type JsonRecord = JsonObject;

/** A JSON array. */
export interface JsonArray extends Array<JsonValue> {}

export type PathSegment = string | number;
export type JsonPath = PathSegment[];
export type ObjectKey = string | number;
export type CacheToken = string | number | boolean | symbol | bigint | object;
export type Token = CacheToken;

/** Compact patch operation tuple emitted by Frontier diff and routed by Frontier state. */
export type PatchOperation =
  | [0, JsonPath, JsonValue]
  | [1, JsonPath]
  | [2, JsonPath, number]
  | [3, JsonPath, JsonValue[]]
  | [4, JsonPath, JsonObject]
  | [5, JsonPath, number, number, string]
  | [6, JsonPath, number, number, JsonValue[]]
  | [7, JsonPath, number, number]
  | [8, JsonPath, number, number, number]
  | [9, JsonPath, number[], JsonValue[]]
  | [10, JsonPath, number[], JsonObject[]]
  | [11, JsonPath, number[], number[], JsonValue[]]
  | [12, JsonPath, number[], JsonPath[], JsonValue[]]
  | [13, JsonPath, JsonPrimitive[]]
  | [14, JsonPath, number, string, string, JsonPrimitive[], JsonPrimitive[]];

export type Patch = PatchOperation[];

export type KeyCompare = (left: string, right: string) => number;
export type TokenGetter<TValue extends JsonValue = JsonValue> = (value: TValue) => CacheToken | null | undefined;
export type ArrayKeyGetter<TValue extends JsonValue = JsonValue> = (
  value: TValue,
  index?: number,
  array?: TValue[]
) => ObjectKey | null | undefined;

export interface DirtyRowsFrontier {
  path: JsonPath;
  rows: ArrayLike<number>;
  fields?: JsonPath[];
}

export type WatchPath = string | JsonPath;
export type PatchWatchCallback = (patch: Patch) => void;

export interface PatchSubscription {
  readonly active: boolean;
  unsubscribe(): void;
}

export interface WatchOptions {
  path?: WatchPath;
  fields?: WatchPath[];
  range?: WatchRange;
}

export interface WatchRange {
  start?: number;
  end?: number;
  rowStart?: number;
  rowEnd?: number;
  startRow?: number;
  endRow?: number;
  columnStart?: number;
  columnEnd?: number;
  startColumn?: number;
  endColumn?: number;
}

export interface PatchRouter {
  readonly size: number;
  watch(path: WatchPath, callback: PatchWatchCallback): PatchSubscription;
  watch(path: WatchPath, fields: WatchPath[], callback: PatchWatchCallback): PatchSubscription;
  watch(options: WatchOptions, callback: PatchWatchCallback): PatchSubscription;
  route(patch: Patch): number;
  clear(): void;
}

export type StateBasisToken = number;
export type StatePatchStaleMode = 'reject' | 'route' | 'apply';

export interface StatePatchEnvelope {
  kind: 'frontier.state.patch';
  patch: Patch;
  basis: StateBasisToken;
  nextBasis: StateBasisToken;
  metadata?: JsonObject;
}

export interface StatePatchEnvelopeOptions {
  nextBasis?: StateBasisToken;
  metadata?: JsonObject;
}

export interface StateCommitWithBasisOptions extends DiffOptions {
  metadata?: JsonObject;
}

export type StatePatchInput = Patch | StatePatchEnvelope;

export interface StatePatchCommitOptions {
  basis?: StateBasisToken;
  nextBasis?: StateBasisToken;
  onStale?: StatePatchStaleMode;
}

export type StatePatchCommitStatus = 'applied' | 'rejected' | 'routed';
export type StatePatchCommitReason = 'basis-mismatch' | 'empty-patch';

export interface StatePatchCommitResult {
  status: StatePatchCommitStatus;
  applied: boolean;
  stale: boolean;
  routed: number;
  patch: Patch;
  basis: StateBasisToken;
  currentBasis: StateBasisToken;
  nextBasis: StateBasisToken;
  value: JsonValue | undefined;
  reason?: StatePatchCommitReason;
}

export interface StateEngineOptions {
  diff?: EngineOptions;
  basis?: StateBasisToken;
}

export interface DeltaView {
  value(): JsonValue | undefined;
  onPatch(callback: PatchWatchCallback): PatchSubscription;
  refresh(): Patch;
  dispose(): void;
}

export interface DeltaViewOptions extends WatchOptions {
  keyBy?: ObjectKey | ((value: JsonValue, key: ObjectKey) => ObjectKey | null | undefined);
  include?: (value: JsonValue, key: ObjectKey) => boolean;
  project?: (value: JsonValue, key: ObjectKey) => JsonValue;
}

export interface StateEngine {
  get(): JsonValue | undefined;
  getBasis(): StateBasisToken;
  createPatchEnvelope(patch: Patch, options?: StatePatchEnvelopeOptions): StatePatchEnvelope;
  watch(path: WatchPath, callback: PatchWatchCallback): PatchSubscription;
  watch(path: WatchPath, fields: WatchPath[], callback: PatchWatchCallback): PatchSubscription;
  watch(options: WatchOptions, callback: PatchWatchCallback): PatchSubscription;
  commit(next: JsonValue, options?: DiffOptions): Patch;
  commitWithBasis(next: JsonValue, options?: StateCommitWithBasisOptions): StatePatchEnvelope;
  set(next: JsonValue, options?: DiffOptions): Patch;
  commitPatch(patch: StatePatchInput, options?: StatePatchCommitOptions): JsonValue | undefined;
  commitPatchWithBasis(patch: StatePatchInput, options?: StatePatchCommitOptions): StatePatchCommitResult;
  view(path: WatchPath): DeltaView;
  view(options: DeltaViewOptions): DeltaView;
  equals(next: JsonValue, options?: DiffOptions): boolean;
  train(samples: TrainingSample[]): DiffProfile;
  getProfile(): DiffProfile;
  loadProfile(profile?: DiffProfile | null): void;
  clear(): void;
}

export interface TextPosition {
  path: JsonPath;
  offset: number;
}

export interface MapPathOptions {
  validate?: boolean;
  deleted?: 'null' | 'start' | 'end';
  assoc?: -1 | 1 | number;
}
