const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

export function assertDistinctNonZeroDeploymentRoles(addresses: Record<string, string>): void {
  const owners = new Map<string, string>();

  for (const [role, address] of Object.entries(addresses)) {
    if (!ADDRESS_PATTERN.test(address)) {
      throw new Error(`${role} must be a valid EVM address`);
    }

    const normalized = address.toLowerCase();
    if (normalized === ZERO_ADDRESS) {
      throw new Error(`${role} must not be the zero address`);
    }

    const existingRole = owners.get(normalized);
    if (existingRole) {
      throw new Error(`${existingRole} and ${role} must use separate addresses`);
    }

    owners.set(normalized, role);
  }
}


type DeploymentRoleState = {
  contract: string;
  role: string;
  account: string;
  expected: boolean;
  actual: boolean;
};

export function assertDeploymentRoleState(states: DeploymentRoleState[]): void {
  for (const state of states) {
    if (state.actual !== state.expected) {
      const requirement = state.expected ? 'must hold' : 'must not hold';
      throw new Error(`${state.contract}: ${state.account} ${requirement} ${state.role}`);
    }
  }
}
