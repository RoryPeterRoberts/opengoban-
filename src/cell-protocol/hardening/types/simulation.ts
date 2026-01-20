/**
 * Cell Protocol - Hardening: Simulation Types
 *
 * Type definitions for agent-based economic simulation (PRD-10).
 * Defines agents, strategies, shocks, and simulation metrics.
 */

import { IdentityId, CellId, Units, Timestamp } from '../../types/common';
import { TaskCategory } from '../../types/commitment';

// ============================================
// AGENT TYPES
// ============================================

/** Agent behavioral strategies */
export type AgentStrategy =
  | 'COOPERATOR'      // Always cooperates, honors all agreements
  | 'CONDITIONAL'     // Tit-for-tat, reputation-threshold
  | 'DEFECTOR'        // Accumulates balance, defects at threshold
  | 'SHIRKER'         // Low quality, delays fulfillment
  | 'COLLUDER'        // Coordinates with ring members
  | 'SYBIL';          // Attempts multiple identities

/** Agent needs (consumption requirements) */
export interface AgentNeeds {
  food: number;
  energy: number;
  shelter: number;
  medical: number;
}

/** Agent skills (production capabilities) */
export interface AgentSkills {
  cooking: number;      // 0-1, ability to produce food
  farming: number;      // 0-1, ability to produce raw food
  repair: number;       // 0-1, ability to maintain shelter
  medical: number;      // 0-1, healthcare skills
  energy: number;       // 0-1, energy production/maintenance
}

/** Simulated agent */
export interface SimulatedAgent {
  /** Unique identifier */
  id: IdentityId;
  /** Behavioral strategy */
  strategy: AgentStrategy;
  /** Display name */
  displayName: string;
  /** Consumption requirements */
  needs: AgentNeeds;
  /** Production capabilities */
  skills: AgentSkills;
  /** Weekly labor supply in hours */
  laborSupply: number;
  /** Colluder ring ID (if COLLUDER strategy) */
  colluderRingId?: string;
  /** Defection threshold (balance at which DEFECTOR defects) */
  defectionThreshold?: Units;
  /** Sybil parent (if SYBIL strategy and this is a secondary identity) */
  sybilParent?: IdentityId;
  /** Private key for signing (simulated) */
  privateKey?: string;
}

/** Agent state during simulation */
export interface AgentState {
  /** Agent ID */
  agentId: IdentityId;
  /** Current balance in the cell */
  balance: Units;
  /** Current credit limit */
  limit: Units;
  /** Reserved amount */
  reserve: Units;
  /** Needs satisfaction this period (0-1 per need) */
  needsSatisfaction: AgentNeeds;
  /** Commitments as promisor */
  activeCommitmentsAsPromisor: number;
  /** Commitments as promisee */
  activeCommitmentsAsPromisee: number;
  /** Hours worked this period */
  hoursWorked: number;
  /** Total credits earned */
  totalEarned: Units;
  /** Total credits spent */
  totalSpent: Units;
  /** Fulfillment rate */
  fulfillmentRate: number;
  /** Has defected? */
  hasDefected: boolean;
  /** Is frozen? */
  isFrozen: boolean;
  /** Is excluded? */
  isExcluded: boolean;
}

// ============================================
// SHOCK TYPES
// ============================================

/** Types of economic shocks */
export type ShockType =
  | 'RESOURCE_SCARCITY'       // Food/energy drops 50%
  | 'DEFECTION_WAVE'          // X% of agents switch to defect
  | 'FEDERATION_SEVERANCE'    // Cut all federation links
  | 'SYBIL_INFILTRATION'      // Multiple identity attack
  | 'GOVERNANCE_CAPTURE'      // Infiltrators seek council seats
  | 'CONNECTIVITY_LOSS';      // Network partitions

/** Shock event definition */
export interface ShockEvent {
  /** Type of shock */
  type: ShockType;
  /** When shock occurs (simulation tick) */
  tick: number;
  /** Shock intensity (0-1) */
  intensity: number;
  /** Duration in ticks (0 = instantaneous) */
  duration: number;
  /** Specific parameters */
  parameters: ShockParameters;
}

/** Shock-specific parameters */
export type ShockParameters =
  | ResourceScarcityParams
  | DefectionWaveParams
  | FederationSeveranceParams
  | SybilInfiltrationParams
  | GovernanceCaptureParams
  | ConnectivityLossParams;

export interface ResourceScarcityParams {
  type: 'RESOURCE_SCARCITY';
  /** Affected resource categories */
  affectedCategories: TaskCategory[];
  /** Reduction factor (0.5 = 50% reduction) */
  reductionFactor: number;
}

export interface DefectionWaveParams {
  type: 'DEFECTION_WAVE';
  /** Percentage of agents that switch to defect (0-1) */
  defectionRate: number;
  /** Target agents (if specified, only these switch) */
  targetAgents?: IdentityId[];
}

export interface FederationSeveranceParams {
  type: 'FEDERATION_SEVERANCE';
  /** Cells to isolate (if not specified, cuts all links) */
  isolatedCells?: CellId[];
}

export interface SybilInfiltrationParams {
  type: 'SYBIL_INFILTRATION';
  /** Budget in units for creating sybil accounts */
  budget: Units;
  /** Target number of sybil identities */
  targetCount: number;
}

export interface GovernanceCaptureParams {
  type: 'GOVERNANCE_CAPTURE';
  /** Number of infiltrators */
  infiltratorCount: number;
  /** Infiltrators start with high reputation? */
  highReputation: boolean;
}

export interface ConnectivityLossParams {
  type: 'CONNECTIVITY_LOSS';
  /** Probability of partition per tick */
  partitionProbability: number;
  /** Affected cell pairs */
  affectedCells?: Array<[CellId, CellId]>;
}

// ============================================
// SIMULATION CONFIGURATION
// ============================================

/** Configuration for an economic simulation */
export interface SimulationConfig {
  /** Unique simulation ID */
  id: string;
  /** Number of ticks to simulate */
  ticks: number;
  /** Tick duration in simulated hours */
  tickDurationHours: number;
  /** Random seed for reproducibility */
  seed: number;
  /** Cell configuration */
  cells: CellConfig[];
  /** Agent distribution */
  agentDistribution: AgentDistribution;
  /** Shocks to inject */
  shocks: ShockEvent[];
  /** Metrics to collect */
  metrics: MetricConfig;
  /** Federation enabled */
  federationEnabled: boolean;
  /** Trade frequency (trades per tick per agent) */
  tradeFrequency: number;
  /** Commitment frequency */
  commitmentFrequency: number;
}

/** Configuration for a simulated cell */
export interface CellConfig {
  /** Cell ID */
  id: CellId;
  /** Initial member count */
  initialMembers: number;
  /** Default credit limit */
  defaultLimit: Units;
  /** Federation cap factor (beta) */
  federationBeta: number;
}

/** Distribution of agent strategies */
export interface AgentDistribution {
  /** Number of cooperators */
  cooperators: number;
  /** Number of conditional cooperators */
  conditional: number;
  /** Number of defectors */
  defectors: number;
  /** Number of shirkers */
  shirkers: number;
  /** Number of colluders */
  colluders: number;
  /** Number of sybils */
  sybils: number;
}

/** Metrics collection configuration */
export interface MetricConfig {
  /** Collect survival metrics */
  survival: boolean;
  /** Collect economic metrics */
  economic: boolean;
  /** Collect network metrics */
  network: boolean;
  /** Collect per-agent metrics */
  perAgent: boolean;
  /** Collection interval (every N ticks) */
  interval: number;
}

// ============================================
// SIMULATION METRICS
// ============================================

/** Snapshot of simulation metrics at a point in time */
export interface MetricSnapshot {
  /** Simulation tick */
  tick: number;
  /** Simulated timestamp */
  timestamp: Timestamp;
  /** Survival metrics */
  survival: SurvivalMetrics;
  /** Economic metrics */
  economic: EconomicMetrics;
  /** Network metrics */
  network?: NetworkMetrics;
  /** Per-cell metrics */
  perCell: Map<CellId, CellMetrics>;
}

/** Survival-related metrics */
export interface SurvivalMetrics {
  /** Fraction of agents meeting minimum needs (target >= 0.9) */
  survivalRate: number;
  /** Number of agents meeting all needs */
  agentsSurviving: number;
  /** Total agents */
  totalAgents: number;
  /** Average needs satisfaction (0-1) */
  avgNeedsSatisfaction: number;
  /** Agents below humanitarian floor */
  agentsBelowFloor: number;
}

/** Economic metrics */
export interface EconomicMetrics {
  /** Total transaction volume */
  transactionVolume: Units;
  /** Total commitments created */
  commitmentsCreated: number;
  /** Fulfillment rate */
  fulfillmentRate: number;
  /** Average balance */
  avgBalance: Units;
  /** Gini coefficient (0-1, 0 = equality) */
  giniCoefficient: number;
  /** Velocity (transactions per unit per tick) */
  velocity: number;
  /** Agents at floor */
  agentsAtFloor: number;
  /** Total extraction by defectors */
  defectorExtraction: Units;
}

/** Network/federation metrics */
export interface NetworkMetrics {
  /** Active federation links */
  activeFederationLinks: number;
  /** Total federation transaction volume */
  federationVolume: Units;
  /** Average federation position */
  avgFederationPosition: Units;
  /** Cells in quarantine */
  cellsInQuarantine: number;
  /** Connectivity ratio (0-1) */
  connectivity: number;
}

/** Per-cell metrics */
export interface CellMetrics {
  /** Cell ID */
  cellId: CellId;
  /** Member count */
  memberCount: number;
  /** Active members */
  activeMemberCount: number;
  /** Sum of balances (should be ~0) */
  balanceSum: Units;
  /** Total capacity */
  totalCapacity: Units;
  /** Conservation holds */
  conservationHolds: boolean;
  /** Floor constraints hold */
  floorsHold: boolean;
  /** Federation position */
  federationPosition?: Units;
  /** Risk state */
  riskState: string;
}

// ============================================
// SIMULATION RESULTS
// ============================================

/** Result of a complete simulation run */
export interface SimulationResult {
  /** Simulation config */
  config: SimulationConfig;
  /** Final metrics */
  finalMetrics: MetricSnapshot;
  /** Metric history (sampled) */
  history: MetricSnapshot[];
  /** Final agent states */
  agentStates: Map<IdentityId, AgentState>;
  /** Summary statistics */
  summary: SimulationSummary;
  /** Duration in real ms */
  durationMs: number;
  /** Started at */
  startedAt: Timestamp;
  /** Completed at */
  completedAt: Timestamp;
}

/** Summary statistics for a simulation */
export interface SimulationSummary {
  /** Minimum survival rate observed */
  minSurvivalRate: number;
  /** Average survival rate */
  avgSurvivalRate: number;
  /** Final survival rate */
  finalSurvivalRate: number;
  /** Freeze probability (seller acceptance collapse) */
  freezeProbability: number;
  /** Total extraction by attackers */
  totalExtraction: Units;
  /** Contagion size (cells affected by failures) */
  contagionSize: number;
  /** All invariants maintained throughout */
  invariantsMaintained: boolean;
  /** Number of invariant violations */
  invariantViolations: number;
  /** Recovery time in ticks (if applicable) */
  recoveryTime?: number;
  /** Passed success criteria */
  passedCriteria: boolean;

  // Additional fields for reporter compatibility
  /** Number of simulations run (for aggregated summaries) */
  simulationsRun?: number;
  /** Average freeze probability across simulations */
  avgFreezeProbability?: number;
  /** Average extraction */
  avgExtraction?: number;
  /** Worst (minimum) survival rate */
  worstSurvivalRate?: number;
  /** Whether targets are met */
  meetsTargets?: boolean;
}

// ============================================
// DEFAULT CONFIGURATIONS
// ============================================

/** Default agent needs */
export const DEFAULT_AGENT_NEEDS: AgentNeeds = {
  food: 3,
  energy: 2,
  shelter: 1,
  medical: 0.5,
};

/** Default agent skills */
export const DEFAULT_AGENT_SKILLS: AgentSkills = {
  cooking: 0.5,
  farming: 0.3,
  repair: 0.3,
  medical: 0.1,
  energy: 0.3,
};

/** Default simulation config */
export const DEFAULT_SIMULATION_CONFIG: Partial<SimulationConfig> = {
  ticks: 100,
  tickDurationHours: 1,
  seed: 42,
  tradeFrequency: 2,
  commitmentFrequency: 0.5,
  federationEnabled: true,
  metrics: {
    survival: true,
    economic: true,
    network: true,
    perAgent: false,
    interval: 10,
  },
};
