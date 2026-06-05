export const MATCH_PREDICTIONS_ABI = [
  // Betting
  'function placeBet(bytes32 matchId, uint8 outcome) external payable',
  'function claim(bytes32 matchId) external',
  // Settlement — anyone can call settle() once seed committed & 20 min elapsed
  'function openMatch(bytes32 matchId, uint64 kickoff, uint32 homeStrength, uint32 awayStrength) external',
  'function commitSeed(bytes32 matchId, uint32 blockNumber) external',
  'function settle(bytes32 matchId) external',
  'function ownerSettle(bytes32 matchId, uint8 winner) external',
  // Views
  'function getPool(bytes32 matchId) external view returns (uint256 homePool, uint256 drawPool, uint256 awayPool, bool settled, uint8 winner, bool seedCommitted)',
  'function myStakes(bytes32 matchId, address user) external view returns (uint256 home, uint256 draw, uint256 away)',
  'function isFlwcHolder(address user) external view returns (bool)',
  'function owner() view returns (address)',
  'function vault() view returns (address)',
  // Constants
  'function FEE_BPS_STANDARD() view returns (uint256)',
  'function FEE_BPS_HOLDER() view returns (uint256)',
  'function FLWC_THRESHOLD() view returns (uint256)',
  // Events
  'event MatchOpened(bytes32 indexed matchId, uint64 kickoff, uint32 homeStr, uint32 awayStr)',
  'event SeedCommitted(bytes32 indexed matchId, bytes32 seed, uint32 blockNumber)',
  'event BetPlaced(bytes32 indexed matchId, address indexed user, uint8 outcome, uint256 amount)',
  'event MatchSettled(bytes32 indexed matchId, uint8 winner, uint8 homeGoals, uint8 awayGoals)',
  'event Claimed(bytes32 indexed matchId, address indexed user, uint256 payout, bool holderDiscount)',
] as const

export const MATCH_REGISTRY_ABI = [
  'function scheduleMatch(bytes32 matchId, bytes32 homeTeamId, bytes32 awayTeamId, uint64 kickoff, uint32 homeStrength, uint32 awayStrength) external',
  'function commitSeed(bytes32 matchId, uint32 blockNumber) external',
  'function finalizeMatch(bytes32 matchId) external',
  'function computeResult(bytes32 seed, uint256 homeStr, uint256 awayStr) external pure returns (uint8 homeGoals, uint8 awayGoals)',
  'function getMatch(bytes32 matchId) external view returns (tuple(bytes32 homeTeamId, bytes32 awayTeamId, uint64 kickoff, uint32 homeStrength, uint32 awayStrength, bytes32 seed, uint32 seedBlockNumber, uint8 homeScore, uint8 awayScore, uint8 status))',
  'function matchCount() view returns (uint256)',
  'function owner() view returns (address)',
  'event MatchScheduled(bytes32 indexed matchId, bytes32 homeTeamId, bytes32 awayTeamId, uint64 kickoff)',
  'event SeedCommitted(bytes32 indexed matchId, bytes32 seed, uint32 blockNumber)',
  'event MatchFinalized(bytes32 indexed matchId, uint8 homeScore, uint8 awayScore)',
] as const

export const CHAMPION_POOL_ABI = [
  'function predictChampion(bytes32 teamId) external payable',
  'function lock() external',
  'function settle(bytes32 teamId) external',
  'function claim() external',
  'function locked() view returns (bool)',
  'function settled() view returns (bool)',
  'function owner() view returns (address)',
  'function championTeamId() view returns (bytes32)',
  'function totalPool() view returns (uint256)',
  'function teamPools(bytes32) view returns (uint256)',
  'function predictions(bytes32, address) view returns (uint256)',
  'function claimed(address) view returns (bool)',
  'function myPrediction(bytes32 teamId, address user) view returns (uint256)',
  'event PredictionPlaced(address indexed user, bytes32 indexed teamId, uint256 amount)',
  'event Settled(bytes32 indexed championTeamId)',
  'event Claimed(address indexed user, uint256 payout)',
] as const

export const VAULT_ABI = [
  'function totalCollected() view returns (uint256)',
  'function balance() view returns (uint256)',
  'function withdraw(address payable to, uint256 amount) external',
  'function owner() view returns (address)',
  'event FeeReceived(address indexed source, uint256 amount)',
  'event Withdrawn(address indexed to, uint256 amount)',
] as const

// Legacy — kept for backwards compatibility with old deploy
export const PREDICTIONS_ABI = [
  'function predictChampion(bytes32 teamId) external payable',
  'function lockPredictions() external',
  'function settleChampion(bytes32 teamId) external',
  'function claim() external',
  'function locked() view returns (bool)',
  'function settled() view returns (bool)',
  'function owner() view returns (address)',
  'function championTeamId() view returns (bytes32)',
  'function totalPool() view returns (uint256)',
  'function teamPools(bytes32) view returns (uint256)',
  'function predictions(bytes32, address) view returns (uint256)',
  'function claimed(address) view returns (bool)',
] as const
