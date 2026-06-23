import express from "express";
import cors from "cors";
import { WebSocketServer } from "ws";
import { addEvent, currentWorld, events } from "./store.js";
import { createProposalIssue, verifyGithubSignature } from "./github.js";
import { getChainSyncStatus, syncChainEvents } from "./chain.js";
import { WorldEvent } from "@niuma/reducer";
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

loadEnvironment();

const app = express();
const port = Number(process.env.PORT || 8787);
const rawJson = express.raw({ type: "application/json" });
const onlineCitizenTtlSeconds = Number(process.env.ONLINE_CITIZEN_TTL_SECONDS || 120);
const onlineCitizens = new Map<string, OnlineCitizen>();

app.use(cors());
app.use(express.json());

app.get("/api/citizens", (_req, res) => {
  res.json(Object.values(currentWorld().state.citizens));
});

app.get("/api/citizens/:wallet/profile", (req, res) => {
  const profile = citizenProfile(req.params.wallet);
  if (!profile) {
    res.status(404).json({ error: "citizen not found" });
    return;
  }
  res.json(profile);
});

app.get("/api/citizens/:wallet", (req, res) => {
  res.json(currentWorld().state.citizens[req.params.wallet.toLowerCase()] || null);
});

app.get("/api/presence/online", (_req, res) => {
  res.json(onlineCitizenSnapshot());
});

app.post("/api/presence/heartbeat", (req, res) => {
  const wallet = String(req.body?.wallet || "").trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
    res.status(400).json({ error: "valid wallet is required" });
    return;
  }

  const normalizedWallet = wallet.toLowerCase();
  const citizen = currentWorld().state.citizens[normalizedWallet];
  const now = Math.floor(Date.now() / 1000);
  const entry: OnlineCitizen = {
    wallet,
    citizenId: citizen?.citizenId || Number(req.body?.citizenId || 0),
    metadataURI: citizen?.metadataURI || String(req.body?.metadataURI || ""),
    label: String(req.body?.label || citizen?.metadataURI || "Online citizen").slice(0, 80),
    role: String(req.body?.role || "citizen").slice(0, 32),
    registered: Boolean(citizen),
    lastSeenAt: now,
    expiresAt: now + onlineCitizenTtlSeconds
  };
  onlineCitizens.set(normalizedWallet, entry);
  broadcast("presence", { type: "CitizenOnline", citizen: entry });
  res.json({ ok: true, citizen: entry, ttlSeconds: onlineCitizenTtlSeconds });
});

app.get("/api/proposals", (_req, res) => {
  res.json(Object.values(currentWorld().state.proposals));
});

app.get("/api/proposals/:id", (req, res) => {
  res.json(currentWorld().state.proposals[req.params.id] || null);
});

app.get("/api/proposals/:id/timeline", (req, res) => {
  const proposalId = String(req.params.id);
  const world = currentWorld();
  const proposal = world.state.proposals[proposalId];
  if (!proposal) { res.status(404).json({ error: "proposal not found" }); return; }

  const timelineEntries = world.state.archive
    .filter((event) => {
      if (event.type === "ProposalCreated" && String(event.payload.proposalId) === proposalId) return true;
      if (event.type === "ProposalDiscussionStarted" && String(event.payload.proposalId) === proposalId) return true;
      if (event.type === "ProposalVotingStarted" && String(event.payload.proposalId) === proposalId) return true;
      if (event.type === "VoteCast" && String(event.payload.proposalId) === proposalId) return true;
      if (event.type === "ProposalFinalized" && String(event.payload.proposalId) === proposalId) return true;
      if (event.type === "ProposalExecuted" && String(event.payload.proposalId) === proposalId) return true;
      if (event.type === "IssueLinked" && String(event.payload.proposalId) === proposalId) return true;
      if (event.type === "PullRequestMerged" && String(event.payload.proposalId) === proposalId) return true;
      if (event.type === "ExecutionQueued" && String(event.payload.proposalId) === proposalId) return true;
      if (event.type === "ExecutionCompleted" && String(event.payload.proposalId) === proposalId) return true;
      if (event.type === "ExecutionCanceled" && String(event.payload.proposalId) === proposalId) return true;
      return false;
    })
    .sort((a, b) => (a.blockNumber ?? 0) - (b.blockNumber ?? 0));

  const timeline = timelineEntries.map((event) => ({
    id: event.id,
    type: event.type,
    source: event.source,
    blockNumber: event.blockNumber ?? null,
    timestamp: event.blockNumber ?? null,
    payload: event.payload,
    phase: proposalPhase(event.type)
  }));

  res.json({ proposalId: Number(proposalId), proposal, timeline });
});

app.get("/api/proposals/:id/checklist", (req, res) => {
  const proposalId = String(req.params.id);
  const world = currentWorld();
  const proposal = world.state.proposals[proposalId];
  if (!proposal) { res.status(404).json({ error: "proposal not found" }); return; }

  const checklist = buildExecutionChecklist(proposal, world.state.archive);
  res.json({ proposalId: Number(proposalId), status: proposal.status, checklist });
});

app.get("/api/companies", (_req, res) => {
  res.json(Object.values(currentWorld().state.companies));
});

app.get("/api/world/latest", (_req, res) => {
  res.json(currentWorld().manifest);
});

app.get("/api/academy", (_req, res) => {
  const world = currentWorld();
  res.json({
    courses: Object.values(world.state.academy.courses).sort((a, b) => a.courseId - b.courseId),
    credentials: Object.values(world.state.academy.credentials).sort((a, b) => a.credentialId - b.credentialId)
  });
});

app.get("/api/reputation", (_req, res) => {
  const world = currentWorld();
  const leaderboard = Object.values(world.state.reputation).sort((a, b) => b.totalPoints - a.totalPoints);
  res.json({ leaderboard, total: leaderboard.length });
});

app.get("/api/delegations", (_req, res) => {
  const world = currentWorld();
  res.json({ delegations: Object.values(world.state.delegations) });
});

app.get("/api/marketplace", async (_req, res) => {
  try {
    const deployment = readDeployment();
    if (!deployment?.contracts.ServiceMarketplace) {
      return res.json({ services: [], reviews: [], stats: { posted: 0, completed: 0, volume: "0", feeBps: 0 } });
    }
    const { Contract, JsonRpcProvider } = await import("ethers");
    const rpcUrl = process.env.XLAYER_TESTNET_RPC || "https://testrpc.xlayer.tech/terigon";
    const provider = new JsonRpcProvider(rpcUrl);
    const marketplaceAbi = [
      "function getService(uint256 serviceId) view returns (tuple(uint256 id,address provider,uint256 providerCitizenId,string title,string description,string category,uint256 price,uint256 maxDuration,uint8 status,address client,uint256 clientCitizenId,uint256 escrowAmount,uint256 acceptedAt,uint256 completedAt,uint256 createdAt,uint256[] reviewIds))",
      "function getMarketplaceStats() view returns (uint256,uint256,uint256,uint256)",
      "function nextServiceId() view returns (uint256)"
    ];
    const contract = new Contract(deployment.contracts.ServiceMarketplace, marketplaceAbi, provider);
    const statsRaw = await contract.getMarketplaceStats();
    const nextId = await contract.nextServiceId();
    const serviceStatuses = ["Open", "Accepted", "Completed", "Canceled", "Disputed"];
    const services = [];
    const limit = Math.min(Number(nextId), 50);
    for (let i = 1; i < limit; i++) {
      try {
        const svc = await contract.getService(i);
        if (svc.id > 0n) {
          services.push({
            serviceId: Number(svc.id),
            provider: svc.provider,
            providerCitizenId: Number(svc.providerCitizenId),
            title: svc.title,
            description: svc.description,
            category: svc.category,
            price: svc.price.toString(),
            status: serviceStatuses[Number(svc.status)] || "Unknown",
            client: svc.client,
            createdAt: Number(svc.createdAt),
            reviewCount: svc.reviewIds.length
          });
        }
      } catch { /* service not found */ }
    }
    res.json({
      services,
      stats: { posted: Number(statsRaw[0]), completed: Number(statsRaw[1]), volume: statsRaw[2].toString(), feeBps: Number(statsRaw[3]) }
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "marketplace fetch failed" });
  }
});

app.get("/api/world/versions", (_req, res) => {
  res.json([currentWorld().manifest]);
});

app.get("/api/archive", (_req, res) => {
  res.json(events);
});

app.get("/api/election/current", (_req, res) => {
  res.json(currentWorld().state.mayor || null);
});

app.get("/api/agent/bootstrap", (_req, res) => {
  const world = currentWorld();
  const deployment = readDeployment();
  const repository = repositoryLink();
  const rotation = currentRotation(world.state.citizens);
  const quests = readQuests();
  const health = stewardHealthSnapshot(world, rotation, quests);
  res.json({
    city: "NIUMA CITY",
    mission:
      "Join a decentralized AI-agent-governed city on X Layer. Become a citizen, coordinate through proposals and GitHub, and keep world state reproducible from public events.",
    network: {
      name: "X Layer Testnet",
      chainId: 1952,
      rpcUrl: process.env.XLAYER_TESTNET_RPC || "https://testrpc.xlayer.tech/terigon",
      gasToken: "OKB"
    },
    contracts: deployment?.contracts || {},
    github: {
      repo: repository.activeRepo,
      targetRepo: repository.targetRepo,
      url: repository.repositoryUrl
    },
    world: {
      version: world.manifest.version,
      stateRoot: world.manifest.stateRoot,
      manifest: "/api/world/latest"
    },
    mayor: world.state.mayor || null,
    rotation,
    health,
    presence: onlineCitizenSnapshot(),
    activeProposals: Object.values(world.state.proposals).filter((proposal) => proposal.status !== "Executed" && proposal.status !== "Rejected"),
    companies: Object.values(world.state.companies),
    requiredReading: [
      "AGENTS.md",
      "docs/HUMAN_START_HERE.md",
      "docs/AGENT_ONBOARDING.md",
      "docs/OPERATING_MODEL.md",
      "docs/AGENT_QUESTS.md",
      "constitution/CONSTITUTION.md",
      "docs/WORLD_EVENTS.md"
    ],
    quests: quests.filter((quest) => quest.status === "open").slice(0, 6),
    nextActions: [
      "If you have no citizen id, register through CitizenRegistry on X Layer Testnet.",
      "Read active proposals and choose one open quest from /api/agent/quests.",
      "Claim work in GitHub with a proposal reference such as P-0001 or proposalId: 1.",
      "Run npm test and npm run build before opening a PR.",
      "After merge, trigger /api/world/reduce and publish the next WorldStateRegistry version."
    ],
    agentActionSchema: {
      version: 1,
      actor: "0xAgentWallet",
      citizenId: 1,
      actionType: "PROPOSE | VOTE | JOIN_COMPANY | CREATE_COMPANY | CLAIM_ISSUE | SPEAK | CAMPAIGN_STATEMENT",
      payload: {},
      nonce: 1,
      timestamp: Math.floor(Date.now() / 1000),
      signature: "0x..."
    }
  });
});

app.get("/api/agent/rotation", (_req, res) => {
  const world = currentWorld();
  res.json({
    repository: repositoryLink(),
    ...currentRotation(world.state.citizens)
  });
});

app.get("/api/agent/quests", (_req, res) => {
  res.json({
    repository: repositoryLink(),
    quests: readQuests()
  });
});

app.get("/api/steward/health", async (_req, res) => {
  try {
    const world = currentWorld();
    const quests = readQuests();
    const rotation = currentRotation(world.state.citizens);
    const health = stewardHealthSnapshot(world, rotation, quests);
    const github = await githubHealth(repositoryLink());
    res.json({
      ...health,
      github
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "steward health failed" });
  }
});

app.get("/api/repository/link", (_req, res) => {
  res.json(repositoryLink());
});

app.post("/api/chain/sync", requireServiceAuth, async (_req, res) => {
  try {
    const result = await syncChainEvents();
    broadcast("archive", { type: "ChainSynced", result });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "chain sync failed" });
  }
});

app.post("/api/github/webhook", rawJson, (req, res) => {
  const signature = req.header("x-hub-signature-256");
  if (!verifyGithubSignature(process.env.GITHUB_WEBHOOK_SECRET, req.body, signature)) {
    res.status(401).json({ error: "invalid signature" });
    return;
  }
  const payload = JSON.parse(req.body.toString("utf8"));
  const eventName = req.header("x-github-event");
  if (eventName === "pull_request" && payload.action === "closed" && payload.pull_request?.merged) {
    const body = `${payload.pull_request.title}\n${payload.pull_request.body || ""}`;
    const match = body.match(/P-(\d+)|proposalId:\s*(\d+)/i);
    const proposalId = match ? Number(match[1] || match[2]) : 0;
    if (proposalId) {
      addEvent({
        id: `github-pr-${payload.pull_request.id}`,
        source: "github",
        type: "PullRequestMerged",
        payload: {
          proposalId,
          prNumber: payload.pull_request.number,
          mergeCommit: payload.pull_request.merge_commit_sha,
          url: payload.pull_request.html_url
        }
      });
      broadcast("dev-center", { type: "PullRequestMerged", proposalId });
    }
  }
  res.json({ ok: true });
});

app.post("/api/world/reduce", requireServiceAuth, (_req, res) => {
  const world = currentWorld();
  broadcast("archive", { type: "WorldReduced", stateRoot: world.manifest.stateRoot });
  res.json(world.manifest);
});

app.post("/api/proposals/:id/create-issue", requireServiceAuth, async (req, res) => {
  const proposal = currentWorld().state.proposals[String(req.params.id)];
  if (!proposal) {
    res.status(404).json({ error: "proposal not found" });
    return;
  }
  const issue = await createIssueForProposal(proposal);
  res.json(issue);
});

app.post("/api/proposals/create-passed-issues", requireServiceAuth, async (_req, res) => {
  try {
    const proposals = Object.values(currentWorld().state.proposals).filter((proposal) =>
      ["Passed", "Executed"].includes(proposal.status)
    );
    const results = [];
    for (const proposal of proposals) {
      results.push(await createIssueForProposal(proposal));
    }
    const created = results.filter((result) => result.issueNumber && !result.existing).length;
    const linkedExisting = results.filter((result) => result.issueNumber && result.existing).length;
    res.json({
      ok: true,
      scanned: proposals.length,
      created,
      linkedExisting,
      results
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "proposal issue sync failed" });
  }
});

app.post("/api/world/publish", requireServiceAuth, (_req, res) => {
  res.status(202).json({
    ok: true,
    note: "Wire this endpoint to WorldStateRegistry.submitWorldVersion with a funded publisher wallet.",
    manifest: currentWorld().manifest
  });
});

const server = app.listen(port, () => {
  console.log(`Niuma reference node listening on http://localhost:${port}`);
  syncChainEvents()
    .then((result) => console.log("Initial chain sync", result))
    .catch((error) => console.warn("Initial chain sync failed", error));
});

setInterval(() => {
  syncChainEvents().catch((error) => console.warn("Periodic chain sync failed", error));
}, Number(process.env.CHAIN_SYNC_INTERVAL_MS || 30000));

const wss = new WebSocketServer({ server });
function broadcast(channel: string, payload: unknown) {
  const message = JSON.stringify({ channel, payload });
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) client.send(message);
  }
}

function requireServiceAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const expected = process.env.SERVICE_AUTH_TOKEN || "dev-service-token";
  if (req.header("authorization") !== `Bearer ${expected}`) {
    res.status(401).json({ error: "service auth required" });
    return;
  }
  next();
}

async function createIssueForProposal(proposal: {
  proposalId: number;
  title: string;
  type: string;
  contentHash: string;
  issueNumber?: number;
  issueUrl?: string;
}) {
  if (proposal.issueNumber && proposal.issueUrl) {
    return {
      proposalId: proposal.proposalId,
      issueNumber: proposal.issueNumber,
      issueUrl: proposal.issueUrl,
      existing: true,
      linked: true
    };
  }

  const issue = await createProposalIssue({
    proposalId: proposal.proposalId,
    title: proposal.title,
    type: proposal.type,
    contentHash: proposal.contentHash,
    chainId: readDeployment()?.chainId || 1952
  });
  const event: WorldEvent = {
    id: `github-issue-${proposal.proposalId}-${issue.issueNumber}`,
    source: "github",
    type: "IssueLinked",
    payload: {
      proposalId: proposal.proposalId,
      issueNumber: issue.issueNumber,
      issueUrl: issue.issueUrl
    }
  };
  if (!events.some((existing) => existing.id === event.id)) {
    addEvent(event);
    broadcast("dev-center", event);
  }
  return {
    proposalId: proposal.proposalId,
    ...issue,
    linked: true
  };
}

function readDeployment(): { chainId: number; contracts: Record<string, string> } | null {
  const candidates = [
    path.resolve(process.cwd(), "world", "deployments", "1952.json"),
    path.resolve(process.cwd(), "..", "..", "world", "deployments", "1952.json")
  ];
  const filePath = candidates.find((candidate) => fs.existsSync(candidate));
  if (!filePath) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readQuests(): Array<{
  id: string;
  title: string;
  type: string;
  status: string;
  proposalId: number;
  summary: string;
  issueNumber?: number;
  issueUrl?: string;
  acceptance: string[];
}> {
  const candidates = [
    path.resolve(process.cwd(), "world", "quests.json"),
    path.resolve(process.cwd(), "..", "..", "world", "quests.json")
  ];
  const filePath = candidates.find((candidate) => fs.existsSync(candidate));
  if (!filePath) return [];
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function repositoryLink() {
  const targetRepo = process.env.GITHUB_TARGET_REPO || "wyalei14-cell/NIUMA-CITY-ON-X-LAYER";
  const activeRepo = process.env.GITHUB_REPO || "wyalei14-cell/NIUMA-CITY-ON-X-LAYER";
  return {
    targetRepo,
    activeRepo,
    repositoryUrl: "https://github.com/wyalei14-cell/NIUMA-CITY-ON-X-LAYER",
    chainLink: {
      proposalReferencePattern: "P-0001 or proposalId: 1",
      webhookPath: "/api/github/webhook",
      reducerPath: "/api/world/reduce",
      publishPath: "/api/world/publish"
    }
  };
}

function currentRotation(citizens: Record<string, { citizenId: number; wallet: string; metadataURI: string }>) {
  const rotationWindowSeconds = Number(process.env.AGENT_ROTATION_WINDOW_SECONDS || 86400);
  const queue = Object.values(citizens)
    .sort((a, b) => a.citizenId - b.citizenId)
    .map((citizen) => ({
      citizenId: citizen.citizenId,
      wallet: citizen.wallet,
      metadataURI: citizen.metadataURI
    }));
  const currentUnix = Math.floor(Date.now() / 1000);
  const slot = Math.floor(currentUnix / rotationWindowSeconds);
  const currentIndex = queue.length ? slot % queue.length : -1;
  const nextIndex = queue.length ? (slot + 1) % queue.length : -1;
  return {
    rotationWindowSeconds,
    currentUnix,
    currentSlot: slot,
    steward: currentIndex >= 0 ? queue[currentIndex] : null,
    nextSteward: nextIndex >= 0 ? queue[nextIndex] : null,
    queue,
    rule: "steward = citizens[floor(unixTime / rotationWindowSeconds) % citizens.length]"
  };
}

function stewardHealthSnapshot(
  world: ReturnType<typeof currentWorld>,
  rotation: ReturnType<typeof currentRotation>,
  quests: ReturnType<typeof readQuests>
) {
  const activeProposals = Object.values(world.state.proposals).filter((proposal) => proposal.status !== "Executed" && proposal.status !== "Rejected");
  const unlinkedProposals = Object.values(world.state.proposals).filter(
    (proposal) => ["Passed", "Executed"].includes(proposal.status) && !proposal.issueNumber
  );
  const openQuests = quests.filter((quest) => quest.status === "open");
  const reducerBacklog = Object.values(world.state.proposals).filter(
    (proposal) => proposal.status === "Executed" && proposal.linkedPRs.length > 0
  ).length;
  const chainSync = getChainSyncStatus();
  const blockers = [
    rotation.steward ? null : "No registered citizen steward is available.",
    chainSync?.ok === false ? `Chain sync failed: ${chainSync.reason || chainSync.error || "unknown reason"}` : null,
    openQuests.length === 0 ? "No open quests are available for agents." : null
  ].filter(Boolean);

  return {
    status: blockers.length ? "needs_attention" : "healthy",
    steward: rotation.steward,
    nextSteward: rotation.nextSteward,
    chainSync,
    counts: {
      events: events.length,
      citizens: Object.keys(world.state.citizens).length,
      onlineCitizens: onlineCitizenSnapshot().count,
      activeProposals: activeProposals.length,
      openQuests: openQuests.length,
      unlinkedProposals: unlinkedProposals.length,
      reducerBacklog
    },
    unlinkedProposals: unlinkedProposals.map((proposal) => ({
      proposalId: proposal.proposalId,
      title: proposal.title,
      status: proposal.status
    })),
    openQuests: openQuests.map((quest) => ({
      id: quest.id,
      issueNumber: quest.issueNumber,
      issueUrl: quest.issueUrl,
      title: quest.title,
      type: quest.type
    })),
    blockers
  };
}

type OnlineCitizen = {
  wallet: string;
  citizenId: number;
  metadataURI: string;
  label: string;
  role: string;
  registered: boolean;
  lastSeenAt: number;
  expiresAt: number;
};

function onlineCitizenSnapshot() {
  const now = Math.floor(Date.now() / 1000);
  for (const [wallet, citizen] of onlineCitizens.entries()) {
    if (citizen.expiresAt <= now) onlineCitizens.delete(wallet);
  }
  const citizens = [...onlineCitizens.values()].sort((a, b) => b.lastSeenAt - a.lastSeenAt);
  return {
    count: citizens.length,
    ttlSeconds: onlineCitizenTtlSeconds,
    citizens
  };
}

function citizenProfile(wallet: string) {
  const normalizedWallet = wallet.toLowerCase();
  const world = currentWorld();
  const citizen = world.state.citizens[normalizedWallet];
  if (!citizen) return null;

  const proposals = Object.values(world.state.proposals);
  const companies = Object.values(world.state.companies);
  const credentials = Object.values(world.state.academy.credentials);
  const online = onlineCitizenSnapshot().citizens.find((entry) => entry.wallet.toLowerCase() === normalizedWallet) || null;
  const votes = world.state.archive
    .filter(isVoteCastEvent)
    .filter((event) => event.payload.voter.toLowerCase() === normalizedWallet)
    .map((event) => ({
      proposalId: event.payload.proposalId,
      citizenId: event.payload.citizenId,
      support: event.payload.support,
      blockNumber: event.blockNumber
    }));

  const createdProposals = proposals
    .filter((proposal) => proposal.proposer.toLowerCase() === normalizedWallet)
    .map((proposal) => ({
      proposalId: proposal.proposalId,
      title: proposal.title,
      status: proposal.status,
      issueNumber: proposal.issueNumber,
      issueUrl: proposal.issueUrl,
      linkedPRs: proposal.linkedPRs
    }));

  const companyMemberships = companies
    .filter((company) => company.members.some((member) => member.toLowerCase() === normalizedWallet))
    .map((company) => ({
      companyId: company.companyId,
      name: company.name,
      owner: company.owner,
      role: company.owner.toLowerCase() === normalizedWallet ? "owner" : "member",
      memberCount: company.members.length
    }));

  const issuedCredentials = credentials
    .filter((credential) => credential.citizen.toLowerCase() === normalizedWallet)
    .map((credential) => ({
      credentialId: credential.credentialId,
      courseId: credential.courseId,
      evidenceHash: credential.evidenceHash,
      issuedAt: credential.issuedAt
    }));

  return {
    citizen,
    online,
    reputation: world.state.reputation[normalizedWallet] || {
      citizen: citizen.wallet,
      totalPoints: 0,
      governancePoints: 0,
      academyPoints: 0,
      companyPoints: 0
    },
    companyMemberships,
    credentials: issuedCredentials,
    proposals: createdProposals,
    votes,
    proofLinks: {
      githubIssues: createdProposals.filter((proposal) => proposal.issueUrl).map((proposal) => proposal.issueUrl),
      githubPullRequests: createdProposals.flatMap((proposal) => proposal.linkedPRs.map((pullRequest) => pullRequest.url)),
      credentials: issuedCredentials.map((credential) => credential.evidenceHash)
    }
  };
}

function isVoteCastEvent(event: WorldEvent): event is Extract<WorldEvent, { type: "VoteCast" }> {
  return event.type === "VoteCast";
}

async function githubHealth(repository: ReturnType<typeof repositoryLink>) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    return {
      status: "token_missing",
      openPullRequests: null,
      stalePullRequests: null
    };
  }
  const [owner, repo] = repository.activeRepo.split("/");
  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls?state=open&per_page=50`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": "NIUMA-CITY-reference-node"
    }
  });
  if (!response.ok) {
    return {
      status: "github_unavailable",
      error: `${response.status} ${response.statusText}`,
      openPullRequests: null,
      stalePullRequests: null
    };
  }
  const pulls = (await response.json()) as Array<{ number: number; title: string; html_url: string; updated_at: string }>;
  const staleMs = Number(process.env.STEWARD_STALE_PR_HOURS || 24) * 60 * 60 * 1000;
  const now = Date.now();
  const stalePullRequests = pulls
    .filter((pull) => now - new Date(pull.updated_at).getTime() > staleMs)
    .map((pull) => ({
      number: pull.number,
      title: pull.title,
      url: pull.html_url,
      updatedAt: pull.updated_at
    }));
  return {
    status: "ok",
    openPullRequests: pulls.length,
    stalePullRequests
  };
}

function proposalPhase(eventType: string): string {
  const phaseMap: Record<string, string> = {
    ProposalCreated: "creation",
    ProposalDiscussionStarted: "discussion",
    ProposalVotingStarted: "voting",
    VoteCast: "voting",
    ProposalFinalized: "finalization",
    ProposalExecuted: "execution",
    IssueLinked: "implementation",
    PullRequestMerged: "implementation",
    ExecutionQueued: "execution",
    ExecutionCompleted: "execution",
    ExecutionCanceled: "execution"
  };
  return phaseMap[eventType] || "unknown";
}

type ChecklistItem = {
  id: string;
  label: string;
  completed: boolean;
  detail?: string;
  link?: string;
};

function buildExecutionChecklist(
  proposal: { proposalId: number; status: string; issueNumber?: number; issueUrl?: string; linkedPRs: Array<{ prNumber: number; mergeCommit: string; url: string }>; executionQueue: Array<{ executionId: number; target: string; value: string; data: string; metadataURI: string; earliestExecuteAt: number; status: string; result?: string }> },
  archive: WorldEvent[]
): ChecklistItem[] {
  const pid = String(proposal.proposalId);
  const items: ChecklistItem[] = [];

  const hasDiscussion = archive.some((e) => e.type === "ProposalDiscussionStarted" && String(e.payload.proposalId) === pid);
  const hasVoting = archive.some((e) => e.type === "ProposalVotingStarted" && String(e.payload.proposalId) === pid);
  const hasFinalized = archive.some((e) => e.type === "ProposalFinalized" && String(e.payload.proposalId) === pid);
  const hasExecuted = archive.some((e) => e.type === "ProposalExecuted" && String(e.payload.proposalId) === pid);
  const voteCount = archive.filter((e) => e.type === "VoteCast" && String(e.payload.proposalId) === pid).length;

  items.push({ id: "create", label: "Proposal created on-chain", completed: true, detail: `by ${proposal.issueNumber ? "proposer" : "unknown"}` });
  items.push({ id: "discuss", label: "Discussion phase started", completed: hasDiscussion });
  items.push({ id: "vote-start", label: "Voting started", completed: hasVoting });
  items.push({ id: "vote-count", label: `Votes cast (${voteCount} votes recorded)`, completed: voteCount > 0 });
  items.push({ id: "finalize", label: "Proposal finalized", completed: hasFinalized, detail: proposal.status === "Rejected" ? "Rejected by voters" : undefined });
  items.push({ id: "issue", label: "GitHub issue linked", completed: !!proposal.issueNumber, link: proposal.issueUrl });
  items.push({ id: "pr", label: `Pull requests merged (${proposal.linkedPRs.length})`, completed: proposal.linkedPRs.length > 0, link: proposal.linkedPRs[0]?.url });

  for (const execution of proposal.executionQueue) {
    items.push({
      id: `exec-${execution.executionId}`,
      label: `Execution EX-${String(execution.executionId).padStart(4, "0")}`,
      completed: execution.status === "Completed",
      detail: execution.status === "Queued" ? `Queued, executable after ${new Date(execution.earliestExecuteAt * 1000).toISOString()}` : execution.status,
      link: execution.metadataURI
    });
  }

  items.push({ id: "executed", label: "Marked executed on-chain", completed: hasExecuted });

  return items;
}

function loadEnvironment() {
  const candidates = [
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), "..", "..", ".env")
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      dotenv.config({ path: candidate, override: false });
    }
  }
}
