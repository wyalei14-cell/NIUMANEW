import { ethers } from "hardhat";
import fs from "node:fs";
import path from "node:path";

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const chainId = Number(network.chainId);
  console.log(`Deploying extended contracts to chain ${chainId} from ${deployer.address}`);

  // Read existing deployment
  const deploymentPath = path.resolve(process.cwd(), "..", "world", "deployments", `${chainId}.json`);
  const existing = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
  const citizenAddr = existing.contracts.CitizenRegistry;
  const owner = deployer.address;
  console.log(`CitizenRegistry: ${citizenAddr}`);

  // 1. ReputationSystem
  console.log('\n--- Deploying ReputationSystem ---');
  const ReputationSystem = await ethers.getContractFactory("ReputationSystem");
  const reputation = await ReputationSystem.deploy(citizenAddr, owner);
  await reputation.waitForDeployment();
  const reputationAddr = await reputation.getAddress();
  console.log(`ReputationSystem: ${reputationAddr}`);

  // 2. CourseRegistry
  console.log('\n--- Deploying CourseRegistry ---');
  const CourseRegistry = await ethers.getContractFactory("CourseRegistry");
  const course = await CourseRegistry.deploy(citizenAddr, owner);
  await course.waitForDeployment();
  const courseAddr = await course.getAddress();
  console.log(`CourseRegistry: ${courseAddr}`);

  // 3. CredentialRegistry
  console.log('\n--- Deploying CredentialRegistry ---');
  const CredentialRegistry = await ethers.getContractFactory("CredentialRegistry");
  const credential = await CredentialRegistry.deploy(citizenAddr, courseAddr, owner);
  await credential.waitForDeployment();
  const credentialAddr = await credential.getAddress();
  console.log(`CredentialRegistry: ${credentialAddr}`);

  // 4. CitizenDelegate
  console.log('\n--- Deploying CitizenDelegate ---');
  const CitizenDelegate = await ethers.getContractFactory("CitizenDelegate");
  const delegate = await CitizenDelegate.deploy(citizenAddr, owner);
  await delegate.waitForDeployment();
  const delegateAddr = await delegate.getAddress();
  console.log(`CitizenDelegate: ${delegateAddr}`);

  // 5. ServiceMarketplace
  console.log('\n--- Deploying ServiceMarketplace ---');
  const ServiceMarketplace = await ethers.getContractFactory("ServiceMarketplace");
  const marketplace = await ServiceMarketplace.deploy(citizenAddr, reputationAddr, owner);
  await marketplace.waitForDeployment();
  const marketplaceAddr = await marketplace.getAddress();
  console.log(`ServiceMarketplace: ${marketplaceAddr}`);

  // Update deployment file
  existing.contracts.ReputationSystem = reputationAddr;
  existing.contracts.CourseRegistry = courseAddr;
  existing.contracts.CredentialRegistry = credentialAddr;
  existing.contracts.CitizenDelegate = delegateAddr;
  existing.contracts.ServiceMarketplace = marketplaceAddr;
  fs.writeFileSync(deploymentPath, `${JSON.stringify(existing, null, 2)}\n`);
  
  console.log('\n=== All extended contracts deployed ===');
  console.log(JSON.stringify(existing, null, 2));
  console.log(`\nSaved to ${deploymentPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
