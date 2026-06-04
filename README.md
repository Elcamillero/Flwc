# Fantasy League World Cup

Fantasy League World Cup is a crypto-native football tournament for Ethereum:
official roster data, AI-simulated matches, live web broadcasts, player NFTs, and
champion prediction markets.

## Product Direction

- **Name:** Fantasy League World Cup
- **Roster:** built for official players through a licensed roster data layer
- **Simulation:** AI match engine runs off-chain, then publishes deterministic
  match results and event hashes
- **Blockchain:** Ethereum stores player ownership, prediction pools, match seeds,
  and settlement events
- **Broadcast:** the web app renders scheduled matches as live tactical replays

## Official Players Policy

The product is designed to support official league players, but the app should not
hard-code player names, portraits, club badges, federation marks, or proprietary
ratings unless the project has the correct license or an authorized data provider.

Current frontend data uses "Licensed Player Slot" placeholders so the schema is
ready for an official roster feed without exposing unlicensed content.

## MVP Scope

1. Web dashboard for Fantasy League World Cup.
2. Match schedule and FootballEvo-powered live broadcast preview.
3. Official-player-ready roster cards with game-style attributes.
4. Champion prediction market UI.
5. Ethereum prediction pool prototype contract.

## FootballEvo Simulation

The web broadcast uses assets extracted from the local FootballEvo jar provided at:

```text
D:\DESCARGAS\footballevo.jar
```

Extracted web assets live in:

```text
public/footballevo
```

The original Java game can be launched locally with:

```bash
npm run footballevo
```

## Development

```bash
npm install
npm run dev
```

## Smart Contract

The prototype prediction pool lives at:

```text
contracts/FantasyLeagueWorldCupPredictions.sol
```

The current Sepolia-ready contract set is:

- `contracts/PlayerNFT.sol`: ERC-721 player ownership and player stats.
- `contracts/MatchRegistry.sol`: fixture registry, seed commitments, scores,
  and replay hashes for AI simulations.
- `contracts/FantasyLeagueWorldCupPredictions.sol`: champion prediction pool.

They are not audited and should not be deployed to mainnet without legal review,
security review, oracle integration, and gambling/regulatory compliance.

## Sepolia Deployment

Create a local `.env` file from `.env.example`:

```bash
SEPOLIA_RPC_URL=https://sepolia.infura.io/v3/YOUR_KEY
SEPOLIA_PRIVATE_KEY=0xYOUR_TESTNET_PRIVATE_KEY
```

The private key must be for a testnet wallet with Sepolia ETH.

Compile:

```bash
npm run contracts:compile
```

Deploy:

```bash
npm run deploy:sepolia
```

Successful deployments are written to:

```text
deployments/sepolia.json
```
