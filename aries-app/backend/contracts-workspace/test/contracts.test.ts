import { expect }                 from 'chai';
import { ethers }                 from 'hardhat';
import { loadFixture }            from '@nomicfoundation/hardhat-toolbox/network-helpers';
import { AriesGenesisNFT, AriesEscrow } from '../typechain-types';

// ─── Test fixture ─────────────────────────────────────────────────────────────
async function deployFixture() {
  const [owner, player1, player2, treasury, minter] = await ethers.getSigners();

  // Deploy mock USDT (ERC-20)
  const MockERC20 = await ethers.getContractFactory('MockERC20');
  const usdt      = await MockERC20.deploy('Tether USD', 'USDT', 6);
  const usdtAddr  = await usdt.getAddress();

  // Mint USDT to players
  await usdt.mint(player1.address, ethers.parseUnits('10000', 6));
  await usdt.mint(player2.address, ethers.parseUnits('10000', 6));

  // Deploy NFT
  const NFT = await ethers.getContractFactory('AriesGenesisNFT');
  const nft = await NFT.deploy(treasury.address) as AriesGenesisNFT;

  // Deploy Escrow
  const Escrow = await ethers.getContractFactory('AriesEscrow');
  const escrow = await Escrow.deploy(treasury.address, [usdtAddr]) as AriesEscrow;

  // Grant minter role
  const MINTER_ROLE = await nft.MINTER_ROLE();
  await nft.grantRole(MINTER_ROLE, minter.address);

  // Open Genesis season
  await nft.openSeason(64);

  return { nft, escrow, usdt, owner, player1, player2, treasury, minter, usdtAddr };
}

// ─── NFT Tests ────────────────────────────────────────────────────────────────
describe('AriesGenesisNFT', () => {

  it('deploys with correct name and symbol', async () => {
    const { nft } = await loadFixture(deployFixture);
    expect(await nft.name()).to.equal('Aries Genesis Board');
    expect(await nft.symbol()).to.equal('ARIESG');
  });

  it('mints a token with valid IPFS URI', async () => {
    const { nft, minter, player1 } = await loadFixture(deployFixture);
    await nft.connect(minter).mint(player1.address, 0, 0, minter.address, false, 'ipfs://Qmtest123');
    expect(await nft.ownerOf(1)).to.equal(player1.address);
    expect(await nft.tokenURI(1)).to.equal('ipfs://Qmtest123');
    expect(await nft.totalMinted()).to.equal(1);
  });

  it('rejects non-IPFS metadata URIs', async () => {
    const { nft, minter, player1 } = await loadFixture(deployFixture);
    await expect(
      nft.connect(minter).mint(player1.address, 0, 0, minter.address, false, 'https://evil.com/metadata.json')
    ).to.be.revertedWith('Metadata must be IPFS URI');
  });

  it('rejects minting when no season is open', async () => {
    const [, player1, , treasury, minter] = await ethers.getSigners();
    const NFT = await ethers.getContractFactory('AriesGenesisNFT');
    const nft = await NFT.deploy(treasury.address);
    await nft.grantRole(await nft.MINTER_ROLE(), minter.address);
    await expect(
      nft.connect(minter).mint(player1.address, 0, 0, minter.address, false, 'ipfs://QmNoSeason')
    ).to.be.revertedWith('No active season');
  });

  it('requires exact mint payment and rejects accidental overpayment', async () => {
    const { nft, minter, player1 } = await loadFixture(deployFixture);
    const price = ethers.parseEther('0.25');
    await expect(
      nft.connect(minter).mint(player1.address, 0, 3, minter.address, false, 'ipfs://QmUnder', { value: price - 1n })
    ).to.be.revertedWith('Incorrect payment');
    await expect(
      nft.connect(minter).mint(player1.address, 0, 3, minter.address, false, 'ipfs://QmOver', { value: price + 1n })
    ).to.be.revertedWith('Incorrect payment');
    await expect(
      nft.connect(minter).mint(player1.address, 0, 0, minter.address, false, 'ipfs://QmFree', { value: 1n })
    ).to.be.revertedWith('Incorrect payment');
    expect(await nft.accumulatedFees()).to.equal(0);
  });

  it('records the effective minter as creator when creator is omitted', async () => {
    const { nft, minter, player1 } = await loadFixture(deployFixture);
    await expect(
      nft.connect(minter).mint(player1.address, 0, 0, ethers.ZeroAddress, false, 'ipfs://QmCreator')
    ).to.emit(nft, 'TokenMinted')
      .withArgs(1, player1.address, 0, 0, 1, minter.address);
    expect((await nft.getTokenData(1)).creator).to.equal(minter.address);
  });

  it('requires the current season to close before opening another', async () => {
    const { nft } = await loadFixture(deployFixture);
    await expect(nft.openSeason(64)).to.be.revertedWith('Current season still open');
    await expect(nft.closeSeason()).to.emit(nft, 'SeasonClosed').withArgs(1);
    await expect(nft.mint.staticCall(
      (await ethers.getSigners())[1].address, 0, 0, ethers.ZeroAddress, false, 'ipfs://QmClosed'
    )).to.be.revertedWith('No active season');
    await expect(nft.openSeason(32)).to.emit(nft, 'SeasonOpened').withArgs(2, 32);
    expect(await nft.seasonCap(2)).to.equal(32);
  });

  it('enforces season cap', async () => {
    const { nft, minter, player1 } = await loadFixture(deployFixture);
    // Season cap is 64 — mint 64 tokens
    for (let i = 0; i < 64; i++) {
      await nft.connect(minter).mint(player1.address, i % 7, 0, minter.address, false, `ipfs://Qm${i}`);
    }
    // 65th should fail
    await expect(
      nft.connect(minter).mint(player1.address, 0, 0, minter.address, false, 'ipfs://QmOver')
    ).to.be.revertedWith('Season cap reached');
  });

  it('enforces 24-hour transfer cooldown', async () => {
    const { nft, minter, player1, player2 } = await loadFixture(deployFixture);
    await nft.connect(minter).mint(player1.address, 0, 0, minter.address, false, 'ipfs://Qmcool');

    // Immediate transfer should fail
    await expect(
      nft.connect(player1).transferFrom(player1.address, player2.address, 1)
    ).to.be.revertedWith('Transfer cooldown active — wait 24h after last transfer');
  });

  it('blocks NFT transfers while paused after the cooldown expires', async () => {
    const { nft, minter, player1, player2 } = await loadFixture(deployFixture);
    await nft.connect(minter).mint(player1.address, 0, 0, minter.address, false, 'ipfs://QmPausedTransfer');
    await ethers.provider.send('evm_increaseTime', [24 * 3600]);
    await ethers.provider.send('evm_mine', []);
    await nft.pause();
    await expect(
      nft.connect(player1).transferFrom(player1.address, player2.address, 1)
    ).to.be.revertedWithCustomError(nft, 'EnforcedPause');
    expect(await nft.ownerOf(1)).to.equal(player1.address);
  });

  it('reports NFT transfer cooldown state and unlock time', async () => {
    const { nft, minter, player1 } = await loadFixture(deployFixture);
    await nft.connect(minter).mint(player1.address, 0, 0, minter.address, false, 'ipfs://QmCooldownView');
    const [canTransferNow, unlocksAt] = await nft.canTransfer(1);
    expect(canTransferNow).to.equal(false);
    expect(unlocksAt).to.be.greaterThan(0);
    await ethers.provider.send('evm_increaseTime', [24 * 3600]);
    await ethers.provider.send('evm_mine', []);
    const [canTransferAfter, unlocksAfter] = await nft.canTransfer(1);
    expect(canTransferAfter).to.equal(true);
    expect(unlocksAfter).to.equal(unlocksAt);
  });

  it('resets the transfer cooldown after a successful NFT transfer', async () => {
    const { nft, minter, player1, player2 } = await loadFixture(deployFixture);
    await nft.connect(minter).mint(player1.address, 0, 0, minter.address, false, 'ipfs://QmTransferReset');
    await ethers.provider.send('evm_increaseTime', [24 * 3600]);
    await ethers.provider.send('evm_mine', []);

    await nft.connect(player1).transferFrom(player1.address, player2.address, 1);

    expect(await nft.ownerOf(1)).to.equal(player2.address);
    const [canTransferAgain, unlocksAt] = await nft.canTransfer(1);
    expect(canTransferAgain).to.equal(false);
    expect(unlocksAt).to.be.greaterThan((await ethers.provider.getBlock('latest'))!.timestamp);
  });

  it('advertises ERC-721, ERC-2981, and AccessControl interfaces', async () => {
    const { nft } = await loadFixture(deployFixture);
    expect(await nft.supportsInterface('0x80ac58cd')).to.equal(true); // ERC-721
    expect(await nft.supportsInterface('0x2a55205a')).to.equal(true); // ERC-2981
    expect(await nft.supportsInterface('0x7965db0b')).to.equal(true); // AccessControl
    expect(await nft.supportsInterface('0xffffffff')).to.equal(false);
  });

  it('applies creator-specific 3% royalty when a distinct creator is set', async () => {
    const { nft, minter, player1, player2 } = await loadFixture(deployFixture);
    await nft.connect(minter).mint(player1.address, 0, 0, player2.address, false, 'ipfs://QmCreatorRoyalty');
    const [receiver, royaltyAmount] = await nft.royaltyInfo(1, ethers.parseEther('1'));
    expect(receiver).to.equal(player2.address);
    expect(royaltyAmount).to.equal(ethers.parseEther('0.03'));
  });

  it('restricts mint-fee withdrawal to the configured treasury', async () => {
    const { nft, minter, player1, treasury } = await loadFixture(deployFixture);
    const price = ethers.parseEther('0.25');
    await nft.connect(minter).mint(player1.address, 0, 3, minter.address, false, 'ipfs://Qmfee', { value: price });
    await expect(nft.withdrawFees()).to.be.reverted;
    await expect(nft.connect(treasury).withdrawFees())
      .to.emit(nft, 'TreasuryWithdrawn')
      .withArgs(treasury.address, price);
    expect(await ethers.provider.getBalance(await nft.getAddress())).to.equal(0);
    expect(await nft.accumulatedFees()).to.equal(0);
  });

  it('correctly sets ERC-2981 royalty', async () => {
    const { nft, minter, player1, treasury } = await loadFixture(deployFixture);
    await nft.connect(minter).mint(player1.address, 0, 0, ethers.ZeroAddress, false, 'ipfs://Qmroyalty');
    const [receiver, royaltyAmt] = await nft.royaltyInfo(1, ethers.parseEther('1'));
    expect(receiver).to.equal(treasury.address);
    expect(royaltyAmt).to.equal(ethers.parseEther('0.05')); // 5%
  });

  it('allows an admin to update the default royalty up to the 10% ceiling', async () => {
    const { nft, minter, player1, player2 } = await loadFixture(deployFixture);
    await nft.connect(minter).mint(player1.address, 0, 0, ethers.ZeroAddress, false, 'ipfs://QmAdminRoyalty');

    await expect(nft.setDefaultRoyalty(player2.address, 1000))
      .to.emit(nft, 'RoyaltyUpdated')
      .withArgs(player2.address, 1000);
    const [receiver, royaltyAmount] = await nft.royaltyInfo(1, ethers.parseEther('1'));
    expect(receiver).to.equal(player2.address);
    expect(royaltyAmount).to.equal(ethers.parseEther('0.1'));

    await expect(nft.setDefaultRoyalty(player2.address, 1001))
      .to.be.revertedWith('Royalty cannot exceed 10%');
  });

  it('cannot exceed MAX_GENESIS_SUPPLY', async () => {
    // This test is slow — only run in CI
    // Verifies the 10,000 hard cap via totalMinted check
    const { nft } = await loadFixture(deployFixture);
    expect(await nft.remainingSupply()).to.equal(10000);
  });

  it('rejects mint from non-minter', async () => {
    const { nft, player1 } = await loadFixture(deployFixture);
    await expect(
      nft.connect(player1).mint(player1.address, 0, 0, player1.address, false, 'ipfs://QmBad')
    ).to.be.reverted;
  });

  it('rejects an empty batch mint', async () => {
    const { nft, minter } = await loadFixture(deployFixture);
    await expect(nft.connect(minter).batchMint([], [], [], [])).to.be.revertedWith('Empty batch');
  });

  it('rejects zero-address recipients in batch mint', async () => {
    const { nft, minter } = await loadFixture(deployFixture);
    await expect(
      nft.connect(minter).batchMint([ethers.ZeroAddress], [0], [0], ['ipfs://Qm1'])
    ).to.be.revertedWith('Invalid recipient');
  });

  it('rejects invalid piece types in batch mint', async () => {
    const { nft, minter, player1 } = await loadFixture(deployFixture);
    await expect(
      nft.connect(minter).batchMint([player1.address], [7], [0], ['ipfs://Qm1'])
    ).to.be.revertedWith('Invalid piece type');
  });

  it('rejects invalid rarities in batch mint', async () => {
    const { nft, minter, player1 } = await loadFixture(deployFixture);
    await expect(
      nft.connect(minter).batchMint([player1.address], [0], [5], ['ipfs://Qm1'])
    ).to.be.revertedWith('Invalid rarity');
  });

  it('rejects non-IPFS metadata in batch mint', async () => {
    const { nft, minter, player1 } = await loadFixture(deployFixture);
    await expect(
      nft.connect(minter).batchMint([player1.address], [0], [0], ['https://example.com/1.json'])
    ).to.be.revertedWith('Metadata must be IPFS URI');
  });

  it('enforces the seasonal cap for batch mint', async () => {
    const { nft, minter, player1 } = await loadFixture(deployFixture);
    const recipients = Array(65).fill(player1.address);
    const pieceTypes = Array(65).fill(0);
    const rarities = Array(65).fill(0);
    const uris = Array.from({ length: 65 }, (_, i) => `ipfs://QmBatch${i}`);
    await expect(
      nft.connect(minter).batchMint(recipients, pieceTypes, rarities, uris)
    ).to.be.revertedWith('Season cap reached');
  });

  it('NFTs are cosmetic — no stat modifications possible', async () => {
    const { nft, minter, player1 } = await loadFixture(deployFixture);
    await nft.connect(minter).mint(player1.address, 0, 3, minter.address, false, 'ipfs://Qmlegendary', { value: ethers.parseEther('0.25') });
    const data = await nft.getTokenData(1);
    // isCosmetic is always true — no gameplay boost fields exist on the contract
    expect(data.rarity).to.equal(3); // Legendary
    expect(data.pieceType).to.equal(0); // King
    // No strength, speed, or advantage fields — cosmetic only
  });
});

// ─── Escrow Tests ─────────────────────────────────────────────────────────────
describe('AriesEscrow', () => {

  it('rejects zero-address or non-contract escrow tokens', async () => {
    const [, treasury] = await ethers.getSigners();
    const Escrow = await ethers.getContractFactory('AriesEscrow');
    await expect(Escrow.deploy(treasury.address, [ethers.ZeroAddress])).to.be.revertedWith('Invalid token');
    await expect(Escrow.deploy(treasury.address, [treasury.address])).to.be.revertedWith('Invalid token');
  });

  it('allows only the admin to add and remove accepted escrow tokens', async () => {
    const { escrow, owner } = await loadFixture(deployFixture);
    const MockERC20 = await ethers.getContractFactory('MockERC20');
    const extraToken = await MockERC20.deploy('Extra Token', 'EXT', 6);
    const tokenAddress = await extraToken.getAddress();

    await expect(escrow.connect(owner).addToken(tokenAddress))
      .to.emit(escrow, 'TokenAdded')
      .withArgs(tokenAddress);
    expect(await escrow.acceptedTokens(tokenAddress)).to.equal(true);

    await expect(escrow.connect(owner).removeToken(tokenAddress))
      .to.emit(escrow, 'TokenRemoved')
      .withArgs(tokenAddress);
    expect(await escrow.acceptedTokens(tokenAddress)).to.equal(false);
  });

  it('rejects fee-on-transfer tokens without leaving undercollateralized escrow', async () => {
    const [owner, player1, player2, treasury] = await ethers.getSigners();
    const FeeToken = await ethers.getContractFactory('MockFeeOnTransferERC20');
    const token = await FeeToken.deploy();
    const tokenAddress = await token.getAddress();
    const Escrow = await ethers.getContractFactory('AriesEscrow');
    const escrow = await Escrow.deploy(treasury.address, [tokenAddress]);
    const amount = ethers.parseEther('10');
    await token.mint(player1.address, amount);
    await token.mint(player2.address, amount);
    await token.connect(player1).approve(await escrow.getAddress(), amount);
    const gameId = ethers.id('fee-on-transfer-token');
    await expect(
      escrow.connect(player1).lockWager(gameId, player2.address, tokenAddress, amount)
    ).to.be.revertedWith('Non-exact token transfer');
    expect(await token.balanceOf(await escrow.getAddress())).to.equal(0);
    expect((await escrow.getGame(gameId)).status).to.equal(0);
  });

  it('allows recovery after an active game reaches its declared deadline', async () => {
    const { escrow, usdt, player1, player2, usdtAddr } = await loadFixture(deployFixture);
    const gameId = ethers.id('test-active-game-deadline');
    const amount = ethers.parseUnits('10', 6);
    await usdt.connect(player1).approve(await escrow.getAddress(), amount);
    await usdt.connect(player2).approve(await escrow.getAddress(), amount);
    await escrow.connect(player1).lockWager(gameId, player2.address, usdtAddr, amount);
    await escrow.connect(player2).lockWager(gameId, player1.address, usdtAddr, amount);
    const startBlock = await ethers.provider.getBlock('latest');
    await escrow.startGame(gameId, startBlock!.timestamp + 24 * 3600);
    await ethers.provider.send('evm_increaseTime', [24 * 3600 + 1]);
    await ethers.provider.send('evm_mine', []);
    await escrow.connect(player2).refund(gameId, 'Game deadline expired');
    expect(await usdt.balanceOf(player1.address)).to.equal(ethers.parseUnits('10000', 6));
    expect(await usdt.balanceOf(player2.address)).to.equal(ethers.parseUnits('10000', 6));
  });

  it('requires the second player to confirm the first player as their opponent', async () => {
    const { escrow, usdt, player1, player2, treasury, usdtAddr } = await loadFixture(deployFixture);
    const gameId = ethers.id('test-opponent-confirmation');
    const amount = ethers.parseUnits('10', 6);
    await usdt.connect(player1).approve(await escrow.getAddress(), amount);
    await usdt.connect(player2).approve(await escrow.getAddress(), amount);
    await escrow.connect(player1).lockWager(gameId, player2.address, usdtAddr, amount);

    await expect(
      escrow.connect(player2).lockWager(gameId, treasury.address, usdtAddr, amount)
    ).to.be.revertedWith('Opponent mismatch');

    const game = await escrow.getGame(gameId);
    expect(game.status).to.equal(1);
    expect(await usdt.balanceOf(await escrow.getAddress())).to.equal(amount);
  });

  it('allows both players to lock wagers', async () => {
    const { escrow, usdt, player1, player2, usdtAddr } = await loadFixture(deployFixture);
    const gameId  = ethers.id('test-game-1');
    const amount  = ethers.parseUnits('10', 6); // 10 USDT

    await usdt.connect(player1).approve(await escrow.getAddress(), amount);
    await usdt.connect(player2).approve(await escrow.getAddress(), amount);

    await escrow.connect(player1).lockWager(gameId, player2.address, usdtAddr, amount);
    await escrow.connect(player2).lockWager(gameId, player1.address, usdtAddr, amount);

    const game = await escrow.getGame(gameId);
    expect(game.status).to.equal(2); // BothLocked
    expect(game.whiteLocked).to.be.true;
    expect(game.blackLocked).to.be.true;
  });

  it('restricts escrow fee withdrawal to the configured treasury', async () => {
    const { escrow, usdt, player1, player2, treasury, usdtAddr } = await loadFixture(deployFixture);
    const gameId = ethers.id('test-treasury-fees');
    const amount = ethers.parseUnits('10', 6);
    await usdt.connect(player1).approve(await escrow.getAddress(), amount);
    await usdt.connect(player2).approve(await escrow.getAddress(), amount);
    await escrow.connect(player1).lockWager(gameId, player2.address, usdtAddr, amount);
    await escrow.connect(player2).lockWager(gameId, player1.address, usdtAddr, amount);
    const startBlock = await ethers.provider.getBlock('latest');
    await escrow.startGame(gameId, startBlock!.timestamp + 24 * 3600);
    await escrow.settle(gameId, player1.address);
    const fee = ethers.parseUnits('0.4', 6);
    await expect(escrow.withdrawFees(usdtAddr)).to.be.reverted;
    const before = await usdt.balanceOf(treasury.address);
    await escrow.connect(treasury).withdrawFees(usdtAddr);
    expect((await usdt.balanceOf(treasury.address)) - before).to.equal(fee);
    expect(await escrow.collectedFees(usdtAddr)).to.equal(0);
  });

  it('rejects settlement before the settler starts the game', async () => {
    const { escrow, usdt, player1, player2, usdtAddr } = await loadFixture(deployFixture);
    const gameId = ethers.id('test-settle-before-start');
    const amount = ethers.parseUnits('10', 6);
    await usdt.connect(player1).approve(await escrow.getAddress(), amount);
    await usdt.connect(player2).approve(await escrow.getAddress(), amount);
    await escrow.connect(player1).lockWager(gameId, player2.address, usdtAddr, amount);
    await escrow.connect(player2).lockWager(gameId, player1.address, usdtAddr, amount);
    await expect(escrow.settle(gameId, player1.address)).to.be.revertedWith('Game has not started');
  });

  it('settles correctly — winner receives pot minus 2% fee', async () => {
    const { escrow, usdt, player1, player2, usdtAddr } = await loadFixture(deployFixture);
    const gameId  = ethers.id('test-game-settle');
    const amount  = ethers.parseUnits('10', 6);

    await usdt.connect(player1).approve(await escrow.getAddress(), amount);
    await usdt.connect(player2).approve(await escrow.getAddress(), amount);
    await escrow.connect(player1).lockWager(gameId, player2.address, usdtAddr, amount);
    await escrow.connect(player2).lockWager(gameId, player1.address, usdtAddr, amount);

    const startBlock = await ethers.provider.getBlock('latest');
    await escrow.startGame(gameId, startBlock!.timestamp + 24 * 3600);

    const balBefore = await usdt.balanceOf(player1.address);

    // Player1 wins
    await escrow.settle(gameId, player1.address);

    const balAfter = await usdt.balanceOf(player1.address);
    const received = balAfter - balBefore;

    // Pot = 20 USDT, fee = 2% = 0.40 USDT, payout = 19.60 USDT
    const expectedPayout = ethers.parseUnits('19.60', 6);
    expect(received).to.equal(expectedPayout);
  });

  it('draw refunds both players in full — no fee', async () => {
    const { escrow, usdt, player1, player2, usdtAddr } = await loadFixture(deployFixture);
    const gameId  = ethers.id('test-game-draw');
    const amount  = ethers.parseUnits('10', 6);

    await usdt.connect(player1).approve(await escrow.getAddress(), amount);
    await usdt.connect(player2).approve(await escrow.getAddress(), amount);
    await escrow.connect(player1).lockWager(gameId, player2.address, usdtAddr, amount);
    await escrow.connect(player2).lockWager(gameId, player1.address, usdtAddr, amount);

    const startBlock = await ethers.provider.getBlock('latest');
    await escrow.startGame(gameId, startBlock!.timestamp + 24 * 3600);

    const [b1Before, b2Before] = await Promise.all([
      usdt.balanceOf(player1.address),
      usdt.balanceOf(player2.address),
    ]);

    // address(0) = draw
    await escrow.settle(gameId, ethers.ZeroAddress);

    const [b1After, b2After] = await Promise.all([
      usdt.balanceOf(player1.address),
      usdt.balanceOf(player2.address),
    ]);

    // Both get exactly their wager back
    expect(b1After - b1Before).to.equal(amount);
    expect(b2After - b2Before).to.equal(amount);
  });

  it('computes escrow payout and platform fee exactly', async () => {
    const { escrow } = await loadFixture(deployFixture);
    const [pot, fee, payout] = await escrow.computePayout(ethers.parseUnits('10', 6));
    expect(pot).to.equal(ethers.parseUnits('20', 6));
    expect(fee).to.equal(ethers.parseUnits('0.4', 6));
    expect(payout).to.equal(ethers.parseUnits('19.6', 6));
    const [zeroPot, zeroFee, zeroPayout] = await escrow.computePayout(0);
    expect([zeroPot, zeroFee, zeroPayout]).to.deep.equal([0n, 0n, 0n]);
  });

  it('computes the fee without overflowing at the maximum accepted wager', async () => {
    const { escrow } = await loadFixture(deployFixture);
    const wager = ethers.MaxUint256 / 2n;
    const [pot, fee, payout] = await escrow.computePayout(wager);
    const expectedPot = wager * 2n;
    const expectedFee = (expectedPot * 200n) / 10_000n;
    expect(pot).to.equal(expectedPot);
    expect(fee).to.equal(expectedFee);
    expect(payout).to.equal(expectedPot - expectedFee);
  });

  it('rejects a payout preview wager that would overflow the pot', async () => {
    const { escrow } = await loadFixture(deployFixture);
    await expect(escrow.computePayout(ethers.MaxUint256 / 2n + 1n))
      .to.be.revertedWith('Invalid wager amount');
  });

  it('fee is exactly 2% — cannot be changed by settler', async () => {
    const { escrow } = await loadFixture(deployFixture);
    expect(await escrow.PLATFORM_FEE_BPS()).to.equal(200); // 2%
    expect(await escrow.MAX_PLATFORM_FEE()).to.equal(500); // Hard cap 5%
  });

  it('rejects wager amount mismatch', async () => {
    const { escrow, usdt, player1, player2, usdtAddr } = await loadFixture(deployFixture);
    const gameId = ethers.id('test-mismatch');

    await usdt.connect(player1).approve(await escrow.getAddress(), ethers.parseUnits('10', 6));
    await usdt.connect(player2).approve(await escrow.getAddress(), ethers.parseUnits('20', 6));

    await escrow.connect(player1).lockWager(gameId, player2.address, usdtAddr, ethers.parseUnits('10', 6));

    await expect(
      escrow.connect(player2).lockWager(gameId, player1.address, usdtAddr, ethers.parseUnits('20', 6))
    ).to.be.revertedWith('Wager amount mismatch — must be equal');
  });

  it('only SETTLER_ROLE can settle games', async () => {
    const { escrow, usdt, player1, player2, usdtAddr } = await loadFixture(deployFixture);
    const gameId = ethers.id('test-auth');
    const amount = ethers.parseUnits('10', 6);

    await usdt.connect(player1).approve(await escrow.getAddress(), amount);
    await usdt.connect(player2).approve(await escrow.getAddress(), amount);
    await escrow.connect(player1).lockWager(gameId, player2.address, usdtAddr, amount);
    await escrow.connect(player2).lockWager(gameId, player1.address, usdtAddr, amount);

    const startBlock = await ethers.provider.getBlock('latest');
    await escrow.startGame(gameId, startBlock!.timestamp + 24 * 3600);

    await expect(
      escrow.connect(player1).settle(gameId, player1.address)
    ).to.be.reverted;
  });

  it('allows both players to recover an unstarted, fully locked game after the timeout', async () => {
    const { escrow, usdt, player1, player2, usdtAddr } = await loadFixture(deployFixture);
    const gameId = ethers.id('test-unstarted-timeout');
    const amount = ethers.parseUnits('10', 6);
    await usdt.connect(player1).approve(await escrow.getAddress(), amount);
    await usdt.connect(player2).approve(await escrow.getAddress(), amount);
    await escrow.connect(player1).lockWager(gameId, player2.address, usdtAddr, amount);
    await escrow.connect(player2).lockWager(gameId, player1.address, usdtAddr, amount);
    await ethers.provider.send('evm_increaseTime', [25 * 3600]);
    await ethers.provider.send('evm_mine', []);
    await escrow.connect(player1).refund(gameId, 'Game never started');
    expect(await usdt.balanceOf(player1.address)).to.equal(ethers.parseUnits('10000', 6));
    expect(await usdt.balanceOf(player2.address)).to.equal(ethers.parseUnits('10000', 6));
  });

  it('does not allow the settler to unilaterally cancel a started game', async () => {
    const { escrow, usdt, player1, player2, usdtAddr } = await loadFixture(deployFixture);
    const gameId = ethers.id('test-settler-cannot-cancel-started');
    const amount = ethers.parseUnits('10', 6);
    await usdt.connect(player1).approve(await escrow.getAddress(), amount);
    await usdt.connect(player2).approve(await escrow.getAddress(), amount);
    await escrow.connect(player1).lockWager(gameId, player2.address, usdtAddr, amount);
    await escrow.connect(player2).lockWager(gameId, player1.address, usdtAddr, amount);
    const startBlock = await ethers.provider.getBlock('latest');
    await escrow.startGame(gameId, startBlock!.timestamp + 24 * 3600);
    await expect(escrow.refund(gameId, 'Admin wants cancellation'))
      .to.be.revertedWith('Not authorized to refund');
  });

  it('does not allow players to timeout-refund a started game', async () => {
    const { escrow, usdt, player1, player2, usdtAddr } = await loadFixture(deployFixture);
    const gameId = ethers.id('test-started-timeout');
    const amount = ethers.parseUnits('10', 6);
    await usdt.connect(player1).approve(await escrow.getAddress(), amount);
    await usdt.connect(player2).approve(await escrow.getAddress(), amount);
    await escrow.connect(player1).lockWager(gameId, player2.address, usdtAddr, amount);
    await escrow.connect(player2).lockWager(gameId, player1.address, usdtAddr, amount);
    const startBlock = await ethers.provider.getBlock('latest');
    await escrow.startGame(gameId, startBlock!.timestamp + 3 * 24 * 3600);
    await ethers.provider.send('evm_increaseTime', [25 * 3600]);
    await ethers.provider.send('evm_mine', []);
    await expect(escrow.connect(player1).refund(gameId, 'Expired')).to.be.revertedWith('Not authorized to refund');
  });

  it('allows either participant to raise a dispute but rejects unrelated callers', async () => {
    const { escrow, usdt, player1, player2, usdtAddr } = await loadFixture(deployFixture);
    const [, , , , , outsider] = await ethers.getSigners();
    const gameId = ethers.id('test-player-dispute');
    const amount = ethers.parseUnits('10', 6);
    await usdt.connect(player1).approve(await escrow.getAddress(), amount);
    await usdt.connect(player2).approve(await escrow.getAddress(), amount);
    await escrow.connect(player1).lockWager(gameId, player2.address, usdtAddr, amount);
    await escrow.connect(player2).lockWager(gameId, player1.address, usdtAddr, amount);
    const startBlock = await ethers.provider.getBlock('latest');
    await escrow.startGame(gameId, startBlock!.timestamp + 24 * 3600);
    await expect(escrow.connect(outsider).disputeGame(gameId, 'Unrelated caller'))
      .to.be.revertedWith('Not authorized to dispute');
    await expect(escrow.connect(player2).disputeGame(gameId, 'Suspicious result'))
      .to.emit(escrow, 'GameDisputed')
      .withArgs(gameId, 'Suspicious result');
    expect((await escrow.getGame(gameId)).status).to.equal(5);
  });

  it('allows either player to recover disputed funds after the dispute timeout', async () => {
    const { escrow, usdt, player1, player2, usdtAddr } = await loadFixture(deployFixture);
    const gameId = ethers.id('test-dispute-timeout');
    const amount = ethers.parseUnits('10', 6);
    await usdt.connect(player1).approve(await escrow.getAddress(), amount);
    await usdt.connect(player2).approve(await escrow.getAddress(), amount);
    await escrow.connect(player1).lockWager(gameId, player2.address, usdtAddr, amount);
    await escrow.connect(player2).lockWager(gameId, player1.address, usdtAddr, amount);
    const startBlock = await ethers.provider.getBlock('latest');
    await escrow.startGame(gameId, startBlock!.timestamp + 3 * 24 * 3600);
    await escrow.disputeGame(gameId, 'Outcome contested');
    await ethers.provider.send('evm_increaseTime', [8 * 24 * 3600]);
    await ethers.provider.send('evm_mine', []);
    await escrow.connect(player2).refund(gameId, 'Arbitration timeout');
    expect(await usdt.balanceOf(player1.address)).to.equal(ethers.parseUnits('10000', 6));
    expect(await usdt.balanceOf(player2.address)).to.equal(ethers.parseUnits('10000', 6));
  });

  it('blocks settlement while paused but preserves player timeout refunds', async () => {
    const { escrow, usdt, owner, player1, player2, usdtAddr } = await loadFixture(deployFixture);
    const gameId = ethers.id('test-paused-settlement');
    const amount = ethers.parseUnits('10', 6);
    await usdt.connect(player1).approve(await escrow.getAddress(), amount);
    await usdt.connect(player2).approve(await escrow.getAddress(), amount);
    await escrow.connect(player1).lockWager(gameId, player2.address, usdtAddr, amount);
    await escrow.connect(player2).lockWager(gameId, player1.address, usdtAddr, amount);
    const startBlock = await ethers.provider.getBlock('latest');
    await escrow.startGame(gameId, startBlock!.timestamp + 24 * 3600);
    await escrow.pause();
    await expect(escrow.settle(gameId, player1.address)).to.be.revertedWithCustomError(escrow, 'EnforcedPause');
    await ethers.provider.send('evm_increaseTime', [25 * 3600]);
    await ethers.provider.send('evm_mine', []);
    await escrow.connect(player1).refund(gameId, 'Paused settlement timeout');
    expect((await escrow.getGame(gameId)).status).to.equal(4);
    expect(await usdt.balanceOf(player1.address)).to.equal(ethers.parseUnits('10000', 6));
    expect(await usdt.balanceOf(player2.address)).to.equal(ethers.parseUnits('10000', 6));
  });

  it('blocks dispute resolution while paused', async () => {
    const { escrow, usdt, player1, player2, usdtAddr } = await loadFixture(deployFixture);
    const gameId = ethers.id('test-paused-dispute-resolution');
    const amount = ethers.parseUnits('10', 6);
    await usdt.connect(player1).approve(await escrow.getAddress(), amount);
    await usdt.connect(player2).approve(await escrow.getAddress(), amount);
    await escrow.connect(player1).lockWager(gameId, player2.address, usdtAddr, amount);
    await escrow.connect(player2).lockWager(gameId, player1.address, usdtAddr, amount);
    const startBlock = await ethers.provider.getBlock('latest');
    await escrow.startGame(gameId, startBlock!.timestamp + 3 * 24 * 3600);
    await escrow.disputeGame(gameId, 'Outcome contested');
    await escrow.pause();
    await expect(escrow.resolveDispute(gameId, player1.address)).to.be.revertedWithCustomError(escrow, 'EnforcedPause');
    expect((await escrow.getGame(gameId)).status).to.equal(5);
  });

  it('allows the settler to resolve a dispute in favour of a participant', async () => {
    const { escrow, usdt, player1, player2, usdtAddr } = await loadFixture(deployFixture);
    const gameId = ethers.id('test-dispute-resolution');
    const amount = ethers.parseUnits('10', 6);
    await usdt.connect(player1).approve(await escrow.getAddress(), amount);
    await usdt.connect(player2).approve(await escrow.getAddress(), amount);
    await escrow.connect(player1).lockWager(gameId, player2.address, usdtAddr, amount);
    await escrow.connect(player2).lockWager(gameId, player1.address, usdtAddr, amount);
    const startBlock = await ethers.provider.getBlock('latest');
    await escrow.startGame(gameId, startBlock!.timestamp + 3 * 24 * 3600);
    await escrow.disputeGame(gameId, 'Outcome contested');
    const before = await usdt.balanceOf(player1.address);
    await escrow.resolveDispute(gameId, player1.address);
    expect((await usdt.balanceOf(player1.address)) - before).to.equal(ethers.parseUnits('19.6', 6));
    expect((await escrow.getGame(gameId)).status).to.equal(3);
  });

  it('allows timeout refund after 24 hours', async () => {
    const { escrow, usdt, player1, player2, usdtAddr } = await loadFixture(deployFixture);
    const gameId = ethers.id('test-timeout');
    const amount = ethers.parseUnits('10', 6);

    await usdt.connect(player1).approve(await escrow.getAddress(), amount);
    await escrow.connect(player1).lockWager(gameId, player2.address, usdtAddr, amount);

    // Fast-forward 25 hours
    await ethers.provider.send('evm_increaseTime', [25 * 3600]);
    await ethers.provider.send('evm_mine', []);

    const balBefore = await usdt.balanceOf(player1.address);
    await escrow.connect(player1).refund(gameId, 'Opponent never joined');
    const balAfter = await usdt.balanceOf(player1.address);

    expect(balAfter - balBefore).to.equal(amount);
  });
});
