import { mkdir, writeFile } from "node:fs/promises";
import { network } from "hardhat";
import roster from "../src/data/officialRoster.json" with { type: "json" };

function requireEnv(name) {
  if (!process.env[name]) throw new Error(`Missing ${name} in .env`);
}

function teamId(ethers, name) { return ethers.id(`FLWC_TEAM:${name}`); }
function playerId(ethers, id)  { return ethers.id(`FLWC_PLAYER:${id}`); }

async function main() {
  requireEnv("BASE_PRIVATE_KEY");

  const { ethers } = await network.create("base");
  const [deployer] = await ethers.getSigners();
  const addr = await deployer.getAddress();
  const balance = await ethers.provider.getBalance(addr);

  console.log(`\nDeployer : ${addr}`);
  console.log(`Balance  : ${ethers.formatEther(balance)} ETH`);
  if (balance === 0n) throw new Error("No ETH on Base.");

  const teamIds = roster.teams.map(t => teamId(ethers, t.name));

  // ── 1. Vault ──────────────────────────────────────────────────────
  console.log("\n[1/7] FLWCVault...");
  const vault = await ethers.deployContract("FLWCVault", [addr]);
  await vault.waitForDeployment();
  const vaultAddr = await vault.getAddress();
  console.log(`  → ${vaultAddr}`);

  // ── 2. Token ─────────────────────────────────────────────────────
  console.log("[2/7] FLWCToken...");
  const token = await ethers.deployContract("FLWCToken", [addr]);
  await token.waitForDeployment();
  const tokenAddr = await token.getAddress();
  console.log(`  → ${tokenAddr}`);

  // ── 3. PlayerRegistry ────────────────────────────────────────────
  console.log("[3/7] PlayerRegistry...");
  const playerReg = await ethers.deployContract("PlayerRegistry", [addr]);
  await playerReg.waitForDeployment();
  const playerRegAddr = await playerReg.getAddress();
  console.log(`  → ${playerRegAddr}`);

  console.log(`  (Player data lives in the frontend roster — on-chain registration optional)`);

  // ── 4. MatchRegistry ─────────────────────────────────────────────
  console.log("[4/7] MatchRegistry...");
  const matchReg = await ethers.deployContract("MatchRegistry", [addr]);
  await matchReg.waitForDeployment();
  const matchRegAddr = await matchReg.getAddress();
  console.log(`  → ${matchRegAddr}`);

  // ── 5. MatchPredictions ──────────────────────────────────────────
  console.log("[5/7] MatchPredictions...");
  const matchPred = await ethers.deployContract("MatchPredictions", [addr, matchRegAddr, vaultAddr]);
  await matchPred.waitForDeployment();
  const matchPredAddr = await matchPred.getAddress();
  console.log(`  → ${matchPredAddr}`);

  // ── 6. ChampionPool ──────────────────────────────────────────────
  console.log("[6/7] ChampionPool...");
  const champPool = await ethers.deployContract("ChampionPool", [addr, vaultAddr, teamIds]);
  await champPool.waitForDeployment();
  const champPoolAddr = await champPool.getAddress();
  console.log(`  → ${champPoolAddr}`);


  // ── Save deployment ───────────────────────────────────────────────
  const deployment = {
    network: "base",
    chainId: 8453,
    deployedAt: new Date().toISOString(),
    deployer: addr,
    contracts: {
      vault:           vaultAddr,
      token:           tokenAddr,
      playerRegistry:  playerRegAddr,
      matchRegistry:   matchRegAddr,
      matchPredictions: matchPredAddr,
      championPool:    champPoolAddr,
    },
    teams: roster.teams.map((t, i) => ({ name: t.name, group: t.group, id: teamIds[i] })),
  };

  await mkdir("deployments", { recursive: true });
  await writeFile("deployments/base.json", JSON.stringify(deployment, null, 2));

  const envLines = [
    `VITE_VAULT_ADDRESS=${vaultAddr}`,
    `VITE_TOKEN_ADDRESS=${tokenAddr}`,
    `VITE_PLAYER_REGISTRY_ADDRESS=${playerRegAddr}`,
    `VITE_MATCH_REGISTRY_ADDRESS=${matchRegAddr}`,
    `VITE_MATCH_PREDICTIONS_ADDRESS=${matchPredAddr}`,
    `VITE_CHAMPION_POOL_ADDRESS=${champPoolAddr}`,
  ];
  console.log("\n✓ All contracts deployed.\n\nAdd to your .env:");
  envLines.forEach(l => console.log(l));

  // Auto-append to .env if it exists
  try {
    const { readFile, appendFile } = await import("node:fs/promises");
    let env = await readFile(".env", "utf8");
    const toAdd = envLines.filter(l => !env.includes(l.split("=")[0]));
    if (toAdd.length) {
      await appendFile(".env", "\n" + toAdd.join("\n") + "\n");
      console.log("\n✓ .env updated automatically.");
    }
  } catch {}
}

main().catch(e => { console.error(e); process.exitCode = 1; });
