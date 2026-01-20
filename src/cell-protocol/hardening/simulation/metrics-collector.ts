/**
 * Cell Protocol - Hardening: Metrics Collector
 *
 * Collects and computes simulation metrics.
 * Tracks survival, economic, and network indicators.
 */

import { CellId, IdentityId, Units, Timestamp, now } from '../../types/common';
import { CellProtocol } from '../../index';
import {
  MetricSnapshot,
  SurvivalMetrics,
  EconomicMetrics,
  NetworkMetrics,
  CellMetrics,
  AgentState,
  DEFAULT_AGENT_NEEDS,
} from '../types/simulation';

// ============================================
// METRICS COLLECTOR
// ============================================

/**
 * Collects simulation metrics at regular intervals
 */
export class MetricsCollector {
  private transactionVolume: Units = 0;
  private commitmentsCreated = 0;
  private fulfillmentCount = 0;
  private totalCommitments = 0;
  private federationVolume: Units = 0;

  /**
   * Record a transaction
   */
  recordTransaction(amount: Units): void {
    this.transactionVolume += amount;
  }

  /**
   * Record a commitment creation
   */
  recordCommitmentCreated(): void {
    this.commitmentsCreated++;
    this.totalCommitments++;
  }

  /**
   * Record a commitment fulfillment
   */
  recordFulfillment(): void {
    this.fulfillmentCount++;
  }

  /**
   * Record federation transaction
   */
  recordFederationTx(amount: Units): void {
    this.federationVolume += amount;
  }

  /**
   * Reset periodic counters
   */
  resetPeriodic(): void {
    this.transactionVolume = 0;
    this.commitmentsCreated = 0;
    this.fulfillmentCount = 0;
    this.federationVolume = 0;
  }

  /**
   * Collect a complete metrics snapshot
   */
  collectSnapshot(
    tick: number,
    cells: Map<CellId, CellProtocol>,
    agentStates: Map<IdentityId, AgentState>,
    defectedAgents: Set<IdentityId>
  ): MetricSnapshot {
    const timestamp = now();

    // Collect per-cell metrics
    const perCell = new Map<CellId, CellMetrics>();
    for (const [cellId, cell] of cells) {
      perCell.set(cellId, this.collectCellMetrics(cellId, cell));
    }

    // Collect aggregate metrics
    const survival = this.collectSurvivalMetrics(agentStates);
    const economic = this.collectEconomicMetrics(agentStates, defectedAgents);
    const network = this.collectNetworkMetrics(cells);

    // Reset periodic counters
    this.resetPeriodic();

    return {
      tick,
      timestamp,
      survival,
      economic,
      network,
      perCell,
    };
  }

  /**
   * Collect survival metrics
   */
  private collectSurvivalMetrics(
    agentStates: Map<IdentityId, AgentState>
  ): SurvivalMetrics {
    const agents = Array.from(agentStates.values()).filter(a => !a.isExcluded);
    const totalAgents = agents.length;

    if (totalAgents === 0) {
      return {
        survivalRate: 1,
        agentsSurviving: 0,
        totalAgents: 0,
        avgNeedsSatisfaction: 1,
        agentsBelowFloor: 0,
      };
    }

    // Count agents meeting minimum needs
    const minSatisfaction = 0.5; // 50% satisfaction = survival threshold
    const agentsSurviving = agents.filter(a => {
      const avgSatisfaction = (
        a.needsSatisfaction.food +
        a.needsSatisfaction.energy +
        a.needsSatisfaction.shelter +
        a.needsSatisfaction.medical
      ) / 4;
      return avgSatisfaction >= minSatisfaction;
    }).length;

    // Calculate average needs satisfaction
    const totalSatisfaction = agents.reduce((sum, a) => {
      return sum + (
        a.needsSatisfaction.food +
        a.needsSatisfaction.energy +
        a.needsSatisfaction.shelter +
        a.needsSatisfaction.medical
      ) / 4;
    }, 0);

    // Count agents below humanitarian floor
    const agentsBelowFloor = agents.filter(a => {
      const avgSatisfaction = (
        a.needsSatisfaction.food +
        a.needsSatisfaction.energy +
        a.needsSatisfaction.shelter +
        a.needsSatisfaction.medical
      ) / 4;
      return avgSatisfaction < 0.3; // Below humanitarian floor
    }).length;

    return {
      survivalRate: agentsSurviving / totalAgents,
      agentsSurviving,
      totalAgents,
      avgNeedsSatisfaction: totalSatisfaction / totalAgents,
      agentsBelowFloor,
    };
  }

  /**
   * Collect economic metrics
   */
  private collectEconomicMetrics(
    agentStates: Map<IdentityId, AgentState>,
    defectedAgents: Set<IdentityId>
  ): EconomicMetrics {
    const agents = Array.from(agentStates.values()).filter(a => !a.isExcluded);
    const totalAgents = agents.length;

    if (totalAgents === 0) {
      return {
        transactionVolume: 0,
        commitmentsCreated: 0,
        fulfillmentRate: 1,
        avgBalance: 0,
        giniCoefficient: 0,
        velocity: 0,
        agentsAtFloor: 0,
        defectorExtraction: 0,
      };
    }

    // Calculate average balance
    const totalBalance = agents.reduce((sum, a) => sum + a.balance, 0);
    const avgBalance = totalBalance / totalAgents;

    // Calculate Gini coefficient
    const giniCoefficient = this.calculateGini(agents.map(a => a.balance));

    // Calculate fulfillment rate
    const fulfillmentRate = this.totalCommitments > 0
      ? this.fulfillmentCount / this.totalCommitments
      : 1;

    // Count agents at floor
    const agentsAtFloor = agents.filter(a => a.balance <= -a.limit * 0.95).length;

    // Calculate defector extraction
    const defectorExtraction = Array.from(defectedAgents)
      .map(id => agentStates.get(id))
      .filter((a): a is AgentState => a !== undefined)
      .reduce((sum, a) => sum + Math.max(0, a.totalEarned - a.totalSpent), 0);

    // Calculate velocity (transactions per unit per tick)
    const totalCapacity = agents.reduce((sum, a) => sum + a.limit, 0);
    const velocity = totalCapacity > 0 ? this.transactionVolume / totalCapacity : 0;

    return {
      transactionVolume: this.transactionVolume,
      commitmentsCreated: this.commitmentsCreated,
      fulfillmentRate,
      avgBalance,
      giniCoefficient,
      velocity,
      agentsAtFloor,
      defectorExtraction,
    };
  }

  /**
   * Collect network/federation metrics
   */
  private collectNetworkMetrics(cells: Map<CellId, CellProtocol>): NetworkMetrics {
    let activeFederationLinks = 0;
    let totalPosition: Units = 0;
    let positionCount = 0;
    let cellsInQuarantine = 0;
    let potentialLinks = 0;

    for (const [cellId, cell] of cells) {
      if (!cell.federation) continue;

      const links = cell.federation.getConnectedCells();
      activeFederationLinks += links.filter(l => l.status === 'ACTIVE').length;
      potentialLinks += cells.size - 1; // All possible links

      const position = cell.federation.getPosition();
      totalPosition += Math.abs(position);
      positionCount++;

      const quarantine = cell.federation.checkQuarantineStatus();
      if (quarantine.isQuarantined) {
        cellsInQuarantine++;
      }
    }

    // Connectivity is ratio of active links to potential links
    const connectivity = potentialLinks > 0 ? activeFederationLinks / potentialLinks : 1;

    return {
      activeFederationLinks,
      federationVolume: this.federationVolume,
      avgFederationPosition: positionCount > 0 ? totalPosition / positionCount : 0,
      cellsInQuarantine,
      connectivity,
    };
  }

  /**
   * Collect per-cell metrics
   */
  private collectCellMetrics(cellId: CellId, cell: CellProtocol): CellMetrics {
    const stats = cell.ledger.getStatistics();
    const federationPosition = cell.federation?.getPosition();

    // Check emergency state
    let riskState = 'CALM';
    try {
      riskState = cell.emergency.getCurrentRiskState();
    } catch (e) {
      // Emergency engine not available
    }

    return {
      cellId,
      memberCount: stats.memberCount,
      activeMemberCount: stats.activeMemberCount,
      balanceSum: stats.balanceSum,
      totalCapacity: stats.aggregateCapacity,
      conservationHolds: Math.abs(stats.balanceSum) < 0.001,
      floorsHold: cell.ledger.verifyAllFloors(),
      federationPosition,
      riskState,
    };
  }

  /**
   * Calculate Gini coefficient (inequality measure)
   */
  private calculateGini(values: number[]): number {
    if (values.length === 0) return 0;

    // Normalize to positive values for Gini calculation
    const minValue = Math.min(...values);
    const normalized = values.map(v => v - minValue + 1);

    const n = normalized.length;
    const sorted = [...normalized].sort((a, b) => a - b);

    let numerator = 0;
    for (let i = 0; i < n; i++) {
      numerator += (2 * (i + 1) - n - 1) * sorted[i];
    }

    const sum = sorted.reduce((a, b) => a + b, 0);
    if (sum === 0) return 0;

    return numerator / (n * sum);
  }
}

// ============================================
// FACTORY FUNCTION
// ============================================

/**
 * Create a metrics collector
 */
export function createMetricsCollector(): MetricsCollector {
  return new MetricsCollector();
}
