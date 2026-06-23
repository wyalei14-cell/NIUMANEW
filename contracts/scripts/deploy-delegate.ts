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

  const CitizenDelegate = await ethers.getContractFactory("CitizenDelegate");
  const delegate = await CitizenDelegate.deploy(citizenRegistry, deployer.address);
  await delegate.waitForDeployment();
  const address = await delegate.getAddress();

  console.log(`CitizenDelegate deployed: ${address}`);
  console.log(`  "CitizenDelegate": "${address}"`);
}

main().catch(console.error);
