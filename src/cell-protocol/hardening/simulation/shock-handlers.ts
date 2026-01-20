/**
 * Cell Protocol - Hardening: Shock Handlers
 *
 * Processes economic shocks during simulation.
 * Applies and removes various types of system disruptions.
 */

import { IdentityId, CellId } from '../../types/common';
import { MembershipStatus } from '../../types/common';
import {
  ShockEvent,
  ShockType,
  ResourceScarcityParams,
  DefectionWaveParams,
  FederationSeveranceParams,
  SybilInfiltrationParams,
  GovernanceCaptureParams,
  ConnectivityLossParams,
  SimulatedAgent,
  AgentState,
} from '../types/simulation';
import { CellProtocol } from '../../index';
import { SeededRandom } from '../generators/operation-generator';

// ============================================
// INTERNAL STATE TYPE
// ============================================

/** Simulation state interface for shock handler */
interface SimulationState {
  tick: number;
  agents: Map<IdentityId, SimulatedAgent>;
  agentStates: Map<IdentityId, AgentState>;
  cells: Map<CellId, CellProtocol>;
  agentCell: Map<IdentityId, CellId>;
  rng: SeededRandom;
  defectedAgents: Set<IdentityId>;
  frozenAgents: Set<IdentityId>;
  activeShocks: ShockEvent[];
}

// ============================================
// SHOCK HANDLER
// ============================================

/**
 * Handles application and removal of economic shocks
 */
export class ShockHandler {
  private originalStates: Map<string, unknown> = new Map();

  /**
   * Apply a shock to the simulation
   */
  async applyShock(shock: ShockEvent, state: SimulationState): Promise<void> {
    switch (shock.type) {
      case 'RESOURCE_SCARCITY':
        await this.applyResourceScarcity(shock, state);
        break;
      case 'DEFECTION_WAVE':
        await this.applyDefectionWave(shock, state);
        break;
      case 'FEDERATION_SEVERANCE':
        await this.applyFederationSeverance(shock, state);
        break;
      case 'SYBIL_INFILTRATION':
        await this.applySybilInfiltration(shock, state);
        break;
      case 'GOVERNANCE_CAPTURE':
        await this.applyGovernanceCapture(shock, state);
        break;
      case 'CONNECTIVITY_LOSS':
        await this.applyConnectivityLoss(shock, state);
        break;
    }
  }

  /**
   * Remove a shock (restore original state if applicable)
   */
  async removeShock(shock: ShockEvent, state: SimulationState): Promise<void> {
    const key = `${shock.type}-${shock.tick}`;

    switch (shock.type) {
      case 'RESOURCE_SCARCITY':
        // Resources stay reduced (they don't magically come back)
        break;
      case 'DEFECTION_WAVE':
        // Defectors don't revert
        break;
      case 'FEDERATION_SEVERANCE':
        await this.removeFederationSeverance(shock, state);
        break;
      case 'CONNECTIVITY_LOSS':
        await this.removeConnectivityLoss(shock, state);
        break;
      // Other shocks have permanent effects
    }

    this.originalStates.delete(key);
  }

  /**
   * RESOURCE_SCARCITY: Reduce available resources
   */
  private async applyResourceScarcity(
    shock: ShockEvent,
    state: SimulationState
  ): Promise<void> {
    const params = shock.parameters as ResourceScarcityParams;

    // For simulation purposes, we reduce agent needs satisfaction
    // In a full implementation, this would affect the energy engine

    for (const [agentId, agentState] of state.agentStates) {
      // Reduce satisfaction based on shock intensity
      const reduction = params.reductionFactor * shock.intensity;

      agentState.needsSatisfaction.food *= (1 - reduction);
      agentState.needsSatisfaction.energy *= (1 - reduction);
    }
  }

  /**
   * DEFECTION_WAVE: Convert agents to defectors
   */
  private async applyDefectionWave(
    shock: ShockEvent,
    state: SimulationState
  ): Promise<void> {
    const params = shock.parameters as DefectionWaveParams;

    // Determine which agents to convert
    let agentsToConvert: IdentityId[];

    if (params.targetAgents && params.targetAgents.length > 0) {
      agentsToConvert = params.targetAgents;
    } else {
      // Select random percentage of agents
      const allAgents = Array.from(state.agents.keys());
      const count = Math.floor(allAgents.length * params.defectionRate);

      // Shuffle and take first N
      for (let i = allAgents.length - 1; i > 0; i--) {
        const j = state.rng.nextInt(0, i);
        [allAgents[i], allAgents[j]] = [allAgents[j], allAgents[i]];
      }

      agentsToConvert = allAgents.slice(0, count);
    }

    // Convert agents to defectors
    for (const agentId of agentsToConvert) {
      const agent = state.agents.get(agentId);
      const agentState = state.agentStates.get(agentId);

      if (agent && agentState && !state.defectedAgents.has(agentId)) {
        // Mark as defected
        state.defectedAgents.add(agentId);
        agentState.hasDefected = true;
      }
    }
  }

  /**
   * FEDERATION_SEVERANCE: Cut federation links
   */
  private async applyFederationSeverance(
    shock: ShockEvent,
    state: SimulationState
  ): Promise<void> {
    const params = shock.parameters as FederationSeveranceParams;
    const key = `${shock.type}-${shock.tick}`;

    // Store original federation state
    const originalLinks: Map<CellId, CellId[]> = new Map();

    for (const [cellId, cell] of state.cells) {
      if (!cell.federation) continue;

      const links = cell.federation.getConnectedCells();
      originalLinks.set(cellId, links.map(l => l.remoteCellId));

      // Suspend all links (or specific ones)
      for (const link of links) {
        if (!params.isolatedCells || params.isolatedCells.includes(cellId)) {
          try {
            await cell.federation.suspendLink(link.remoteCellId, 'Shock: federation severance');
          } catch (e) {
            // Link suspension failed
          }
        }
      }
    }

    this.originalStates.set(key, originalLinks);
  }

  /**
   * Remove FEDERATION_SEVERANCE: Restore links
   */
  private async removeFederationSeverance(
    shock: ShockEvent,
    state: SimulationState
  ): Promise<void> {
    const key = `${shock.type}-${shock.tick}`;
    const originalLinks = this.originalStates.get(key) as Map<CellId, CellId[]> | undefined;

    if (!originalLinks) return;

    for (const [cellId, remoteCells] of originalLinks) {
      const cell = state.cells.get(cellId);
      if (!cell?.federation) continue;

      for (const remoteCellId of remoteCells) {
        try {
          await cell.federation.resumeLink(remoteCellId);
        } catch (e) {
          // Link resumption failed
        }
      }
    }
  }

  /**
   * SYBIL_INFILTRATION: Attempt to add multiple fake identities
   */
  private async applySybilInfiltration(
    shock: ShockEvent,
    state: SimulationState
  ): Promise<void> {
    const params = shock.parameters as SybilInfiltrationParams;

    // Sybil attacks attempt to create multiple identities with a budget
    // The Sybil resistance mechanisms should limit success

    let budgetRemaining = params.budget;
    let sybilsAdmitted = 0;

    for (let i = 0; i < params.targetCount && budgetRemaining > 0; i++) {
      // Pick a random cell to attack
      const cellIds = Array.from(state.cells.keys());
      const targetCellId = state.rng.pick(cellIds);
      if (!targetCellId) continue;

      const cell = state.cells.get(targetCellId);
      if (!cell) continue;

      const sybilId = `sybil-${shock.tick}-${i}`;

      try {
        // Try to add sybil member
        // In a real implementation, this would go through sponsor bonds
        // and other Sybil resistance mechanisms

        const result = await cell.identity.addMember({
          applicantId: sybilId,
          displayName: `Sybil ${i}`,
          publicKey: `pk_${sybilId}_${'x'.repeat(32)}`,
          requestedAt: Date.now(),
        });

        if (result.approved) {
          sybilsAdmitted++;
          budgetRemaining -= cell.ledger.getParameters().defaultLimit;

          // Add to agents
          state.agents.set(sybilId, {
            id: sybilId,
            strategy: 'SYBIL',
            displayName: `Sybil ${i}`,
            needs: { food: 0, energy: 0, shelter: 0, medical: 0 },
            skills: { cooking: 0, farming: 0, repair: 0, medical: 0, energy: 0 },
            laborSupply: 0,
          });

          state.agentCell.set(sybilId, targetCellId);
          state.agentStates.set(sybilId, {
            agentId: sybilId,
            balance: 0,
            limit: cell.ledger.getParameters().defaultLimit,
            reserve: 0,
            needsSatisfaction: { food: 1, energy: 1, shelter: 1, medical: 1 },
            activeCommitmentsAsPromisor: 0,
            activeCommitmentsAsPromisee: 0,
            hoursWorked: 0,
            totalEarned: 0,
            totalSpent: 0,
            fulfillmentRate: 0.5,
            hasDefected: false,
            isFrozen: false,
            isExcluded: false,
          });
        }
      } catch (e) {
        // Sybil admission rejected
      }
    }
  }

  /**
   * GOVERNANCE_CAPTURE: Infiltrators attempt to gain governance positions
   */
  private async applyGovernanceCapture(
    shock: ShockEvent,
    state: SimulationState
  ): Promise<void> {
    const params = shock.parameters as GovernanceCaptureParams;

    // For each cell, attempt to place infiltrators in governance
    for (const [cellId, cell] of state.cells) {
      for (let i = 0; i < params.infiltratorCount; i++) {
        const infiltratorId = `infiltrator-${shock.tick}-${cellId}-${i}`;

        try {
          // Add infiltrator as member
          await cell.identity.addMember({
            applicantId: infiltratorId,
            displayName: `Infiltrator ${i}`,
            publicKey: `pk_${infiltratorId}_${'x'.repeat(32)}`,
            requestedAt: Date.now(),
          });

          // In a full implementation, they would then attempt
          // to get elected to council positions

          state.agents.set(infiltratorId, {
            id: infiltratorId,
            strategy: 'DEFECTOR',
            displayName: `Infiltrator ${i}`,
            needs: { food: 0, energy: 0, shelter: 0, medical: 0 },
            skills: { cooking: 0, farming: 0, repair: 0, medical: 0, energy: 0 },
            laborSupply: 0,
            defectionThreshold: 9999, // Won't defect, just manipulates
          });

          state.agentCell.set(infiltratorId, cellId);
        } catch (e) {
          // Infiltrator admission failed
        }
      }
    }
  }

  /**
   * CONNECTIVITY_LOSS: Random network partitions
   */
  private async applyConnectivityLoss(
    shock: ShockEvent,
    state: SimulationState
  ): Promise<void> {
    const params = shock.parameters as ConnectivityLossParams;
    const key = `${shock.type}-${shock.tick}`;

    const suspendedLinks: Array<[CellId, CellId]> = [];

    // For each cell pair, potentially suspend link
    for (const [cellId, cell] of state.cells) {
      if (!cell.federation) continue;

      const links = cell.federation.getConnectedCells();

      for (const link of links) {
        // Check if this pair should be affected
        let shouldPartition = state.rng.chance(params.partitionProbability);

        if (params.affectedCells) {
          const isPairAffected = params.affectedCells.some(
            ([a, b]) => (a === cellId && b === link.remoteCellId) ||
                       (b === cellId && a === link.remoteCellId)
          );
          shouldPartition = shouldPartition && isPairAffected;
        }

        if (shouldPartition) {
          try {
            await cell.federation.suspendLink(link.remoteCellId, 'Shock: connectivity loss');
            suspendedLinks.push([cellId, link.remoteCellId]);
          } catch (e) {
            // Link suspension failed
          }
        }
      }
    }

    this.originalStates.set(key, suspendedLinks);
  }

  /**
   * Remove CONNECTIVITY_LOSS: Restore connectivity
   */
  private async removeConnectivityLoss(
    shock: ShockEvent,
    state: SimulationState
  ): Promise<void> {
    const key = `${shock.type}-${shock.tick}`;
    const suspendedLinks = this.originalStates.get(key) as Array<[CellId, CellId]> | undefined;

    if (!suspendedLinks) return;

    for (const [cellId, remoteCellId] of suspendedLinks) {
      const cell = state.cells.get(cellId);
      if (!cell?.federation) continue;

      try {
        await cell.federation.resumeLink(remoteCellId);
      } catch (e) {
        // Link resumption failed
      }
    }
  }
}

// ============================================
// FACTORY FUNCTION
// ============================================

/**
 * Create a shock handler
 */
export function createShockHandler(): ShockHandler {
  return new ShockHandler();
}
