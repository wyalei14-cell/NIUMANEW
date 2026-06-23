import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("ServiceMarketplace", () => {
  const PRICE = ethers.parseEther("0.1");

  async function deployFixture() {
    const [deployer, citizen1, citizen2, citizen3] = await ethers.getSigners();

    const CitizenRegistry = await ethers.getContractFactory("CitizenRegistry");
    const citizenReg = await CitizenRegistry.deploy(deployer.address);
    await citizenReg.waitForDeployment();

    const tx1 = await citizenReg.registerCitizen(citizen1.address, "ipfs://c1");
    await tx1.wait();
    const tx2 = await citizenReg.registerCitizen(citizen2.address, "ipfs://c2");
    await tx2.wait();

    const ServiceMarketplace = await ethers.getContractFactory("ServiceMarketplace");
    const marketplace = await ServiceMarketplace.deploy(
      await citizenReg.getAddress(),
      ethers.ZeroAddress,
      deployer.address
    );
    await marketplace.waitForDeployment();

    return { deployer, citizen1, citizen2, citizen3, citizenReg, marketplace };
  }

  it("posts a service", async () => {
    const { citizen1, marketplace } = await deployFixture();
    const tx = await marketplace.connect(citizen1).postService(
      "Smart Contract Audit",
      "Full audit of your Solidity code",
      "Security",
      PRICE,
      86400 // 1 day
    );
    await expect(tx)
      .to.emit(marketplace, "ServicePosted")
      .withArgs(1, 1, await citizen1.getAddress(), "Smart Contract Audit", "Security", PRICE);

    const svc = await marketplace.getService(1);
    expect(svc.title).to.equal("Smart Contract Audit");
    expect(svc.price).to.equal(PRICE);
    expect(svc.status).to.equal(0); // Open
    expect(svc.provider).to.equal(await citizen1.getAddress());
  });

  it("accepts a service with escrow", async () => {
    const { citizen1, citizen2, marketplace } = await deployFixture();
    await marketplace.connect(citizen1).postService("Design", "Logo design", "Creative", PRICE, 86400);

    const tx = await marketplace.connect(citizen2).acceptService(1, { value: PRICE });
    await expect(tx)
      .to.emit(marketplace, "ServiceAccepted")
      .withArgs(1, await citizen2.getAddress(), 2, PRICE);

    const svc = await marketplace.getService(1);
    expect(svc.status).to.equal(1); // Accepted
    expect(svc.client).to.equal(await citizen2.getAddress());
    expect(svc.escrowAmount).to.equal(PRICE);
  });

  it("reverts if non-citizen posts service", async () => {
    const { citizen3, marketplace } = await deployFixture();
    await expect(
      marketplace.connect(citizen3).postService("T", "D", "C", PRICE, 86400)
    ).to.be.revertedWithCustomError(marketplace, "OnlyCitizen");
  });

  it("reverts if payment is insufficient", async () => {
    const { citizen1, citizen2, marketplace } = await deployFixture();
    await marketplace.connect(citizen1).postService("T", "D", "C", PRICE, 86400);
    await expect(
      marketplace.connect(citizen2).acceptService(1, { value: ethers.parseEther("0.01") })
    ).to.be.revertedWithCustomError(marketplace, "InsufficientPayment");
  });

  it("reverts if provider accepts own service", async () => {
    const { citizen1, marketplace } = await deployFixture();
    await marketplace.connect(citizen1).postService("T", "D", "C", PRICE, 86400);
    await expect(
      marketplace.connect(citizen1).acceptService(1, { value: PRICE })
    ).to.be.revertedWithCustomError(marketplace, "WrongValue");
  });

  it("completes service and releases payment with fee", async () => {
    const { deployer, citizen1, citizen2, marketplace } = await deployFixture();
    const feeBps = await marketplace.platformFeeBps();
    const fee = (PRICE * feeBps) / 10000n;
    const payout = PRICE - fee;

    await marketplace.connect(citizen1).postService("Audit", "Code audit", "Security", PRICE, 86400);
    await marketplace.connect(citizen2).acceptService(1, { value: PRICE });

    const deployerBefore = await ethers.provider.getBalance(deployer.address);
    const providerBefore = await ethers.provider.getBalance(citizen1.address);

    await marketplace.connect(citizen1).completeService(1);

    const deployerAfter = await ethers.provider.getBalance(deployer.address);
    const providerAfter = await ethers.provider.getBalance(citizen1.address);

    // Account for gas: just check both received positive amounts
    expect(deployerAfter >= deployerBefore + fee - ethers.parseEther("0.001")).to.be.true;
    expect(providerAfter >= providerBefore + payout - ethers.parseEther("0.001")).to.be.true;

    const svc = await marketplace.getService(1);
    expect(svc.status).to.equal(2); // Completed

    const stats = await marketplace.getMarketplaceStats();
    expect(stats.completed).to.equal(1);
    expect(stats.volume).to.equal(PRICE);
  });

  it("allows dispute and owner resolution to provider", async () => {
    const { deployer, citizen1, citizen2, marketplace } = await deployFixture();
    await marketplace.connect(citizen1).postService("T", "D", "C", PRICE, 86400);
    await marketplace.connect(citizen2).acceptService(1, { value: PRICE });
    await marketplace.connect(citizen2).disputeService(1);

    const svc = await marketplace.getService(1);
    expect(svc.status).to.equal(4); // Disputed

    const providerBefore = await ethers.provider.getBalance(citizen1.address);
    await marketplace.resolveDispute(1, 0); // ReleaseToProvider
    const providerAfter = await ethers.provider.getBalance(citizen1.address);
    expect(providerAfter > providerBefore).to.be.true;
  });

  it("allows dispute and owner resolution refund to client", async () => {
    const { deployer, citizen1, citizen2, marketplace } = await deployFixture();
    await marketplace.connect(citizen1).postService("T", "D", "C", PRICE, 86400);
    await marketplace.connect(citizen2).acceptService(1, { value: PRICE });
    await marketplace.connect(citizen1).disputeService(1);

    const clientBefore = await ethers.provider.getBalance(citizen2.address);
    await marketplace.resolveDispute(1, 1); // RefundToClient
    const clientAfter = await ethers.provider.getBalance(citizen2.address);
    expect(clientAfter > clientBefore).to.be.true;
  });

  it("cancels open service by provider", async () => {
    const { citizen1, marketplace } = await deployFixture();
    await marketplace.connect(citizen1).postService("T", "D", "C", PRICE, 86400);
    await marketplace.connect(citizen1).cancelService(1);

    const svc = await marketplace.getService(1);
    expect(svc.status).to.equal(3); // Canceled
  });

  it("cancels accepted service and refunds client", async () => {
    const { citizen1, citizen2, marketplace } = await deployFixture();
    await marketplace.connect(citizen1).postService("T", "D", "C", PRICE, 86400);
    await marketplace.connect(citizen2).acceptService(1, { value: PRICE });

    const clientBefore = await ethers.provider.getBalance(citizen2.address);
    await marketplace.connect(citizen2).cancelService(1);
    const clientAfter = await ethers.provider.getBalance(citizen2.address);
    expect(clientAfter > clientBefore).to.be.true;

    const svc = await marketplace.getService(1);
    expect(svc.status).to.equal(3); // Canceled
  });

  it("posts reviews after completion", async () => {
    const { citizen1, citizen2, marketplace } = await deployFixture();
    await marketplace.connect(citizen1).postService("T", "D", "C", PRICE, 86400);
    await marketplace.connect(citizen2).acceptService(1, { value: PRICE });
    await marketplace.connect(citizen1).completeService(1);

    await expect(marketplace.connect(citizen2).postReview(1, 5, "Great work!"))
      .to.emit(marketplace, "ReviewPosted");

    const review = await marketplace.getReview(1);
    expect(review.rating).to.equal(5);
    expect(review.reviewer).to.equal(await citizen2.address);

    // Provider can also review
    await marketplace.connect(citizen1).postReview(1, 4, "Good client");
    const review2 = await marketplace.getReview(2);
    expect(review2.rating).to.equal(4);

    // Duplicate review reverts
    await expect(
      marketplace.connect(citizen2).postReview(1, 3, "dup")
    ).to.be.revertedWithCustomError(marketplace, "AlreadyReviewed");
  });

  it("owner can update platform fee", async () => {
    const { deployer, marketplace } = await deployFixture();
    await marketplace.setPlatformFeeBps(500);
    expect(await marketplace.platformFeeBps()).to.equal(500);

    await expect(marketplace.setPlatformFeeBps(1001)).to.be.revertedWithCustomError(marketplace, "WrongValue");
  });

  it("tracks marketplace stats", async () => {
    const { citizen1, citizen2, marketplace } = await deployFixture();
    await marketplace.connect(citizen1).postService("T", "D", "C", PRICE, 86400);

    let stats = await marketplace.getMarketplaceStats();
    expect(stats.posted).to.equal(1);
    expect(stats.completed).to.equal(0);
    expect(stats.volume).to.equal(0);

    await marketplace.connect(citizen2).acceptService(1, { value: PRICE });
    await marketplace.connect(citizen1).completeService(1);

    stats = await marketplace.getMarketplaceStats();
    expect(stats.completed).to.equal(1);
    expect(stats.volume).to.equal(PRICE);
  });
});
