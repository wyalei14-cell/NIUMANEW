import { BrowserProvider, Contract, Eip1193Provider, JsonRpcProvider, keccak256, Signer, toUtf8Bytes, verifyMessage } from "ethers";

export const XLAYER_TESTNET = {
  chainId: 1952,
  name: "X Layer Testnet",
  rpcUrl: "https://testrpc.xlayer.tech/terigon",
  blockExplorerUrl: "https://www.okx.com/web3/explorer/xlayer-test"
};

export const XLAYER_MAINNET = {
  chainId: 196,
  name: "X Layer",
  rpcUrl: "https://rpc.xlayer.tech",
  blockExplorerUrl: "https://www.okx.com/web3/explorer/xlayer"
};

export type AgentActionType =
  | "PROPOSE"
  | "VOTE"
  | "JOIN_COMPANY"
  | "CREATE_COMPANY"
  | "CLAIM_ISSUE"
  | "SPEAK"
  | "CAMPAIGN_STATEMENT";

export interface AgentAction {
  version: 1;
  actor: string;
  citizenId: number;
  actionType: AgentActionType;
  payload: Record<string, unknown>;
  nonce: number;
  timestamp: number;
  signature?: string;
}

export const citizenRegistryAbi = [
  "function registerCitizen(address owner,string metadataURI) returns (uint256)",
  "function bindAgentKey(uint256 citizenId,bytes agentPubKey)",
  "function bindGithubHandle(uint256 citizenId,string githubHandle)",
  "function updateProfileURI(uint256 citizenId,string metadataURI)",
  "function citizenOf(address owner) view returns (uint256)",
  "function isCitizen(address owner) view returns (bool)",
  "event CitizenRegistered(uint256 indexed citizenId,address indexed owner,string metadataURI)"
];

export const governanceCoreAbi = [
  "function createProposal(uint8 pType,string title,string contentHash) returns (uint256)",
  "function startDiscussion(uint256 proposalId)",
  "function startVoting(uint256 proposalId)",
  "function vote(uint256 proposalId,bool support)",
  "function finalizeProposal(uint256 proposalId)",
  "function markExecuted(uint256 proposalId,string executionHash)",
  "function getProposal(uint256 proposalId) view returns ((uint256 id,uint8 pType,uint8 status,address proposer,string title,string contentHash,string executionHash,uint256 yesVotes,uint256 noVotes,uint256 discussionStartAt,uint256 discussionEndAt,uint256 votingStartAt,uint256 votingEndAt,uint256 createdAt))"
];

export const companyRegistryAbi = [
  "function createCompany(string name,string metadataURI) returns (uint256)",
  "function joinCompany(uint256 companyId)",
  "function leaveCompany(uint256 companyId)",
  "function updateCompanyProfile(uint256 companyId,string metadataURI)",
  "function ownerOfCompany(uint256 companyId) view returns (address)",
  "function companyOf(address citizenWallet) view returns (uint256)"
];

export const worldStateRegistryAbi = [
  "function setConstitutionHash(string constitutionHash)",
  "function submitWorldVersion(uint256 version,string stateHash,string manifestURI)",
  "function latestWorldVersion() view returns (uint256)",
  "function getWorldVersion(uint256 version) view returns ((uint256 version,string stateHash,string manifestURI,address publisher,uint256 createdAt))"
];

export const courseRegistryAbi = [
  "function proposeCourse(string title,string contentHash,uint8 difficulty) returns (uint256)",
  "function activateCourse(uint256 courseId)",
  "function deprecateCourse(uint256 courseId)",
  "function recordCompletion(uint256 courseId)",
  "function getCourse(uint256 courseId) view returns ((uint256 id,address proposer,string title,string contentHash,uint8 difficulty,uint8 status,uint256 createdAt,uint256 activatedAt,uint256 completionCount))",
  "function getCourseStatus(uint256 courseId) view returns (uint8)",
  "function getCourseCount() view returns (uint256)",
  "function setGovernor(address newGovernor)"
];

export const credentialRegistryAbi = [
  "function issueCredential(address citizen,uint256 courseId,string evidenceHash) returns (uint256)",
  "function getCredential(uint256 credentialId) view returns ((uint256 id,address citizen,uint256 courseId,string evidenceHash,uint256 issuedAt,address issuedBy))",
  "function getCredentialsByCitizen(address citizen) view returns (uint256[])",
  "function getCredentialsByCourse(uint256 courseId) view returns (uint256[])",
  "function getCredentialCount() view returns (uint256)",
  "function hasCredentialForCourse(address,uint256) view returns (bool)",
  "function setGovernor(address newGovernor)"
];

export const reputationSystemAbi = [
  "function awardVote(address citizen)",
  "function awardProposalCreated(address citizen)",
  "function awardProposalPassed(address citizen)",
  "function awardCourseCompleted(address citizen)",
  "function awardCredentialEarned(address citizen)",
  "function awardCompanyFounded(address citizen)",
  "function awardCompanyJoined(address citizen)",
  "function getReputation(address citizen) view returns ((uint256 totalPoints,uint256 governancePoints,uint256 academyPoints,uint256 companyPoints,uint256 lastUpdatedAt))",
  "function getTotalPoints(address citizen) view returns (uint256)",
  "function setGovernanceSource(address source)",
  "function setAcademySource(address source)",
  "function setCompanySource(address source)",
  "event ReputationAwarded(address indexed citizen,string reason,uint256 points,uint256 newTotal)"
];

export const citizenDelegateAbi = [
  "function delegate(address delegatee)",
  "function revokeDelegation()",
  "function getVotingPower(address citizen) view returns (uint256)",
  "function getDelegators(address delegatee) view returns (address[])",
  "function hasDelegated(address citizen) view returns (bool)",
  "function delegation(address delegator) view returns (address)",
  "function delegatedCount(address delegatee) view returns (uint256)",
  "event Delegated(address indexed delegator,address indexed delegatee)",
  "event Revoked(address indexed delegator,address indexed delegatee)"
];

export const governanceExecutorAbi = [
  "function queueExecution(uint256 proposalId,address target,uint256 value,bytes data,string metadataURI) returns (uint256)",
  "function execute(uint256 executionId) returns (bytes)",
  "function cancelExecution(uint256 executionId)",
  "function setDelay(uint256 newDelaySeconds)",
  "function delaySeconds() view returns (uint256)",
  "function nextExecutionId() view returns (uint256)",
  "function getExecution(uint256 executionId) view returns ((uint256 proposalId,address target,uint256 value,bytes data,string metadataURI,uint256 earliestExecuteAt,bool executed,bool canceled))",
  "event ExecutionQueued(uint256 indexed executionId,uint256 indexed proposalId,address indexed target,uint256 value,bytes data,string metadataURI,uint256 earliestExecuteAt)",
  "event ExecutionCompleted(uint256 indexed executionId,uint256 indexed proposalId,bytes result)",
  "event ExecutionCanceled(uint256 indexed executionId,uint256 indexed proposalId)"
];

export const electionManagerAbi = [
  "function openRound() returns (uint256)",
  "function nominate(uint256 roundId,string statementURI)",
  "function startVoting(uint256 roundId)",
  "function voteForMayor(uint256 roundId,address candidate)",
  "function finalizeRound(uint256 roundId)",
  "function getRound(uint256 roundId) view returns ((uint256 id,uint8 status,uint256 startAt,uint256 endAt,address winner,address[] candidates))"
];

export const serviceMarketplaceAbi = [
  "function postService(string title,string description,string category,uint256 price,uint256 maxDuration) returns (uint256)",
  "function acceptService(uint256 serviceId) payable",
  "function completeService(uint256 serviceId)",
  "function disputeService(uint256 serviceId)",
  "function resolveDispute(uint256 serviceId,uint8 resolution)",
  "function cancelService(uint256 serviceId)",
  "function postReview(uint256 serviceId,uint8 rating,string comment)",
  "function getService(uint256 serviceId) view returns ((uint256 id,address provider,uint256 providerCitizenId,string title,string description,string category,uint256 price,uint256 maxDuration,uint8 status,address client,uint256 clientCitizenId,uint256 escrowAmount,uint256 acceptedAt,uint256 completedAt,uint256 createdAt,uint256[] reviewIds))",
  "function getReview(uint256 reviewId) view returns ((uint256 id,uint256 serviceId,address reviewer,uint8 rating,string comment,uint256 createdAt))",
  "function getMarketplaceStats() view returns (uint256 posted,uint256 completed,uint256 volume,uint256 feeBps)",
  "function nextServiceId() view returns (uint256)",
  "function nextReviewId() view returns (uint256)",
  "function platformFeeBps() view returns (uint256)",
  "function totalServicesPosted() view returns (uint256)",
  "function totalServicesCompleted() view returns (uint256)",
  "function totalVolume() view returns (uint256)",
  "event ServicePosted(uint256 indexed serviceId,uint256 indexed providerCitizenId,address indexed provider,string title,string category,uint256 price)",
  "event ServiceAccepted(uint256 indexed serviceId,address indexed client,uint256 clientCitizenId,uint256 escrowAmount)",
  "event ServiceCompleted(uint256 indexed serviceId)",
  "event ServiceDisputed(uint256 indexed serviceId,address indexed disputer)",
  "event ServiceCanceled(uint256 indexed serviceId,address indexed canceller)",
  "event ReviewPosted(uint256 indexed reviewId,uint256 indexed serviceId,uint8 rating,address reviewer)"
];

export function createReadProvider(rpcUrl = XLAYER_TESTNET.rpcUrl) {
  return new JsonRpcProvider(rpcUrl);
}

export async function createBrowserSigner() {
  const ethereum = (globalThis as unknown as { ethereum?: Eip1193Provider }).ethereum;
  if (!ethereum) throw new Error("No EVM wallet found");
  const provider = new BrowserProvider(ethereum);
  await provider.send("eth_requestAccounts", []);
  return provider.getSigner();
}

export function getContract(address: string, abi: readonly string[], signerOrProvider: Signer | JsonRpcProvider | BrowserProvider) {
  return new Contract(address, abi, signerOrProvider);
}

export function canonicalAction(action: Omit<AgentAction, "signature">): string {
  return JSON.stringify(sortObject(action));
}

export function actionHash(action: Omit<AgentAction, "signature">): string {
  return keccak256(toUtf8Bytes(canonicalAction(action)));
}

export async function signAgentAction(signer: Signer, action: Omit<AgentAction, "signature">): Promise<AgentAction> {
  const signature = await signer.signMessage(canonicalAction(action));
  return { ...action, signature };
}

export function verifyAgentAction(action: AgentAction): string {
  if (!action.signature) throw new Error("Missing action signature");
  return verifyMessage(canonicalAction({ ...action, signature: undefined } as Omit<AgentAction, "signature">), action.signature);
}

export async function switchToXLayer(target: typeof XLAYER_TESTNET | typeof XLAYER_MAINNET = XLAYER_TESTNET) {
  const ethereum = (globalThis as unknown as { ethereum?: { request(args: { method: string; params?: unknown[] }): Promise<unknown> } }).ethereum;
  if (!ethereum) throw new Error("No EVM wallet found");
  const chainIdHex = `0x${target.chainId.toString(16)}`;
  try {
    await ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: chainIdHex }] });
  } catch {
    await ethereum.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: chainIdHex,
          chainName: target.name,
          nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
          rpcUrls: [target.rpcUrl],
          blockExplorerUrls: [target.blockExplorerUrl]
        }
      ]
    });
  }
}

function sortObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObject);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, nested]) => [key, sortObject(nested)]));
  }
  return value;
}
