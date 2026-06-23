import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);

  const CitizenRegistry = "0xa77279811987c36F6191F553bfDf299fdcfa0E57";
  const ReputationSystem = "0xEeBEBF8B1dc87983edde33B396e8f352325E03DD";

  const ServiceMarketplace = await ethers.getContractFactory("ServiceMarketplace");
  const marketplace = await ServiceMarketplace.deploy(
    CitizenRegistry,
    ReputationSystem,
    deployer.address
  );
  await marketplace.waitForDeployment();
  const addr = await marketplace.getAddress();
  console.log("ServiceMarketplace deployed to:", addr);

  // Wait for a few confirmations
  console.log("Waiting for confirmations...");
  await marketplace.deploymentTransaction()?.wait(3);
  console.log("Confirmed!");
  console.log("\nTo add to deployments/1952.json:");
  console.log(`"ServiceMarketplace": "${addr}"`);
}

main().catch(e => { console.error(e); process.exit(1); });
