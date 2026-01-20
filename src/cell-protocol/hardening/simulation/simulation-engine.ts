/**
 * Cell Protocol - Hardening: Simulation Engine
 *
 * Core simulation loop for agent-based economic modeling.
 * Simulates agent behavior, transactions, and system dynamics.
 */

import { CellId, IdentityId, Units, now } from '../../types/common';
import { MembershipStatus, BalanceChangeReason } from '../../types/common';
import { TaskCategory, CommitmentType } from '../../types/commitment';
import { CellProtocol, createCellProtocol } from '../../index';
import {
  SimulationConfig,
  SimulationResult,
  AgentDistribution,
  SimulatedAgent,
  AgentState,
  MetricSnapshot,
  SimulationSummary,
  ShockEvent,
  DEFAULT_SIMULATION_CONFIG,
  DEFAULT_AGENT_NEEDS,
} from '../types/simulation';
import {
  createStrategy,
  createSimulatedAgent,
  IAgentStrategy,
  DecisionContext,
} from './agent-strategies';
import { MetricsCollector } from './metrics-collector';
import { ShockHandler } from './shock-handlers';
import { SeededRandom } from '../generators/operation-generator';

// ============================================
// SIMULATION STATE
// ============================================

/** Internal simulation state */
interface SimulationState {
  /** Current tick */
  tick: number;
  /** Active agents */
  agents: Map<IdentityId, SimulatedAgent>;
  /** Agent states */
  agentStates: Map<IdentityId, AgentState>;
  /** Agent strategies */
  strategies: Map<IdentityId, IAgentStrategy>;
  /** Cell protocols */
  cells: Map<CellId, CellProtocol>;
  /** Agent-to-cell mapping */
  agentCell: Map<IdentityId, CellId>;
  /** RNG */
  rng: SeededRandom;
  /** Metrics history */
  history: MetricSnapshot[];
  /** Active shocks */
  activeShocks: ShockEvent[];
  /** Defected agents */
  defectedAgents: Set<IdentityId>;
  /** Frozen agents */
  frozenAgents: Set<IdentityId>;
  /** Total extraction */
  totalExtraction: Units;
  /** Invariant violations */
  invariantViolations: number;
}

// ============================================
// SIMULATION ENGINE
// ============================================

/**
 * Economic Simulation Engine
 * Simulates multi-agent economic behavior in Cell Protocol
 */
export class SimulationEngine {
  private config: SimulationConfig;
  private state: SimulationState | null = null;
  private metricsCollector: MetricsCollector;
  private shockHandler: ShockHandler;
  private onProgress?: (tick: number, totalTicks: number) => void;

  constructor(config: SimulationConfig) {
    this.config = {
      ...DEFAULT_SIMULATION_CONFIG,
      ...config,
    } as SimulationConfig;

    this.metricsCollector = new MetricsCollector();
    this.shockHandler = new ShockHandler();
  }

  /**
   * Set progress callback
   */
  setProgressCallback(callback: (tick: number, totalTicks: number) => void): void {
    this.onProgress = callback;
  }

  /**
   * Run the simulation
   */
  async run(): Promise<SimulationResult> {
    const startTime = Date.now();
    const startedAt = now();

    // Initialize simulation
    await this.initialize();

    // Main simulation loop
    for (let tick = 0; tick < this.config.ticks; tick++) {
      await this.runTick(tick);

      if (this.onProgress && tick % 10 === 0) {
        this.onProgress(tick, this.config.ticks);
      }
    }

    // Collect final results
    const result = this.collectResults(startedAt, Date.now() - startTime);

    return result;
  }

  /**
   * Initialize simulation state
   */
  private async initialize(): Promise<void> {
    const rng = new SeededRandom(this.config.seed);

    this.state = {
      tick: 0,
      agents: new Map(),
      agentStates: new Map(),
      strategies: new Map(),
      cells: new Map(),
      agentCell: new Map(),
      rng,
      history: [],
      activeShocks: [],
      defectedAgents: new Set(),
      frozenAgents: new Set(),
      totalExtraction: 0,
      invariantViolations: 0,
    };

    // Create cells
    for (const cellConfig of this.config.cells) {
      const protocol = await createCellProtocol({
        cellId: cellConfig.id,
        ledgerParameters: {
          defaultLimit: cellConfig.defaultLimit,
        },
        enableFederation: this.config.federationEnabled,
        federationParameters: {
          baseBetaFactor: cellConfig.federationBeta,
        },
      });

      this.state.cells.set(cellConfig.id, protocol);
    }

    // Create agents according to distribution
    await this.createAgents();
  }

  /**
   * Create agents based on distribution config
   */
  private async createAgents(): Promise<void> {
    if (!this.state) return;

    const dist = this.config.agentDistribution;
    const rng = this.state.rng;
    let agentIndex = 0;

    // Helper to create agents of a type
    const createAgentsOfType = async (
      count: number,
      strategy: SimulatedAgent['strategy'],
      options?: { ringId?: string }
    ) => {
      for (let i = 0; i < count; i++) {
        const agentId = `agent-${agentIndex++}`;
        const agent = createSimulatedAgent(agentId, strategy, rng, {
          colluderRingId: options?.ringId,
          defectionThreshold: strategy === 'DEFECTOR' ? rng.nextInt(100, 300) : undefined,
        });

        // Assign to a cell
        const cellConfig = rng.pick(this.config.cells);
        if (!cellConfig) continue;

        const cell = this.state!.cells.get(cellConfig.id);
        if (!cell) continue;

        // Add to cell
        try {
          await cell.identity.addMember({
            applicantId: agentId,
            displayName: agent.displayName,
            publicKey: `pk_${agentId}_${'x'.repeat(32)}`,
            requestedAt: now(),
          });

          this.state!.agents.set(agentId, agent);
          this.state!.agentCell.set(agentId, cellConfig.id);
          this.state!.strategies.set(agentId, createStrategy(strategy, {
            defectionThreshold: agent.defectionThreshold,
            colluderRingId: agent.colluderRingId,
          }));

          // Initialize agent state
          const memberState = cell.ledger.getMemberState(agentId);
          if (memberState) {
            this.state!.agentStates.set(agentId, {
              agentId,
              balance: memberState.balance,
              limit: memberState.limit,
              reserve: memberState.reserve,
              needsSatisfaction: { ...DEFAULT_AGENT_NEEDS, food: 1, energy: 1, shelter: 1, medical: 1 },
              activeCommitmentsAsPromisor: 0,
              activeCommitmentsAsPromisee: 0,
              hoursWorked: 0,
              totalEarned: 0,
              totalSpent: 0,
              fulfillmentRate: 1,
              hasDefected: false,
              isFrozen: false,
              isExcluded: false,
            });
          }
        } catch (e) {
          // Agent creation failed, continue
        }
      }
    };

    // Create agents by strategy type
    await createAgentsOfType(dist.cooperators, 'COOPERATOR');
    await createAgentsOfType(dist.conditional, 'CONDITIONAL');
    await createAgentsOfType(dist.defectors, 'DEFECTOR');
    await createAgentsOfType(dist.shirkers, 'SHIRKER');
    await createAgentsOfType(dist.colluders, 'COLLUDER', { ringId: 'colluder-ring-1' });
    await createAgentsOfType(dist.sybils, 'SYBIL');
  }

  /**
   * Run a single simulation tick
   */
  private async runTick(tick: number): Promise<void> {
    if (!this.state) return;

    this.state.tick = tick;

    // 1. Process any shocks scheduled for this tick
    await this.processShocks(tick);

    // 2. Agent decision-making and actions
    await this.processAgentActions();

    // 3. Update agent states
    await this.updateAgentStates();

    // 4. Check invariants
    this.checkInvariants();

    // 5. Collect metrics (at intervals)
    if (tick % this.config.metrics.interval === 0) {
      const snapshot = this.metricsCollector.collectSnapshot(
        tick,
        this.state.cells,
        this.state.agentStates,
        this.state.defectedAgents
      );
      this.state.history.push(snapshot);
    }
  }

  /**
   * Process scheduled shocks
   */
  private async processShocks(tick: number): Promise<void> {
    if (!this.state) return;

    for (const shock of this.config.shocks) {
      if (shock.tick === tick) {
        await this.shockHandler.applyShock(shock, this.state);
        this.state.activeShocks.push(shock);
      }

      // Remove expired shocks
      if (shock.tick + shock.duration === tick) {
        await this.shockHandler.removeShock(shock, this.state);
        const index = this.state.activeShocks.indexOf(shock);
        if (index > -1) {
          this.state.activeShocks.splice(index, 1);
        }
      }
    }
  }

  /**
   * Process agent decision-making and actions
   */
  private async processAgentActions(): Promise<void> {
    if (!this.state) return;

    const rng = this.state.rng;

    // Shuffle agent order for fairness
    const agentIds = Array.from(this.state.agents.keys());
    for (let i = agentIds.length - 1; i > 0; i--) {
      const j = rng.nextInt(0, i);
      [agentIds[i], agentIds[j]] = [agentIds[j], agentIds[i]];
    }

    for (const agentId of agentIds) {
      if (this.state.frozenAgents.has(agentId)) continue;

      const agent = this.state.agents.get(agentId);
      const strategy = this.state.strategies.get(agentId);
      const agentState = this.state.agentStates.get(agentId);
      const cellId = this.state.agentCell.get(agentId);

      if (!agent || !strategy || !agentState || !cellId) continue;

      const cell = this.state.cells.get(cellId);
      if (!cell) continue;

      // Build decision context
      const context = this.buildDecisionContext(agentId, agentState);

      // Transaction decisions
      if (rng.chance(this.config.tradeFrequency / 10)) {
        await this.processTransaction(agentId, strategy, context, cell);
      }

      // Commitment decisions
      if (rng.chance(this.config.commitmentFrequency / 10)) {
        await this.processCommitment(agentId, strategy, context, cell);
      }
    }
  }

  /**
   * Build decision context for an agent
   */
  private buildDecisionContext(agentId: IdentityId, agentState: AgentState): DecisionContext {
    if (!this.state) throw new Error('Simulation not initialized');

    const cellId = this.state.agentCell.get(agentId);
    const potentialCounterparties: AgentState[] = [];
    const counterpartyReputations = new Map<IdentityId, number>();

    // Find counterparties in same cell
    for (const [id, state] of this.state.agentStates) {
      if (id !== agentId && this.state.agentCell.get(id) === cellId && !state.isFrozen) {
        potentialCounterparties.push(state);
        counterpartyReputations.set(id, state.fulfillmentRate * 100);
      }
    }

    return {
      agentState,
      potentialCounterparties,
      tick: this.state.tick,
      rng: this.state.rng,
      pendingCommitmentsAsPromisor: agentState.activeCommitmentsAsPromisor,
      pendingCommitmentsAsPromisee: agentState.activeCommitmentsAsPromisee,
      counterpartyReputations,
      isPanicMode: false, // Would check emergency engine
    };
  }

  /**
   * Process transaction decision
   */
  private async processTransaction(
    agentId: IdentityId,
    strategy: IAgentStrategy,
    context: DecisionContext,
    cell: CellProtocol
  ): Promise<void> {
    const decision = strategy.decideTransaction(context);

    if (!decision.shouldTransact || !decision.counterparty || !decision.amount) {
      return;
    }

    try {
      const payer = decision.isPayer ? agentId : decision.counterparty;
      const payee = decision.isPayer ? decision.counterparty : agentId;

      if (cell.ledger.canSpend(payer, decision.amount)) {
        await cell.ledger.applyBalanceUpdates([
          { memberId: payer, delta: -decision.amount, reason: BalanceChangeReason.SPOT_TRANSACTION_PAYER },
          { memberId: payee, delta: decision.amount, reason: BalanceChangeReason.SPOT_TRANSACTION_PAYEE },
        ]);

        // Update agent states
        const payerState = this.state?.agentStates.get(payer);
        const payeeState = this.state?.agentStates.get(payee);

        if (payerState) payerState.totalSpent += decision.amount;
        if (payeeState) payeeState.totalEarned += decision.amount;

        // Track extraction by defectors
        if (this.state?.defectedAgents.has(payee)) {
          this.state.totalExtraction += decision.amount;
        }
      }
    } catch (e) {
      // Transaction failed
    }
  }

  /**
   * Process commitment decision
   */
  private async processCommitment(
    agentId: IdentityId,
    strategy: IAgentStrategy,
    context: DecisionContext,
    cell: CellProtocol
  ): Promise<void> {
    const decision = strategy.decideCommitment(context);

    if (!decision.shouldCommit || !decision.counterparty || !decision.value) {
      return;
    }

    try {
      const promisor = decision.asPromisor ? agentId : decision.counterparty;
      const promisee = decision.asPromisor ? decision.counterparty : agentId;

      await cell.commitments.createCommitment({
        type: CommitmentType.SOFT, // Use soft for simplicity in simulation
        promisor,
        promisee,
        value: decision.value,
        category: decision.category ?? TaskCategory.GENERAL,
        description: 'Simulation commitment',
      });

      // Update commitment counts
      const promisorState = this.state?.agentStates.get(promisor);
      const promiseeState = this.state?.agentStates.get(promisee);

      if (promisorState) promisorState.activeCommitmentsAsPromisor++;
      if (promiseeState) promiseeState.activeCommitmentsAsPromisee++;
    } catch (e) {
      // Commitment creation failed
    }
  }

  /**
   * Update agent states from ledger
   */
  private async updateAgentStates(): Promise<void> {
    if (!this.state) return;

    for (const [agentId, state] of this.state.agentStates) {
      const cellId = this.state.agentCell.get(agentId);
      if (!cellId) continue;

      const cell = this.state.cells.get(cellId);
      if (!cell) continue;

      const memberState = cell.ledger.getMemberState(agentId);
      if (memberState) {
        state.balance = memberState.balance;
        state.limit = memberState.limit;
        state.reserve = memberState.reserve;
        state.isFrozen = memberState.status === MembershipStatus.FROZEN;
        state.isExcluded = memberState.status === MembershipStatus.EXCLUDED;
      }

      // Check for defection
      const agent = this.state.agents.get(agentId);
      if (agent?.strategy === 'DEFECTOR' && agent.defectionThreshold) {
        if (state.balance >= agent.defectionThreshold && !state.hasDefected) {
          state.hasDefected = true;
          this.state.defectedAgents.add(agentId);
        }
      }
    }
  }

  /**
   * Check system invariants
   */
  private checkInvariants(): void {
    if (!this.state) return;

    for (const [cellId, cell] of this.state.cells) {
      // Check conservation
      if (!cell.ledger.verifyConservation()) {
        this.state.invariantViolations++;
      }

      // Check floors
      if (!cell.ledger.verifyAllFloors()) {
        this.state.invariantViolations++;
      }
    }
  }

  /**
   * Collect final simulation results
   */
  private collectResults(startedAt: number, durationMs: number): SimulationResult {
    if (!this.state) throw new Error('Simulation not initialized');

    // Final metrics snapshot
    const finalMetrics = this.metricsCollector.collectSnapshot(
      this.state.tick,
      this.state.cells,
      this.state.agentStates,
      this.state.defectedAgents
    );

    // Calculate summary statistics
    const survivalRates = this.state.history.map(h => h.survival.survivalRate);
    const summary: SimulationSummary = {
      minSurvivalRate: Math.min(...survivalRates),
      avgSurvivalRate: survivalRates.reduce((a, b) => a + b, 0) / survivalRates.length,
      finalSurvivalRate: finalMetrics.survival.survivalRate,
      freezeProbability: this.calculateFreezeProbability(),
      totalExtraction: this.state.totalExtraction,
      contagionSize: this.calculateContagionSize(),
      invariantsMaintained: this.state.invariantViolations === 0,
      invariantViolations: this.state.invariantViolations,
      passedCriteria: this.evaluateSuccessCriteria(finalMetrics),
    };

    return {
      config: this.config,
      finalMetrics,
      history: this.state.history,
      agentStates: new Map(this.state.agentStates),
      summary,
      durationMs,
      startedAt,
      completedAt: now(),
    };
  }

  /**
   * Calculate freeze probability (seller acceptance collapse)
   */
  private calculateFreezeProbability(): number {
    if (!this.state) return 0;

    const frozenCount = this.state.frozenAgents.size;
    const totalCount = this.state.agents.size;

    return totalCount > 0 ? frozenCount / totalCount : 0;
  }

  /**
   * Calculate contagion size (cells affected by failures)
   */
  private calculateContagionSize(): number {
    if (!this.state) return 0;

    // Count cells with quarantine or PANIC state
    let affectedCells = 0;
    for (const [cellId, cell] of this.state.cells) {
      const stats = cell.ledger.getStatistics();
      if (stats.floorMass > stats.aggregateCapacity * 0.3) {
        affectedCells++;
      }
    }

    return affectedCells;
  }

  /**
   * Evaluate success criteria
   */
  private evaluateSuccessCriteria(metrics: MetricSnapshot): boolean {
    // Default criteria: survival rate >= 90%, invariants maintained
    const survivalPasses = metrics.survival.survivalRate >= 0.9;
    const invariantsPasses = this.state?.invariantViolations === 0;

    return survivalPasses && invariantsPasses;
  }
}

// ============================================
// FACTORY FUNCTIONS
// ============================================

/**
 * Create a simulation engine with default config
 */
export function createSimulationEngine(
  config: Partial<SimulationConfig> & { id: string; cells: SimulationConfig['cells']; agentDistribution: AgentDistribution }
): SimulationEngine {
  const fullConfig: SimulationConfig = {
    id: config.id,
    ticks: config.ticks ?? 100,
    tickDurationHours: config.tickDurationHours ?? 1,
    seed: config.seed ?? 42,
    cells: config.cells,
    agentDistribution: config.agentDistribution,
    shocks: config.shocks ?? [],
    metrics: config.metrics ?? {
      survival: true,
      economic: true,
      network: true,
      perAgent: false,
      interval: 10,
    },
    federationEnabled: config.federationEnabled ?? false,
    tradeFrequency: config.tradeFrequency ?? 2,
    commitmentFrequency: config.commitmentFrequency ?? 0.5,
  };

  return new SimulationEngine(fullConfig);
}

/**
 * Create a simple simulation for testing
 */
export function createSimpleSimulation(
  memberCount: number,
  ticks: number,
  seed: number = 42
): SimulationEngine {
  return createSimulationEngine({
    id: `simple-sim-${seed}`,
    ticks,
    seed,
    cells: [{
      id: 'test-cell',
      initialMembers: memberCount,
      defaultLimit: 100,
      federationBeta: 0.3,
    }],
    agentDistribution: {
      cooperators: Math.floor(memberCount * 0.6),
      conditional: Math.floor(memberCount * 0.2),
      defectors: Math.floor(memberCount * 0.1),
      shirkers: Math.floor(memberCount * 0.05),
      colluders: Math.floor(memberCount * 0.03),
      sybils: Math.floor(memberCount * 0.02),
    },
  });
}
