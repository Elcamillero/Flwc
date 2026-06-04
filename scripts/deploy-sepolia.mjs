import { mkdir, writeFile } from "node:fs/promises";
import { network } from "hardhat";
import roster from "../src/data/officialRoster.json" with { type: "json" };

function requireEnv(name) {
  if (!process.env[name]) {
    throw new Error(`Missing ${name}. Copy .env.example to .env and set it before deploying.`);
  }
}

function teamId(ethers, name) {
  return ethers.id(`FLWC_TEAM:${name}`);
}

async function main() {
  requireEnv("SEPOLIA_PRIVATE_KEY");

  const { ethers } = await network.create("sepolia");
  const [deployer] = await ethers.getSigners();
  const deployerAddress = await deployer.getAddress();
  const teamIds = roster.teams.map((team) => teamId(ethers, team.name));

  console.log(`Deploying Fantasy League World Cup contracts to Sepolia`);
  console.log(`Deployer: ${deployerAddress}`);
  console.log(`Registered teams: ${teamIds.length}`);

  const playerRegistry = await ethers.deployContract("PlayerRegistry", [deployerAddress]);
  await playerRegistry.waitForDeployment();

  const matchRegistry = await ethers.deployContract("MatchRegistry", [deployerAddress]);
  await matchRegistry.waitForDeployment();

  const predictions = await ethers.deployContract("FantasyLeagueWorldCupPredictions", [teamIds]);
  await predictions.waitForDeployment();

  const deployment = {
    network: "sepolia",
    chainId: 11155111,
    deployedAt: new Date().toISOString(),
    deployer: deployerAddress,
    contracts: {
      playerRegistry: await playerRegistry.getAddress(),
      matchRegistry: await matchRegistry.getAddress(),
      predictions: await predictions.getAddress(),
    },
    teams: roster.teams.map((team, index) => ({
      name: team.name,
      group: team.group,
      id: teamIds[index],
    })),
  };

  await mkdir("deployments", { recursive: true });
  await writeFile("deployments/sepolia.json", JSON.stringify(deployment, null, 2));

  console.log(JSON.stringify(deployment.contracts, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
