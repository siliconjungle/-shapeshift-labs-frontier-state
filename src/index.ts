export const FRONTIER_STATE_QUEUE_CHECKPOINT_KIND = 'frontier.state.queue-checkpoint';
export const FRONTIER_STATE_QUEUE_CHECKPOINT_VERSION = 1;

export type StateQueueCheckpointStage = 'queued' | 'running' | 'review' | 'resolved';
export type StateQueueDecisionCursor = string | number;

export interface StateQueueCheckpointCounts {
  queuedCount: number;
  runningCount: number;
  reviewCount: number;
  resolvedCount: number;
  openCount: number;
  totalCount: number;
}

export interface StateQueueCheckpointItem {
  id?: string;
  lane?: string;
  stage?: StateQueueCheckpointStage;
  status?: string;
  agentId?: string;
  agentIds?: readonly string[];
  activeAgentIds?: readonly string[];
  decisionCursor?: StateQueueDecisionCursor | null;
  terminal?: boolean;
  resolved?: boolean;
  needsReview?: boolean;
  metadata?: Record<string, unknown>;
}

export interface StateQueueCheckpointAgent {
  id: string;
  lane?: string;
  lanes?: readonly string[];
  active?: boolean;
  status?: string;
  decisionCursor?: StateQueueDecisionCursor | null;
  metadata?: Record<string, unknown>;
}

export interface StateQueueCheckpointDecision {
  cursor?: StateQueueDecisionCursor | null;
  lane?: string;
  agentId?: string;
  itemId?: string;
  stage?: StateQueueCheckpointStage;
  status?: string;
  metadata?: Record<string, unknown>;
}

export interface StateQueueCheckpointInput {
  items?: readonly StateQueueCheckpointItem[];
  agents?: readonly StateQueueCheckpointAgent[];
  decisions?: readonly StateQueueCheckpointDecision[];
  lanes?: readonly string[];
  defaultLane?: string;
  generatedAt?: number | string;
  lastDecisionCursor?: StateQueueDecisionCursor | null;
}

export interface StateQueueActiveAgent extends StateQueueCheckpointCounts {
  id: string;
  lanes: string[];
  assignedCount: number;
}

export interface StateQueueLanePressure extends StateQueueCheckpointCounts {
  lane: string;
  activeAgentCount: number;
  waitingCount: number;
  pressure: number;
}

export interface StateQueueCheckpoint {
  kind: typeof FRONTIER_STATE_QUEUE_CHECKPOINT_KIND;
  version: typeof FRONTIER_STATE_QUEUE_CHECKPOINT_VERSION;
  generatedAt?: number | string;
  counts: StateQueueCheckpointCounts;
  activeAgents: StateQueueActiveAgent[];
  lanePressure: StateQueueLanePressure[];
  lastDecisionCursor?: StateQueueDecisionCursor;
}

interface StateQueueAgentAccumulator extends StateQueueCheckpointCounts {
  id: string;
  lanes: Set<string>;
  assignedCount: number;
}

interface StateQueueLaneAccumulator extends StateQueueCheckpointCounts {
  lane: string;
}

export function createStateQueueCheckpoint(input: StateQueueCheckpointInput = {}): StateQueueCheckpoint {
  const defaultLane = input.defaultLane || 'default';
  const counts = createStateQueueCheckpointCounts();
  const laneMap = new Map<string, StateQueueLaneAccumulator>();
  const agentMap = new Map<string, StateQueueAgentAccumulator>();

  for (const lane of input.lanes || []) {
    getLaneAccumulator(laneMap, lane || defaultLane);
  }

  for (const agent of input.agents || []) {
    if (!agent || !agent.id || agent.active === false || isInactiveAgentStatus(agent.status)) continue;
    const accumulator = getAgentAccumulator(agentMap, agent.id);
    const lanes = normalizeAgentLanes(agent, defaultLane);
    for (const lane of lanes) {
      accumulator.lanes.add(lane);
      getLaneAccumulator(laneMap, lane);
    }
  }

  for (const item of input.items || []) {
    if (!item) continue;
    const stage = normalizeStateQueueCheckpointStage(item);
    const lane = item.lane || defaultLane;
    const laneCounts = getLaneAccumulator(laneMap, lane);
    incrementStateQueueCheckpointCounts(counts, stage);
    incrementStateQueueCheckpointCounts(laneCounts, stage);

    if (stage === 'resolved') continue;
    for (const agentId of itemAgentIds(item)) {
      const agent = getAgentAccumulator(agentMap, agentId);
      agent.lanes.add(lane);
      incrementStateQueueCheckpointCounts(agent, stage);
      agent.assignedCount++;
    }
  }

  const activeAgents = Array.from(agentMap.values()).map((agent) => ({
    id: agent.id,
    lanes: Array.from(agent.lanes),
    queuedCount: agent.queuedCount,
    runningCount: agent.runningCount,
    reviewCount: agent.reviewCount,
    resolvedCount: agent.resolvedCount,
    openCount: agent.openCount,
    totalCount: agent.totalCount,
    assignedCount: agent.assignedCount
  }));

  const lanePressure = Array.from(laneMap.values()).map((lane) => {
    const activeAgentCount = activeAgents.reduce((total, agent) => (
      agent.lanes.includes(lane.lane) ? total + 1 : total
    ), 0);
    const waitingCount = lane.queuedCount + lane.reviewCount;
    return {
      lane: lane.lane,
      queuedCount: lane.queuedCount,
      runningCount: lane.runningCount,
      reviewCount: lane.reviewCount,
      resolvedCount: lane.resolvedCount,
      openCount: lane.openCount,
      totalCount: lane.totalCount,
      activeAgentCount,
      waitingCount,
      pressure: lane.openCount / Math.max(1, activeAgentCount)
    };
  });

  const checkpoint: StateQueueCheckpoint = {
    kind: FRONTIER_STATE_QUEUE_CHECKPOINT_KIND,
    version: FRONTIER_STATE_QUEUE_CHECKPOINT_VERSION,
    generatedAt: input.generatedAt,
    counts,
    activeAgents,
    lanePressure
  };
  const lastDecisionCursor = resolveStateQueueDecisionCursor(input);
  if (lastDecisionCursor !== undefined) checkpoint.lastDecisionCursor = lastDecisionCursor;
  return checkpoint;
}

function createStateQueueCheckpointCounts(): StateQueueCheckpointCounts {
  return {
    queuedCount: 0,
    runningCount: 0,
    reviewCount: 0,
    resolvedCount: 0,
    openCount: 0,
    totalCount: 0
  };
}

function incrementStateQueueCheckpointCounts(
  counts: StateQueueCheckpointCounts,
  stage: StateQueueCheckpointStage
): void {
  counts.totalCount++;
  if (stage !== 'resolved') counts.openCount++;
  if (stage === 'queued') counts.queuedCount++;
  else if (stage === 'running') counts.runningCount++;
  else if (stage === 'review') counts.reviewCount++;
  else counts.resolvedCount++;
}

function getLaneAccumulator(
  lanes: Map<string, StateQueueLaneAccumulator>,
  lane: string
): StateQueueLaneAccumulator {
  const key = lane || 'default';
  let accumulator = lanes.get(key);
  if (!accumulator) {
    accumulator = { lane: key, ...createStateQueueCheckpointCounts() };
    lanes.set(key, accumulator);
  }
  return accumulator;
}

function getAgentAccumulator(
  agents: Map<string, StateQueueAgentAccumulator>,
  id: string
): StateQueueAgentAccumulator {
  let accumulator = agents.get(id);
  if (!accumulator) {
    accumulator = {
      id,
      lanes: new Set<string>(),
      assignedCount: 0,
      ...createStateQueueCheckpointCounts()
    };
    agents.set(id, accumulator);
  }
  return accumulator;
}

function normalizeStateQueueCheckpointStage(item: StateQueueCheckpointItem): StateQueueCheckpointStage {
  if (item.stage) return item.stage;
  if (item.resolved || item.terminal) return 'resolved';
  if (item.needsReview) return 'review';
  return normalizeStateQueueStatus(item.status);
}

function normalizeStateQueueStatus(status: string | undefined): StateQueueCheckpointStage {
  const value = normalizeStateQueueStatusText(status);
  if (
    value === 'running' ||
    value === 'active' ||
    value === 'in-progress' ||
    value === 'in_progress' ||
    value === 'processing' ||
    value === 'working' ||
    value === 'leased'
  ) {
    return 'running';
  }
  if (
    value === 'review' ||
    value === 'reviewing' ||
    value === 'needs-review' ||
    value === 'needs_review' ||
    value === 'ready-for-review' ||
    value === 'ready_for_review' ||
    value === 'coordinator-review' ||
    value === 'coordinator_review' ||
    value === 'escalated'
  ) {
    return 'review';
  }
  if (
    value === 'resolved' ||
    value === 'done' ||
    value === 'completed' ||
    value === 'complete' ||
    value === 'verified' ||
    value === 'applied' ||
    value === 'accepted' ||
    value === 'merged' ||
    value === 'recorded' ||
    value === 'rejected' ||
    value === 'failed' ||
    value === 'blocked' ||
    value === 'stale' ||
    value === 'skipped'
  ) {
    return 'resolved';
  }
  return 'queued';
}

function normalizeStateQueueStatusText(status: string | undefined): string {
  return String(status || 'queued').trim().toLowerCase();
}

function isInactiveAgentStatus(status: string | undefined): boolean {
  const value = normalizeStateQueueStatusText(status);
  return value === 'idle' || value === 'inactive' || value === 'offline' || value === 'resolved';
}

function normalizeAgentLanes(agent: StateQueueCheckpointAgent, defaultLane: string): string[] {
  const lanes = new Set<string>();
  for (const lane of agent.lanes || []) {
    if (lane) lanes.add(lane);
  }
  if (agent.lane) lanes.add(agent.lane);
  if (lanes.size === 0) lanes.add(defaultLane);
  return Array.from(lanes);
}

function itemAgentIds(item: StateQueueCheckpointItem): string[] {
  const agents = new Set<string>();
  if (item.agentId) agents.add(item.agentId);
  for (const agentId of item.agentIds || []) {
    if (agentId) agents.add(agentId);
  }
  for (const agentId of item.activeAgentIds || []) {
    if (agentId) agents.add(agentId);
  }
  return Array.from(agents);
}

function resolveStateQueueDecisionCursor(
  input: StateQueueCheckpointInput
): StateQueueDecisionCursor | undefined {
  if (input.lastDecisionCursor !== undefined) return input.lastDecisionCursor ?? undefined;
  const decisionCursor = lastStateQueueDecisionCursor(input.decisions);
  if (decisionCursor !== undefined) return decisionCursor;
  return lastStateQueueDecisionCursor(input.items);
}

function lastStateQueueDecisionCursor(
  records: readonly (StateQueueCheckpointDecision | StateQueueCheckpointItem)[] | undefined
): StateQueueDecisionCursor | undefined {
  let cursor: StateQueueDecisionCursor | undefined;
  for (const record of records || []) {
    const next = (record as StateQueueCheckpointDecision).cursor ?? (record as StateQueueCheckpointItem).decisionCursor;
    if (next !== undefined && next !== null) cursor = next;
  }
  return cursor;
}

export { createPatchRouter, createStateEngine, createStatePatchEnvelope } from './subscription.ts';
export { mapPath, mapTextPosition, mapTextPositions } from './path-map.ts';

export type {
  DeltaView,
  DeltaViewOptions,
  DiffOptions,
  DirtyRowsFrontier,
  JsonArray,
  JsonObject,
  JsonPath,
  JsonPrimitive,
  JsonValue,
  MapPathOptions,
  ObjectKey,
  Patch,
  PatchOperation,
  PatchRouter,
  PatchSubscription,
  PatchWatchCallback,
  PathSegment,
  StateBasisToken,
  StateCommitWithBasisOptions,
  StateEngine,
  StateEngineOptions,
  StateEngineRegistryOptions,
  StatePatchCommitOptions,
  StatePatchCommitReason,
  StatePatchCommitResult,
  StatePatchCommitStatus,
  StatePatchEnvelope,
  StatePatchEnvelopeOptions,
  StatePatchInput,
  StatePatchStaleMode,
  StateRegistrySink,
  TextPosition,
  WatchOptions,
  WatchPath,
  WatchRange
} from './types.ts';
