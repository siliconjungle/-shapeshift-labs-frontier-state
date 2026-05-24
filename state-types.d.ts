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

export interface DiffOptions<TValue extends JsonValue = JsonValue> {
  validate?: boolean;
  strategy?: 'replace';
  maxPatchOperations?: number | null;
  stable?: boolean | KeyCompare;
  sortKeys?: boolean;
  keyCompare?: KeyCompare;
  versionKey?: ObjectKey;
  fingerprintKey?: ObjectKey;
  getVersion?: TokenGetter<TValue>;
  getFingerprint?: TokenGetter<TValue>;
  arrayKey?: ObjectKey | ArrayKeyGetter<TValue> | boolean | null;
  autoArrayKey?: boolean;
  recordKeyCandidates?: ObjectKey[] | false | null;
  containerKeys?: ObjectKey[] | false | null;
  dirtyPaths?: JsonPath[];
  dirtyRows?: DirtyRowsFrontier | DirtyRowsFrontier[];
}

export type SchemaField = ObjectKey | NestedObjectSchemaField;

export interface NestedObjectSchemaField {
  key: ObjectKey;
  type: 'object';
  fields: SchemaField[];
}

export interface ObjectSchema {
  type: 'object';
  path?: JsonPath;
  fields: SchemaField[];
}

export interface RecordArraySchema {
  type: 'array';
  path?: JsonPath;
  key?: ObjectKey;
  item: {
    type: 'object';
    key?: ObjectKey;
    fields: SchemaField[];
  };
}

export type SingleSchema = ObjectSchema | RecordArraySchema;

export interface MultiSchema {
  schemas: SingleSchema[];
}

export type Schema = SingleSchema | MultiSchema;

export interface DiffProfilePlan {
  strategy?: 'structural' | 'schema' | 'adaptive-schema';
  schemaCount?: number;
  paths?: JsonPath[];
}

export interface EqualityProfilePlan {
  strategy?: 'structural' | 'schema' | 'fingerprint' | 'version';
  schemaCount?: number;
}

export interface StateProfilePlan {
  routing?: 'patch-router';
  apply?: 'owned-mutable';
  watches?: number;
  exactWatches?: number;
  wildcardWatches?: number;
  fieldWatches?: number;
  rangeWatches?: number;
}

export interface ProfilePlans {
  diff?: DiffProfilePlan;
  equality?: EqualityProfilePlan;
  state?: StateProfilePlan;
}

export interface EngineProfileSettings {
  cacheSize?: number;
  adaptive?: boolean;
  adaptiveThreshold?: number;
  arrayKey?: ObjectKey | false | null;
  autoArrayKey?: boolean;
  recordKeyCandidates?: ObjectKey[] | false | null;
  containerKeys?: ObjectKey[] | false | null;
  stable?: boolean;
  sortKeys?: boolean;
  maxPatchOperations?: number | null;
  versionKey?: ObjectKey;
  fingerprintKey?: ObjectKey;
}

export interface DiffProfile {
  version?: 1;
  settings?: EngineProfileSettings;
  plans?: ProfilePlans;
  schema?: SingleSchema;
  schemas?: SingleSchema[];
}

export interface EngineOptions<TValue extends JsonValue = JsonValue> extends DiffOptions<TValue> {
  cacheSize?: number;
  maxEntries?: number;
  adaptive?: boolean;
  adaptiveThreshold?: number;
  schema?: Schema | null;
  containerKeys?: ObjectKey[] | false | null;
  profile?: DiffProfile | null;
}

export type TrainingSample<TSource extends JsonValue = JsonValue, TTarget extends JsonValue = JsonValue> =
  | [TSource, TTarget]
  | { source: TSource; target: TTarget }
  | { before: TSource; after: TTarget };

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

export interface StateEngineOptions {
  diff?: EngineOptions;
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
  watch(path: WatchPath, callback: PatchWatchCallback): PatchSubscription;
  watch(path: WatchPath, fields: WatchPath[], callback: PatchWatchCallback): PatchSubscription;
  watch(options: WatchOptions, callback: PatchWatchCallback): PatchSubscription;
  commit(next: JsonValue, options?: DiffOptions): Patch;
  set(next: JsonValue, options?: DiffOptions): Patch;
  commitPatch(patch: Patch): JsonValue | undefined;
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
