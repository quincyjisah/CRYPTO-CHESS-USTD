import { expect } from 'chai';
import { assertDeploymentRoleState, assertDistinctNonZeroDeploymentRoles } from '../scripts/deployment-policy';

describe('deployment policy', () => {
  it('rejects a zero-address operational role before deployment', () => {
    expect(() => assertDistinctNonZeroDeploymentRoles({
      deployer: '0x0000000000000000000000000000000000000001',
      treasury: '0x0000000000000000000000000000000000000002',
      admin: '0x0000000000000000000000000000000000000003',
      settler: '0x0000000000000000000000000000000000000004',
      pauser: '0x0000000000000000000000000000000000000005',
      minter: '0x0000000000000000000000000000000000000000',
    })).to.throw('minter must not be the zero address');
  });

  it('rejects duplicate role addresses regardless of letter casing', () => {
    expect(() => assertDistinctNonZeroDeploymentRoles({
      deployer: '0x0000000000000000000000000000000000000001',
      treasury: '0x0000000000000000000000000000000000000002',
      admin: '0x0000000000000000000000000000000000000003',
      settler: '0x0000000000000000000000000000000000000004',
      pauser: '0x0000000000000000000000000000000000000005',
      minter: '0x0000000000000000000000000000000000000004',
    })).to.throw('settler and minter must use separate addresses');
  });

  it('accepts unique non-zero deployment role addresses', () => {
    expect(() => assertDistinctNonZeroDeploymentRoles({
      deployer: '0x0000000000000000000000000000000000000001',
      treasury: '0x0000000000000000000000000000000000000002',
      admin: '0x0000000000000000000000000000000000000003',
      settler: '0x0000000000000000000000000000000000000004',
      pauser: '0x0000000000000000000000000000000000000005',
      minter: '0x0000000000000000000000000000000000000006',
    })).not.to.throw();
  });
});

describe('post-deployment role verification', () => {
  it('rejects a deployment when an intended role holder is missing a role', () => {
    expect(() => assertDeploymentRoleState([
      { contract: 'AriesGenesisNFT', role: 'MINTER_ROLE', account: 'minter', expected: true, actual: false },
    ])).to.throw('AriesGenesisNFT: minter must hold MINTER_ROLE');
  });

  it('rejects a deployment when the deployer retains a privileged role', () => {
    expect(() => assertDeploymentRoleState([
      { contract: 'AriesEscrow', role: 'DEFAULT_ADMIN_ROLE', account: 'deployer', expected: false, actual: true },
    ])).to.throw('AriesEscrow: deployer must not hold DEFAULT_ADMIN_ROLE');
  });

  it('accepts a verified role assignment and deployer renunciation snapshot', () => {
    expect(() => assertDeploymentRoleState([
      { contract: 'AriesGenesisNFT', role: 'DEFAULT_ADMIN_ROLE', account: 'admin', expected: true, actual: true },
      { contract: 'AriesGenesisNFT', role: 'DEFAULT_ADMIN_ROLE', account: 'deployer', expected: false, actual: false },
    ])).not.to.throw();
  });
});
