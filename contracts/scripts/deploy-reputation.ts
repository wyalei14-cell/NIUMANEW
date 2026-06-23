import { ethers } from "hardhat";
import fs from "node:fs";
import path from "node:path";

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const chainId = Number(network.chainId);
  console.log(`Deploying with: ${deployer.address} (chain ${chainId})`);

  const deploymentPath = path.resolve(process.cwd(), "..", "world", "deployments", `${chainId}.json`);
  const existing = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
  const citizenRegistry = existing.contracts.CitizenRegistry;
  console.log(`CitizenRegistry: ${citizenRegistry}`);

  const ReputationSystem = await ethers.getContractFactory("ReputationSystem");
  const reputation = await ReputationSystem.deploy(citizenRegistry, deployer.address);
  await reputation.waitForDeployment();
  const address = await reputation.getAddress();

  console.log(`ReputationSystem deployed: ${address}`);
  console.log("\nUpdate world/deployments/1952.json:");
  console.log(`  "ReputationSystem": "${address}"`);
}

main().catch(console.error);
