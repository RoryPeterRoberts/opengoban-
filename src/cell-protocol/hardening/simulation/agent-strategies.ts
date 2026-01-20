/**
 * Cell Protocol - Hardening: Agent Strategies
 *
 * Implements agent behavioral strategies for economic simulation.
 * Each strategy defines how an agent makes decisions about transactions,
 * commitments, and cooperation.
 */

import { IdentityId, Units } from '../../types/common';
import { TaskCategory } from '../../types/commitment';
import {
  AgentStrategy,
  SimulatedAgent,
  AgentState,
  AgentNeeds,
  AgentSkills,
  DEFAULT_AGENT_NEEDS,
  DEFAULT_AGENT_SKILLS,
} from '../types/simulation';
import { SeededRandom } from '../generators/operation-generator';

// ============================================
// DECISION TYPES
// ============================================

/** Decision to initiate a transaction */
export interface TransactionDecision {
  shouldTransact: boolean;
  counterparty?: IdentityId;
  amount?: Units;
  isPayer: boolean;
}

/** Decision to create/accept a commitment */
export interface CommitmentDecision {
  shouldCommit: boolean;
  asPromisor: boolean;
  value?: Units;
  category?: TaskCategory;
  counterparty?: IdentityId;
}

/** Decision to fulfill a commitment */
export interface FulfillmentDecision {
  shouldFulfill: boolean;
  quality: number; // 1-5, quality of work
  delay: number; // Ticks to delay
}

/** Decision context for making choices */
export interface DecisionContext {
  /** Current agent state */
  agentState: AgentState;
  /** Available counterparties */
  potentialCounterparties: AgentState[];
  /** Current simulation tick */
  tick: number;
  /** Random number generator */
  rng: SeededRandom;
  /** Agent's commitments as promisor */
  pendingCommitmentsAsPromisor: number;
  /** Agent's commitments as promisee */
  pendingCommitmentsAsPromisee: number;
  /** Reputation scores of counterparties */
  counterpartyReputations: Map<IdentityId, number>;
  /** Whether this is PANIC mode */
  isPanicMode: boolean;
}

// ============================================
// BASE STRATEGY INTERFACE
// ============================================

export interface IAgentStrategy {
  /** Strategy type */
  type: AgentStrategy;

  /** Decide whether to transact */
  decideTransaction(context: DecisionContext): TransactionDecision;

  /** Decide whether to create/accept commitment */
  decideCommitment(context: DecisionContext): CommitmentDecision;

  /** Decide whether to fulfill a commitment */
  decideFulfillment(context: DecisionContext): FulfillmentDecision;

  /** Decide whether to cooperate in general */
  willCooperate(context: DecisionContext, counterparty: IdentityId): boolean;
}

// ============================================
// COOPERATOR STRATEGY
// ============================================

/**
 * COOPERATOR: Always cooperates, honors all agreements
 * - High fulfillment rate
 * - Accepts commitments readily
 * - Good quality work
 */
export class CooperatorStrategy implements IAgentStrategy {
  type: AgentStrategy = 'COOPERATOR';

  decideTransaction(context: DecisionContext): TransactionDecision {
    const { rng, potentialCounterparties, agentState } = context;

    // Cooperators transact when they have needs or surplus
    if (potentialCounterparties.length === 0) {
      return { shouldTransact: false, isPayer: false };
    }

    // 70% chance to initiate transaction
    if (!rng.chance(0.7)) {
      return { shouldTransact: false, isPayer: false };
    }

    const counterparty = rng.pick(potentialCounterparties);
    if (!counterparty) return { shouldTransact: false, isPayer: false };

    // Decide if paying or receiving based on balance
    const isPayer = agentState.balance > 0 || rng.chance(0.5);
    const maxAmount = isPayer
      ? Math.min(agentState.balance + agentState.limit - agentState.reserve, 50)
      : 50;

    const amount = rng.nextInt(1, Math.max(1, maxAmount));

    return {
      shouldTransact: true,
      counterparty: counterparty.agentId,
      amount,
      isPayer,
    };
  }

  decideCommitment(context: DecisionContext): CommitmentDecision {
    const { rng, potentialCounterparties } = context;

    // 60% chance to create commitment
    if (!rng.chance(0.6) || potentialCounterparties.length === 0) {
      return { shouldCommit: false, asPromisor: false };
    }

    const counterparty = rng.pick(potentialCounterparties);
    const asPromisor = rng.chance(0.5);

    return {
      shouldCommit: true,
      asPromisor,
      value: rng.nextInt(10, 50),
      category: TaskCategory.GENERAL,
      counterparty: counterparty?.agentId,
    };
  }

  decideFulfillment(context: DecisionContext): FulfillmentDecision {
    // Cooperators always fulfill with high quality
    return {
      shouldFulfill: true,
      quality: context.rng.nextInt(4, 5), // 4-5 quality
      delay: 0,
    };
  }

  willCooperate(): boolean {
    return true; // Always cooperates
  }
}

// ============================================
// CONDITIONAL STRATEGY
// ============================================

/**
 * CONDITIONAL: Tit-for-tat, reputation-threshold
 * - Cooperates with high-reputation members
 * - Defects against low-reputation members
 * - Mirrors previous behavior
 */
export class ConditionalStrategy implements IAgentStrategy {
  type: AgentStrategy = 'CONDITIONAL';
  private reputationThreshold = 50;
  private history: Map<IdentityId, boolean[]> = new Map();

  decideTransaction(context: DecisionContext): TransactionDecision {
    const { rng, potentialCounterparties, counterpartyReputations } = context;

    // Filter for good reputation counterparties
    const goodPartners = potentialCounterparties.filter(p => {
      const rep = counterpartyReputations.get(p.agentId) ?? 50;
      return rep >= this.reputationThreshold;
    });

    if (goodPartners.length === 0 || !rng.chance(0.5)) {
      return { shouldTransact: false, isPayer: false };
    }

    const counterparty = rng.pick(goodPartners);
    if (!counterparty) return { shouldTransact: false, isPayer: false };

    return {
      shouldTransact: true,
      counterparty: counterparty.agentId,
      amount: rng.nextInt(5, 30),
      isPayer: rng.chance(0.5),
    };
  }

  decideCommitment(context: DecisionContext): CommitmentDecision {
    const { rng, potentialCounterparties, counterpartyReputations } = context;

    const goodPartners = potentialCounterparties.filter(p => {
      const rep = counterpartyReputations.get(p.agentId) ?? 50;
      return rep >= this.reputationThreshold;
    });

    if (goodPartners.length === 0 || !rng.chance(0.4)) {
      return { shouldCommit: false, asPromisor: false };
    }

    const counterparty = rng.pick(goodPartners);

    return {
      shouldCommit: true,
      asPromisor: rng.chance(0.5),
      value: rng.nextInt(10, 40),
      category: TaskCategory.GENERAL,
      counterparty: counterparty?.agentId,
    };
  }

  decideFulfillment(context: DecisionContext): FulfillmentDecision {
    // Fulfill based on counterparty's past behavior (tit-for-tat)
    // Simplified: 90% chance to fulfill
    const shouldFulfill = context.rng.chance(0.9);

    return {
      shouldFulfill,
      quality: shouldFulfill ? context.rng.nextInt(3, 5) : 1,
      delay: shouldFulfill ? 0 : context.rng.nextInt(1, 5),
    };
  }

  willCooperate(context: DecisionContext, counterparty: IdentityId): boolean {
    const rep = context.counterpartyReputations.get(counterparty) ?? 50;
    if (rep < this.reputationThreshold) return false;

    // Check history
    const history = this.history.get(counterparty) ?? [];
    if (history.length === 0) return true; // Cooperate first

    // Tit-for-tat: do what they did last
    return history[history.length - 1];
  }
}

// ============================================
// DEFECTOR STRATEGY
// ============================================

/**
 * DEFECTOR: Accumulates balance, defects at threshold
 * - Takes advantage of trust
 * - Builds up positive balance then extracts
 * - May suddenly defect
 */
export class DefectorStrategy implements IAgentStrategy {
  type: AgentStrategy = 'DEFECTOR';
  private defectionThreshold: Units;
  private hasDefected = false;

  constructor(defectionThreshold: Units = 200) {
    this.defectionThreshold = defectionThreshold;
  }

  decideTransaction(context: DecisionContext): TransactionDecision {
    const { rng, potentialCounterparties, agentState } = context;

    if (potentialCounterparties.length === 0) {
      return { shouldTransact: false, isPayer: false };
    }

    // If haven't defected yet, try to accumulate
    if (!this.hasDefected && agentState.balance < this.defectionThreshold) {
      // Receive transactions, not pay
      const counterparty = rng.pick(potentialCounterparties);
      return {
        shouldTransact: rng.chance(0.8),
        counterparty: counterparty?.agentId,
        amount: rng.nextInt(10, 50),
        isPayer: false, // Always receive
      };
    }

    // Check if should defect
    if (!this.hasDefected && agentState.balance >= this.defectionThreshold) {
      this.hasDefected = true;
    }

    // After defection, try to extract maximum
    if (this.hasDefected) {
      const counterparty = rng.pick(potentialCounterparties);
      return {
        shouldTransact: rng.chance(0.9),
        counterparty: counterparty?.agentId,
        amount: rng.nextInt(20, 100), // Large extractions
        isPayer: false,
      };
    }

    return { shouldTransact: false, isPayer: false };
  }

  decideCommitment(context: DecisionContext): CommitmentDecision {
    const { rng, potentialCounterparties } = context;

    if (this.hasDefected) {
      // After defection, don't create commitments
      return { shouldCommit: false, asPromisor: false };
    }

    // Before defection, appear cooperative
    if (potentialCounterparties.length === 0 || !rng.chance(0.6)) {
      return { shouldCommit: false, asPromisor: false };
    }

    const counterparty = rng.pick(potentialCounterparties);

    return {
      shouldCommit: true,
      asPromisor: true, // Pretend to provide services
      value: rng.nextInt(20, 60),
      category: TaskCategory.GENERAL,
      counterparty: counterparty?.agentId,
    };
  }

  decideFulfillment(context: DecisionContext): FulfillmentDecision {
    // Before defection: appear reliable
    // After defection: don't fulfill
    if (this.hasDefected) {
      return {
        shouldFulfill: false,
        quality: 1,
        delay: 999, // Never fulfill
      };
    }

    return {
      shouldFulfill: true,
      quality: context.rng.nextInt(3, 4), // Decent quality to build trust
      delay: 0,
    };
  }

  willCooperate(): boolean {
    return !this.hasDefected;
  }

  /** Check if agent has defected */
  checkDefection(balance: Units): boolean {
    if (!this.hasDefected && balance >= this.defectionThreshold) {
      this.hasDefected = true;
    }
    return this.hasDefected;
  }
}

// ============================================
// SHIRKER STRATEGY
// ============================================

/**
 * SHIRKER: Low quality, delays fulfillment
 * - Does minimum work
 * - Often late
 * - May not fully complete tasks
 */
export class ShirkerStrategy implements IAgentStrategy {
  type: AgentStrategy = 'SHIRKER';

  decideTransaction(context: DecisionContext): TransactionDecision {
    const { rng, potentialCounterparties } = context;

    if (potentialCounterparties.length === 0 || !rng.chance(0.4)) {
      return { shouldTransact: false, isPayer: false };
    }

    const counterparty = rng.pick(potentialCounterparties);

    return {
      shouldTransact: true,
      counterparty: counterparty?.agentId,
      amount: rng.nextInt(5, 20),
      isPayer: rng.chance(0.3), // Prefers receiving
    };
  }

  decideCommitment(context: DecisionContext): CommitmentDecision {
    const { rng, potentialCounterparties } = context;

    // Shirkers take on commitments but don't deliver well
    if (potentialCounterparties.length === 0 || !rng.chance(0.5)) {
      return { shouldCommit: false, asPromisor: false };
    }

    const counterparty = rng.pick(potentialCounterparties);

    return {
      shouldCommit: true,
      asPromisor: rng.chance(0.7), // Often takes on work
      value: rng.nextInt(10, 40),
      category: TaskCategory.GENERAL,
      counterparty: counterparty?.agentId,
    };
  }

  decideFulfillment(context: DecisionContext): FulfillmentDecision {
    const { rng } = context;

    // 70% chance to eventually fulfill, but low quality and delayed
    const shouldFulfill = rng.chance(0.7);

    return {
      shouldFulfill,
      quality: rng.nextInt(1, 3), // Low quality
      delay: rng.nextInt(2, 10), // Always delayed
    };
  }

  willCooperate(context: DecisionContext): boolean {
    return context.rng.chance(0.5);
  }
}

// ============================================
// COLLUDER STRATEGY
// ============================================

/**
 * COLLUDER: Coordinates with ring members
 * - Forms alliances with other colluders
 * - Pumps mutual credit limits
 * - May coordinate extraction
 */
export class ColluderStrategy implements IAgentStrategy {
  type: AgentStrategy = 'COLLUDER';
  private ringId: string;
  private ringMembers: Set<IdentityId> = new Set();

  constructor(ringId: string) {
    this.ringId = ringId;
  }

  addRingMember(memberId: IdentityId): void {
    this.ringMembers.add(memberId);
  }

  isRingMember(memberId: IdentityId): boolean {
    return this.ringMembers.has(memberId);
  }

  decideTransaction(context: DecisionContext): TransactionDecision {
    const { rng, potentialCounterparties } = context;

    // Prefer transacting with ring members
    const ringPartners = potentialCounterparties.filter(p =>
      this.ringMembers.has(p.agentId)
    );

    const partners = ringPartners.length > 0 ? ringPartners : potentialCounterparties;
    if (partners.length === 0) {
      return { shouldTransact: false, isPayer: false };
    }

    const counterparty = rng.pick(partners);
    const isRingTx = this.ringMembers.has(counterparty?.agentId ?? '');

    return {
      shouldTransact: rng.chance(isRingTx ? 0.9 : 0.4),
      counterparty: counterparty?.agentId,
      amount: rng.nextInt(10, isRingTx ? 100 : 30), // Larger with ring
      isPayer: rng.chance(0.5),
    };
  }

  decideCommitment(context: DecisionContext): CommitmentDecision {
    const { rng, potentialCounterparties } = context;

    const ringPartners = potentialCounterparties.filter(p =>
      this.ringMembers.has(p.agentId)
    );

    // More likely to commit with ring members
    if (ringPartners.length > 0 && rng.chance(0.8)) {
      const counterparty = rng.pick(ringPartners);
      return {
        shouldCommit: true,
        asPromisor: rng.chance(0.5),
        value: rng.nextInt(30, 80), // Large mutual commitments
        category: TaskCategory.GENERAL,
        counterparty: counterparty?.agentId,
      };
    }

    // Lower chance with non-ring members
    if (potentialCounterparties.length > 0 && rng.chance(0.3)) {
      const counterparty = rng.pick(potentialCounterparties);
      return {
        shouldCommit: true,
        asPromisor: rng.chance(0.5),
        value: rng.nextInt(10, 30),
        category: TaskCategory.GENERAL,
        counterparty: counterparty?.agentId,
      };
    }

    return { shouldCommit: false, asPromisor: false };
  }

  decideFulfillment(context: DecisionContext): FulfillmentDecision {
    // Always fulfill with ring members, sometimes with others
    // Assuming we don't know who the counterparty is here
    return {
      shouldFulfill: context.rng.chance(0.7),
      quality: context.rng.nextInt(2, 4),
      delay: context.rng.nextInt(0, 2),
    };
  }

  willCooperate(context: DecisionContext, counterparty: IdentityId): boolean {
    // Always cooperate with ring members
    if (this.ringMembers.has(counterparty)) return true;
    return context.rng.chance(0.4);
  }
}

// ============================================
// SYBIL STRATEGY
// ============================================

/**
 * SYBIL: Attempts multiple identities
 * - Creates additional accounts
 * - Coordinates between identities
 * - Attempts to extract value
 */
export class SybilStrategy implements IAgentStrategy {
  type: AgentStrategy = 'SYBIL';
  private sybilIdentities: Set<IdentityId> = new Set();
  private parentId?: IdentityId;

  constructor(parentId?: IdentityId) {
    this.parentId = parentId;
  }

  addSybilIdentity(id: IdentityId): void {
    this.sybilIdentities.add(id);
  }

  isSybilIdentity(id: IdentityId): boolean {
    return this.sybilIdentities.has(id) || id === this.parentId;
  }

  decideTransaction(context: DecisionContext): TransactionDecision {
    const { rng, potentialCounterparties } = context;

    // Coordinate with other sybil identities
    const sybilPartners = potentialCounterparties.filter(p =>
      this.sybilIdentities.has(p.agentId)
    );

    if (sybilPartners.length > 0 && rng.chance(0.9)) {
      const counterparty = rng.pick(sybilPartners);
      return {
        shouldTransact: true,
        counterparty: counterparty?.agentId,
        amount: rng.nextInt(20, 80),
        isPayer: rng.chance(0.5),
      };
    }

    // Transaction with non-sybils: extract value
    if (potentialCounterparties.length > 0 && rng.chance(0.6)) {
      const counterparty = rng.pick(potentialCounterparties);
      return {
        shouldTransact: true,
        counterparty: counterparty?.agentId,
        amount: rng.nextInt(10, 40),
        isPayer: false, // Prefer receiving
      };
    }

    return { shouldTransact: false, isPayer: false };
  }

  decideCommitment(context: DecisionContext): CommitmentDecision {
    const { rng, potentialCounterparties } = context;

    if (potentialCounterparties.length === 0 || !rng.chance(0.5)) {
      return { shouldCommit: false, asPromisor: false };
    }

    const counterparty = rng.pick(potentialCounterparties);

    return {
      shouldCommit: true,
      asPromisor: rng.chance(0.6),
      value: rng.nextInt(15, 45),
      category: TaskCategory.GENERAL,
      counterparty: counterparty?.agentId,
    };
  }

  decideFulfillment(context: DecisionContext): FulfillmentDecision {
    // May or may not fulfill
    const shouldFulfill = context.rng.chance(0.5);
    return {
      shouldFulfill,
      quality: shouldFulfill ? context.rng.nextInt(2, 4) : 1,
      delay: shouldFulfill ? context.rng.nextInt(0, 3) : context.rng.nextInt(5, 20),
    };
  }

  willCooperate(context: DecisionContext, counterparty: IdentityId): boolean {
    // Always cooperate with sybil identities
    if (this.sybilIdentities.has(counterparty)) return true;
    return context.rng.chance(0.3);
  }
}

// ============================================
// STRATEGY FACTORY
// ============================================

/**
 * Create a strategy instance for an agent type
 */
export function createStrategy(
  type: AgentStrategy,
  options?: {
    defectionThreshold?: Units;
    colluderRingId?: string;
    sybilParentId?: IdentityId;
  }
): IAgentStrategy {
  switch (type) {
    case 'COOPERATOR':
      return new CooperatorStrategy();
    case 'CONDITIONAL':
      return new ConditionalStrategy();
    case 'DEFECTOR':
      return new DefectorStrategy(options?.defectionThreshold);
    case 'SHIRKER':
      return new ShirkerStrategy();
    case 'COLLUDER':
      return new ColluderStrategy(options?.colluderRingId ?? 'default-ring');
    case 'SYBIL':
      return new SybilStrategy(options?.sybilParentId);
    default:
      return new CooperatorStrategy();
  }
}

// ============================================
// AGENT FACTORY
// ============================================

/**
 * Create a simulated agent with given strategy
 */
export function createSimulatedAgent(
  id: IdentityId,
  strategy: AgentStrategy,
  rng: SeededRandom,
  options?: {
    needs?: Partial<AgentNeeds>;
    skills?: Partial<AgentSkills>;
    laborSupply?: number;
    defectionThreshold?: Units;
    colluderRingId?: string;
    sybilParent?: IdentityId;
  }
): SimulatedAgent {
  const needs: AgentNeeds = {
    ...DEFAULT_AGENT_NEEDS,
    ...options?.needs,
  };

  const skills: AgentSkills = {
    ...DEFAULT_AGENT_SKILLS,
    // Add some variance
    cooking: Math.min(1, DEFAULT_AGENT_SKILLS.cooking + rng.nextFloat(-0.2, 0.2)),
    farming: Math.min(1, DEFAULT_AGENT_SKILLS.farming + rng.nextFloat(-0.2, 0.2)),
    repair: Math.min(1, DEFAULT_AGENT_SKILLS.repair + rng.nextFloat(-0.2, 0.2)),
    medical: Math.min(1, DEFAULT_AGENT_SKILLS.medical + rng.nextFloat(-0.1, 0.1)),
    energy: Math.min(1, DEFAULT_AGENT_SKILLS.energy + rng.nextFloat(-0.2, 0.2)),
    ...options?.skills,
  };

  return {
    id,
    strategy,
    displayName: `Agent ${id}`,
    needs,
    skills,
    laborSupply: options?.laborSupply ?? rng.nextInt(10, 40),
    defectionThreshold: options?.defectionThreshold,
    colluderRingId: options?.colluderRingId,
    sybilParent: options?.sybilParent,
  };
}
