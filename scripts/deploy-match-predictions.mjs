import { writeFile, mkdir } from "node:fs/promises";
import { network } from "hardhat";

async function main() {
  if (!process.env.BASE_PRIVATE_KEY) {
    throw new Error("Missing BASE_PRIVATE_KEY in .env");
  }

  const { ethers } = await network.create("base");
  const [deployer] = await ethers.getSigners();
  const address = await deployer.getAddress();
  const balance = await ethers.provider.getBalance(address);

  console.log(`Deployer: ${address}`);
  console.log(`Balance: ${ethers.formatEther(balance)} ETH`);

  const contract = await ethers.deployContract("MatchPredictions");
  await contract.waitForDeployment();
  const contractAddress = await contract.getAddress();

  console.log(`MatchPredictions: ${contractAddress}`);

  await mkdir("deployments", { recursive: true });

  let existing = {};
  try {
    const { readFile } = await import("node:fs/promises");
    existing = JSON.parse(await readFile("deployments/base.json", "utf8"));
  } catch {}

  existing.contracts = { ...existing.contracts, matchPredictions: contractAddress };
  await writeFile("deployments/base.json", JSON.stringify(existing, null, 2));

  console.log(`\nAdd to your .env:`);
  console.log(`VITE_MATCH_PREDICTIONS_ADDRESS=${contractAddress}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
