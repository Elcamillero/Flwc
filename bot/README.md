# FLWC Settlement Bot

Runs 24/7 on Railway. Automatically settles each match when it ends.

## How to deploy on Railway (free)

1. Go to https://railway.app and sign up (free)
2. New Project → Deploy from GitHub repo
3. Select this repo
4. In Settings → Variables, add:
   - BASE_PRIVATE_KEY = your private key
   - BASE_RPC_URL = https://mainnet.base.org
   - VITE_MATCH_PREDICTIONS_ADDRESS = 0xD2810E32A93a8D1AAFA99F94594Ac68E57eC8dD6
   - VITE_FLWC_TOURNAMENT_START_AT = 2026-06-03T00:00:00.000Z
5. In Settings → Deploy, set Start Command to: node bot/settle-bot.mjs

The bot will:
- Check every 45 seconds for finished matches
- Fetch the Base block hash at kickoff time
- Compute the match result (same keccak256 as the contract)
- Call settle() automatically
- Log all settlements with tx hashes
