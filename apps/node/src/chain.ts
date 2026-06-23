import fs from "node:fs";
import path from "node:path";
import { Contract, JsonRpcProvider } from "ethers";
import { addEvent, hasEvent } from "./store.js";
import { WorldEvent } from "@niuma/reducer";

const citizenAbi = [
  "event CitizenRegistered(uint256 indexed citizenId,address indexed owner,string metadataURI)",
  "event AgentKeyBound(uint256 indexed citizenId,bytes agentPubKey)",
  "event GithubHandleBound(uint256 indexed citizenId,string githubHandle)",
  "event ProfileUpdated(uint256 indexed citizenId,string metadataURI)"
];

const governanceAbi = [
  "event ProposalCreated(uint256 indexed proposalId,address indexed proposer,uint8 pType,string title,string contentHash)",
  "event ProposalDiscussionStarted(uint256 indexed proposalId,uint256 startAt,uint256 endAt)",
  "event ProposalVotingStarted(uint256 indexed proposalId,uint256 startAt,uint256 endAt)",
  "event VoteCast(uint256 indexed proposalId,uint256 indexed citizenId,address indexed voter,bool support)",
  "event ProposalFinalized(uint256 indexed proposalId,uint8 status,uint256 yesVotes,uint256 noVotes)",
  "event ProposalExecuted(uint256 indexed proposalId,string executionHash)"
];

const companyAbi = [
  "event CompanyCreated(uint256 indexed companyId,address indexed owner,string name,string metadataURI)",
  "event CompanyJoined(uint256 indexed companyId,address indexed member)",
  "event CompanyLeft(uint256 indexed companyId,address indexed member)",
  "event CompanyProfileUpdated(uint256 indexed companyId,string metadataURI)"
];

const roleAbi = ["event MayorAssigned(address indexed mayor,uint256 startAt,uint256 endAt)"];

const courseAbi = [
  "event CourseProposed(uint256 indexed courseId,address indexed proposer,string title,string contentHash,uint8 difficulty)",
  "event CourseActivated(uint256 indexed courseId)",
  "event CourseDeprecated(uint256 indexed courseId)",
  "event CourseCompleted(uint256 indexed courseId,address indexed citizen)"
];

const credentialAbi = [
  "event CredentialIssued(uint256 indexed credentialId,address indexed citizen,uint256 indexed courseId,string evidenceHash)"
];

const reputationAbi = [
  "event ReputationAwarded(address indexed citizen,string reason,uint256 points,uint256 newTotal)"
];

const delegateAbi = [
  "event Delegated(address indexed delegator,address indexed delegatee)",
  "event Revoked(address indexed delegator,address indexed delegatee)"
];

const governanceExecutorAbi = [
  "event ExecutionQueued(uint256 indexed executionId,uint256 indexed proposalId,address indexed target,uint256 value,bytes data,string metadataURI,uint256 earliestExecuteAt)",
  "event ExecutionCompleted(uint256 indexed executionId,uint256 indexed proposalId,bytes result)",
  "event ExecutionCanceled(uint256 indexed executionId,uint256 indexed proposalId)"
];

const marketplaceAbi = [
  "event ServicePosted(uint256 indexed serviceId,uint256 indexed providerCitizenId,address indexed provider,string title,string category,uint256 price)",
  "event ServiceAccepted(uint256 indexed serviceId,address indexed client,uint256 clientCitizenId,uint256 escrowAmount)",
  "event ServiceCompleted(uint256 indexed serviceId)",
  "event ServiceDisputed(uint256 indexed serviceId,address indexed disputer)",
  "event ServiceCanceled(uint256 indexed serviceId,address indexed canceller)",
  "event ReviewPosted(uint256 indexed reviewId,uint256 indexed serviceId,uint8 rating,address reviewer)"
];

const serviceStatuses = ["Open", "Accepted", "Completed", "Canceled", "Disputed"];

const proposalTypes = ["Feature", "Governance", "District", "Company"];
const proposalStatuses = ["Draft", "Discussion", "Voting", "Passed", "Rejected", "Executed"];

type Deployment = {
  chainId: number;
  contracts: Record<string, string>;
};

type ChainSyncStatus = {
  ok: boolean;
  fromBlock?: number;
  latest?: number;
  added?: number;
  syncedAt: number;
  reason?: string;
  error?: string;
};

let lastChainSync: ChainSyncStatus | null = null;
let syncInFlight: Promise<ChainSyncStatus> | null = null;

export async function syncChainEvents() {
  if (syncInFlight) return syncInFlight;
  syncInFlight = syncChainEventsOnce().finally(() => {
    syncInFlight = null;
  });
  return syncInFlight;
}

async function syncChainEventsOnce() {
  const deployment = loadDeployment();
  if (!deployment) {
    lastChainSync = { ok: false, reason: "deployment not found", syncedAt: Math.floor(Date.now() / 1000) };
    return lastChainSync;
  }

  try {
    const rpcUrl = process.env.XLAYER_TESTNET_RPC || "https://testrpc.xlayer.tech/terigon";
    const provider = new JsonRpcProvider(rpcUrl);
    const latest = await withRpcRetry(() => provider.getBlockNumber());
    const fromBlock = Number(process.env.CHAIN_START_BLOCK || Math.max(0, latest - 1000));

    const contracts = [
      { name: "CitizenRegistry", address: deployment.contracts.CitizenRegistry, abi: citizenAbi, mapper: mapCitizenEvent },
      { name: "GovernanceCore", address: deployment.contracts.GovernanceCore, abi: governanceAbi, mapper: mapGovernanceEvent },
      { name: "CompanyRegistry", address: deployment.contracts.CompanyRegistry, abi: companyAbi, mapper: mapCompanyEvent },
      { name: "RoleManager", address: deployment.contracts.RoleManager, abi: roleAbi, mapper: mapRoleEvent },
      { name: "CourseRegistry", address: deployment.contracts.CourseRegistry, abi: courseAbi, mapper: mapCourseEvent },
      { name: "CredentialRegistry", address: deployment.contracts.CredentialRegistry, abi: credentialAbi, mapper: mapCredentialEvent },
      { name: "ReputationSystem", address: deployment.contracts.ReputationSystem, abi: reputationAbi, mapper: mapReputationEvent },
      { name: "CitizenDelegate", address: deployment.contracts.CitizenDelegate, abi: delegateAbi, mapper: mapDelegateEvent },
      { name: "GovernanceExecutor", address: deployment.contracts.GovernanceExecutor, abi: governanceExecutorAbi, mapper: mapGovernanceExecutorEvent },
      { name: "ServiceMarketplace", address: deployment.contracts.ServiceMarketplace, abi: marketplaceAbi, mapper: mapMarketplaceEvent }
    ];

    let added = 0;
    for (const item of contracts) {
      if (!item.address) continue;
      const contract = new Contract(item.address, item.abi, provider);
      const chunkSize = Number(process.env.CHAIN_LOG_CHUNK_SIZE || 95);
      for (let start = fromBlock; start <= latest; start += chunkSize) {
        const end = Math.min(latest, start + chunkSize - 1);
        const logs = await withRpcRetry(() => contract.queryFilter("*", start, end));
        for (const log of logs) {
          const mapped = item.mapper(log);
          if (mapped && !hasEvent(mapped.id)) {
            addEvent(mapped);
            added += 1;
          }
        }
      }
    }

    lastChainSync = { ok: true, fromBlock, latest, added, syncedAt: Math.floor(Date.now() / 1000) };
    return lastChainSync;
  } catch (error) {
    lastChainSync = {
      ok: false,
      error: error instanceof Error ? error.message : "unknown chain sync error",
      syncedAt: Math.floor(Date.now() / 1000)
    };
    throw error;
  }
}

export function getChainSyncStatus() {
  return lastChainSync;
}

function mapCitizenEvent(log: any): WorldEvent | undefined {
  const event = log.fragment?.name;
  if (event !== "CitizenRegistered") return undefined;
  return {
    id: chainEventId(log),
    source: "chain",
    type: "CitizenRegistered",
    blockNumber: log.blockNumber,
    logIndex: log.index,
    payload: {
      citizenId: Number(log.args.citizenId),
      owner: log.args.owner,
      metadataURI: log.args.metadataURI
    }
  };
}

function mapGovernanceEvent(log: any): WorldEvent | undefined {
  const event = log.fragment?.name;
  if (event === "ProposalCreated") {
    return {
      id: chainEventId(log),
      source: "chain",
      type: "ProposalCreated",
      blockNumber: log.blockNumber,
      logIndex: log.index,
      payload: {
        proposalId: Number(log.args.proposalId),
        proposer: log.args.proposer,
        pType: proposalTypes[Number(log.args.pType)] || String(log.args.pType),
        title: log.args.title,
        contentHash: log.args.contentHash
      }
    };
  }
  if (event === "VoteCast") {
    return {
      id: chainEventId(log),
      source: "chain",
      type: "VoteCast",
      blockNumber: log.blockNumber,
      logIndex: log.index,
      payload: {
        proposalId: Number(log.args.proposalId),
        citizenId: Number(log.args.citizenId),
        voter: log.args.voter,
        support: Boolean(log.args.support)
      }
    };
  }
  if (event === "ProposalDiscussionStarted") {
    return {
      id: chainEventId(log),
      source: "chain",
      type: "ProposalDiscussionStarted",
      blockNumber: log.blockNumber,
      logIndex: log.index,
      payload: {
        proposalId: Number(log.args.proposalId),
        startAt: Number(log.args.startAt),
        endAt: Number(log.args.endAt)
      }
    };
  }
  if (event === "ProposalVotingStarted") {
    return {
      id: chainEventId(log),
      source: "chain",
      type: "ProposalVotingStarted",
      blockNumber: log.blockNumber,
      logIndex: log.index,
      payload: {
        proposalId: Number(log.args.proposalId),
        startAt: Number(log.args.startAt),
        endAt: Number(log.args.endAt)
      }
    };
  }
  if (event === "ProposalFinalized") {
    return {
      id: chainEventId(log),
      source: "chain",
      type: "ProposalFinalized",
      blockNumber: log.blockNumber,
      logIndex: log.index,
      payload: {
        proposalId: Number(log.args.proposalId),
        status: proposalStatuses[Number(log.args.status)] || String(log.args.status),
        yesVotes: Number(log.args.yesVotes),
        noVotes: Number(log.args.noVotes)
      }
    };
  }
  if (event === "ProposalExecuted") {
    return {
      id: chainEventId(log),
      source: "chain",
      type: "ProposalExecuted",
      blockNumber: log.blockNumber,
      logIndex: log.index,
      payload: {
        proposalId: Number(log.args.proposalId),
        executionHash: log.args.executionHash
      }
    };
  }
  return undefined;
}

function mapCompanyEvent(log: any): WorldEvent | undefined {
  const event = log.fragment?.name;
  if (event === "CompanyCreated") {
    return {
      id: chainEventId(log),
      source: "chain",
      type: "CompanyCreated",
      blockNumber: log.blockNumber,
      logIndex: log.index,
      payload: {
        companyId: Number(log.args.companyId),
        owner: log.args.owner,
        name: log.args.name,
        metadataURI: log.args.metadataURI
      }
    };
  }
  if (event === "CompanyJoined") {
    return {
      id: chainEventId(log),
      source: "chain",
      type: "CompanyJoined",
      blockNumber: log.blockNumber,
      logIndex: log.index,
      payload: {
        companyId: Number(log.args.companyId),
        member: log.args.member
      }
    };
  }
  if (event === "CompanyLeft") {
    return {
      id: chainEventId(log),
      source: "chain",
      type: "CompanyLeft",
      blockNumber: log.blockNumber,
      logIndex: log.index,
      payload: {
        companyId: Number(log.args.companyId),
        member: log.args.member
      }
    };
  }
  return undefined;
}

function mapRoleEvent(log: any): WorldEvent | undefined {
  if (log.fragment?.name !== "MayorAssigned") return undefined;
  return {
    id: chainEventId(log),
    source: "chain",
    type: "MayorAssigned",
    blockNumber: log.blockNumber,
    logIndex: log.index,
    payload: {
      mayor: log.args.mayor,
      startAt: Number(log.args.startAt),
      endAt: Number(log.args.endAt)
    }
  };
}

function mapCourseEvent(log: any): WorldEvent | undefined {
  const event = log.fragment?.name;
  if (event === "CourseProposed") {
    return {
      id: chainEventId(log),
      source: "chain",
      type: "CourseProposed",
      blockNumber: log.blockNumber,
      logIndex: log.index,
      payload: {
        courseId: Number(log.args.courseId),
        proposer: log.args.proposer,
        title: log.args.title,
        contentHash: log.args.contentHash,
        difficulty: Number(log.args.difficulty)
      }
    };
  }
  if (event === "CourseActivated") {
    return {
      id: chainEventId(log),
      source: "chain",
      type: "CourseActivated",
      blockNumber: log.blockNumber,
      logIndex: log.index,
      payload: { courseId: Number(log.args.courseId) }
    };
  }
  if (event === "CourseDeprecated") {
    return {
      id: chainEventId(log),
      source: "chain",
      type: "CourseDeprecated",
      blockNumber: log.blockNumber,
      logIndex: log.index,
      payload: { courseId: Number(log.args.courseId) }
    };
  }
  if (event === "CourseCompleted") {
    return {
      id: chainEventId(log),
      source: "chain",
      type: "CourseCompleted",
      blockNumber: log.blockNumber,
      logIndex: log.index,
      payload: { courseId: Number(log.args.courseId), citizen: log.args.citizen }
    };
  }
  return undefined;
}

function mapCredentialEvent(log: any): WorldEvent | undefined {
  if (log.fragment?.name !== "CredentialIssued") return undefined;
  return {
    id: chainEventId(log),
    source: "chain",
    type: "CredentialIssued",
    blockNumber: log.blockNumber,
    logIndex: log.index,
    payload: {
      credentialId: Number(log.args.credentialId),
      citizen: log.args.citizen,
      courseId: Number(log.args.courseId),
      evidenceHash: log.args.evidenceHash
    }
  };
}

function mapReputationEvent(log: any): WorldEvent | undefined {
  if (log.fragment?.name !== "ReputationAwarded") return undefined;
  return {
    id: chainEventId(log),
    source: "chain",
    type: "ReputationAwarded",
    blockNumber: log.blockNumber,
    logIndex: log.index,
    payload: {
      citizen: log.args.citizen,
      reason: log.args.reason,
      points: Number(log.args.points),
      newTotal: Number(log.args.newTotal)
    }
  };
}

function mapDelegateEvent(log: any): WorldEvent | undefined {
  const event = log.fragment?.name;
  if (event === "Delegated") {
    return {
      id: chainEventId(log),
      source: "chain",
      type: "Delegated",
      blockNumber: log.blockNumber,
      logIndex: log.index,
      payload: { delegator: log.args.delegator, delegatee: log.args.delegatee }
    };
  }
  if (event === "Revoked") {
    return {
      id: chainEventId(log),
      source: "chain",
      type: "Revoked",
      blockNumber: log.blockNumber,
      logIndex: log.index,
      payload: { delegator: log.args.delegator, delegatee: log.args.delegatee }
    };
  }
  return undefined;
}

function mapGovernanceExecutorEvent(log: any): WorldEvent | undefined {
  const event = log.fragment?.name;
  if (event === "ExecutionQueued") {
    return {
      id: chainEventId(log),
      source: "chain",
      type: "ExecutionQueued",
      blockNumber: log.blockNumber,
      logIndex: log.index,
      payload: {
        executionId: Number(log.args.executionId),
        proposalId: Number(log.args.proposalId),
        target: log.args.target,
        value: log.args.value.toString(),
        data: log.args.data,
        metadataURI: log.args.metadataURI,
        earliestExecuteAt: Number(log.args.earliestExecuteAt)
      }
    };
  }
  if (event === "ExecutionCompleted") {
    return {
      id: chainEventId(log),
      source: "chain",
      type: "ExecutionCompleted",
      blockNumber: log.blockNumber,
      logIndex: log.index,
      payload: {
        executionId: Number(log.args.executionId),
        proposalId: Number(log.args.proposalId),
        result: log.args.result
      }
    };
  }
  if (event === "ExecutionCanceled") {
    return {
      id: chainEventId(log),
      source: "chain",
      type: "ExecutionCanceled",
      blockNumber: log.blockNumber,
      logIndex: log.index,
      payload: {
        executionId: Number(log.args.executionId),
        proposalId: Number(log.args.proposalId)
      }
    };
  }
  return undefined;
}

function mapMarketplaceEvent(log: any): any | undefined {
  const event = log.fragment?.name;
  if (!event) return undefined;
  const base = { id: chainEventId(log), source: "chain" as const, blockNumber: log.blockNumber, logIndex: log.index };
  switch (event) {
    case "ServicePosted":
      return { ...base, type: "ServicePosted", payload: { serviceId: Number(log.args.serviceId), providerCitizenId: Number(log.args.providerCitizenId), provider: log.args.provider, title: log.args.title, category: log.args.category, price: log.args.price.toString() } };
    case "ServiceAccepted":
      return { ...base, type: "ServiceAccepted", payload: { serviceId: Number(log.args.serviceId), client: log.args.client, clientCitizenId: Number(log.args.clientCitizenId), escrowAmount: log.args.escrowAmount.toString() } };
    case "ServiceCompleted":
      return { ...base, type: "ServiceCompleted", payload: { serviceId: Number(log.args.serviceId) } };
    case "ServiceDisputed":
      return { ...base, type: "ServiceDisputed", payload: { serviceId: Number(log.args.serviceId), disputer: log.args.disputer } };
    case "ServiceCanceled":
      return { ...base, type: "ServiceCanceled", payload: { serviceId: Number(log.args.serviceId), canceller: log.args.canceller } };
    case "ReviewPosted":
      return { ...base, type: "ReviewPosted", payload: { reviewId: Number(log.args.reviewId), serviceId: Number(log.args.serviceId), rating: Number(log.args.rating), reviewer: log.args.reviewer } };
    default:
      return undefined;
  }
}

function chainEventId(log: any) {
  return `chain-${log.blockNumber}-${log.transactionIndex}-${log.index}-${log.transactionHash}`;
}

function loadDeployment(): Deployment | null {
  const configured = process.env.CITIZEN_REGISTRY
    ? {
        chainId: 1952,
        contracts: {
          CitizenRegistry: process.env.CITIZEN_REGISTRY,
          GovernanceCore: process.env.GOVERNANCE_CORE || "",
          RoleManager: process.env.ROLE_MANAGER || "",
          CompanyRegistry: process.env.COMPANY_REGISTRY || "",
          CourseRegistry: process.env.COURSE_REGISTRY || "",
          CredentialRegistry: process.env.CREDENTIAL_REGISTRY || "",
          ReputationSystem: process.env.REPUTATION_SYSTEM || "",
          CitizenDelegate: process.env.CITIZEN_DELEGATE || "",
          GovernanceExecutor: process.env.GOVERNANCE_EXECUTOR || ""
        }
      }
    : null;
  if (configured) return configured;

  const candidates = [
    path.resolve(process.cwd(), "world", "deployments", "1952.json"),
    path.resolve(process.cwd(), "..", "..", "world", "deployments", "1952.json")
  ];
  const filePath = candidates.find((candidate) => fs.existsSync(candidate));
  if (!filePath) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as Deployment;
}

async function withRpcRetry<T>(operation: () => Promise<T>, attempts = Number(process.env.CHAIN_RPC_RETRY_ATTEMPTS || 3)): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await delay(Number(process.env.CHAIN_RPC_RETRY_DELAY_MS || 750) * attempt);
      }
    }
  }
  throw lastError;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
