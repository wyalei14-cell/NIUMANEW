import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserProvider, Contract, Eip1193Provider } from "ethers";
import {
  Building2,
  CheckCircle2,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Clock,
  FileArchive,
  GitPullRequest,
  GraduationCap,
  Landmark,
  Network,
  Radio,
  ScrollText,
  ShieldCheck,
  UserRoundPlus,
  Vote,
  Wallet,
  X
} from "lucide-react";
import {
  XLAYER_MAINNET,
  XLAYER_TESTNET,
  citizenRegistryAbi,
  companyRegistryAbi,
  courseRegistryAbi,
  credentialRegistryAbi,
  electionManagerAbi,
  governanceCoreAbi,
  serviceMarketplaceAbi,
  switchToXLayer,
  worldStateRegistryAbi
} from "@niuma/sdk";
import "./styles.css";

type View = "plaza" | "join" | "city-hall" | "dev-center" | "company" | "academy" | "marketplace" | "archive";
type Proposal = {
  proposalId: number;
  title: string;
  type: string;
  proposer: string;
  contentHash: string;
  status: string;
  yesVotes: number;
  noVotes: number;
  issueNumber?: number;
  issueUrl?: string;
  linkedPRs: Array<{ prNumber: number; mergeCommit: string; url: string }>;
  executionQueue?: GovernanceExecution[];
};
type GovernanceExecution = {
  executionId: number;
  proposalId: number;
  target: string;
  value: string;
  data: string;
  metadataURI: string;
  earliestExecuteAt: number;
  status: "Queued" | "Completed" | "Canceled";
  result?: string;
};
type Company = { companyId: number; name: string; owner: string; metadataURI: string; members: string[] };
type Manifest = {
  version: number;
  stateRoot: string;
  generatedAt: number;
  completedProposals: Proposal[];
  activeProposals: Proposal[];
  githubSync: { repo: string; commit: string };
};
type Bootstrap = {
  github: { repo: string; targetRepo: string; url: string };
  rotation: {
    rotationWindowSeconds?: number;
    steward: { citizenId: number; wallet: string; metadataURI: string } | null;
    nextSteward: { citizenId: number; wallet: string; metadataURI: string } | null;
  };
  quests: Array<{ id: string; title: string; type: string; status: string; proposalId: number; summary: string; issueUrl?: string }>;
  nextActions: string[];
  health?: { status: string; counts: { openQuests: number; onlineCitizens?: number; reducerBacklog: number; unlinkedProposals: number }; blockers: string[] };
  presence?: OnlinePresence;
};
type Citizen = { citizenId: number; wallet: string; metadataURI: string };
type OnlineCitizen = { wallet: string; citizenId: number; label: string; role: string; registered: boolean; lastSeenAt: number; expiresAt: number };
type OnlinePresence = { count: number; ttlSeconds: number; citizens: OnlineCitizen[] };
type CitizenProfile = {
  citizen: Citizen;
  online: OnlineCitizen | null;
  reputation: { totalPoints: number; governancePoints: number; academyPoints: number; companyPoints: number };
  companyMemberships: Array<{ companyId: number; name: string; owner: string; role: string; memberCount: number }>;
  credentials: Array<{ credentialId: number; courseId: number; evidenceHash: string; issuedAt: number }>;
  proposals: Array<{ proposalId: number; title: string; status: string; issueNumber?: number; issueUrl?: string; linkedPRs: Array<{ prNumber: number; mergeCommit: string; url: string }> }>;
  votes: Array<{ proposalId: number; citizenId: number; support: boolean; blockNumber: number }>;
  proofLinks: { githubIssues: string[]; githubPullRequests: string[]; credentials: string[] };
};
type ProposalTimelineEntry = {
  id: string;
  type: string;
  source: string;
  blockNumber: number | null;
  timestamp: number | null;
  payload: Record<string, unknown>;
  phase: string;
};
type MarketplaceService = {
  serviceId: number;
  provider: string;
  providerCitizenId: number;
  title: string;
  description: string;
  category: string;
  price: string;
  status: string;
  client: string;
  createdAt: number;
  reviewCount: number;
};
type MarketplaceStats = { posted: number; completed: number; volume: string; feeBps: number };

type ProposalChecklistItem = {
  id: string;
  label: string;
  completed: boolean;
  detail?: string;
  link?: string;
};

const apiBase = import.meta.env.VITE_API_BASE || "http://localhost:8787";

const addresses = {
  citizen: import.meta.env.VITE_CITIZEN_REGISTRY || "",
  governance: import.meta.env.VITE_GOVERNANCE_CORE || "",
  company: import.meta.env.VITE_COMPANY_REGISTRY || "",
  world: import.meta.env.VITE_WORLD_STATE_REGISTRY || "",
  election: import.meta.env.VITE_ELECTION_MANAGER || "",
  course: import.meta.env.VITE_COURSE_REGISTRY || "",
  credential: import.meta.env.VITE_CREDENTIAL_REGISTRY || "",
  marketplace: import.meta.env.VITE_SERVICE_MARKETPLACE || ""
};

function App() {
  const [view, setView] = useState<View>("plaza");
  const [wallet, setWallet] = useState("");
  const [chainId, setChainId] = useState<number | null>(null);
  const [citizenId, setCitizenId] = useState<string>("0");
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [citizens, setCitizens] = useState<Citizen[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [mayor, setMayor] = useState<{ wallet: string; startAt: number; endAt: number } | null>(null);
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [academyCourses, setAcademyCourses] = useState<Array<{courseId:number;proposer:string;title:string;contentHash:string;difficulty:number;status:string;completionCount:number}>>([]);
  const [academyCredentials, setAcademyCredentials] = useState<Array<{credentialId:number;citizen:string;courseId:number;evidenceHash:string;issuedAt:number}>>([]);
  const [presence, setPresence] = useState<OnlinePresence>({ count: 0, ttlSeconds: 120, citizens: [] });
  const [citizenProfile, setCitizenProfile] = useState<CitizenProfile | null>(null);
  const [selectedProposalId, setSelectedProposalId] = useState<number | null>(null);
  const [proposalTimeline, setProposalTimeline] = useState<ProposalTimelineEntry[]>([]);
  const [selectedProposalChecklist, setProposalChecklist] = useState<ProposalChecklistItem[]>([]);
  const [marketplace, setMarketplace] = useState<{ services: MarketplaceService[]; stats: MarketplaceStats }>({ services: [], stats: { posted: 0, completed: 0, volume: "0", feeBps: 0 } });
  const [notice, setNotice] = useState("Live node synced from X Layer Testnet events.");
  const contractsReady = Object.values(addresses).some(Boolean);

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 15000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!wallet) return;
    reportPresence(wallet, citizenId);
    fetchCitizenProfile(wallet);
    const timer = window.setInterval(() => reportPresence(wallet, citizenId), 45000);
    return () => window.clearInterval(timer);
  }, [wallet, citizenId]);

  const selectedProposal = proposals[0];
  const nav = [
    ["plaza", "Plaza", Radio],
    ["join", "Join", ClipboardList],
    ["city-hall", "City Hall", Landmark],
    ["dev-center", "Dev Center", GitPullRequest],
    ["company", "Company District", Building2],
    ["academy", "Academy", GraduationCap],
    ["marketplace", "Marketplace", Building2],
    ["archive", "Archive", FileArchive]
  ] as const;

  async function refresh() {
    const [proposalRes, citizenRes, companyRes, worldRes, mayorRes, bootstrapRes, academyRes, presenceRes] = await Promise.all([
      fetch(`${apiBase}/api/proposals`).then((r) => r.json()).catch(() => []),
      fetch(`${apiBase}/api/citizens`).then((r) => r.json()).catch(() => []),
      fetch(`${apiBase}/api/companies`).then((r) => r.json()).catch(() => []),
      fetch(`${apiBase}/api/world/latest`).then((r) => r.json()).catch(() => null),
      fetch(`${apiBase}/api/election/current`).then((r) => r.json()).catch(() => null),
      fetch(`${apiBase}/api/agent/bootstrap`).then((r) => r.json()).catch(() => null),
      fetch(`${apiBase}/api/academy`).then((r) => r.json()).catch(() => ({ courses: [], credentials: [] })),
      fetch(`${apiBase}/api/presence/online`).then((r) => r.json()).catch(() => ({ count: 0, ttlSeconds: 120, citizens: [] }))
    ]);
    setProposals(proposalRes);
    setCitizens(citizenRes);
    setCompanies(companyRes);
    setManifest(worldRes);
    setMayor(mayorRes);
    setBootstrap(bootstrapRes);
    setAcademyCourses(academyRes.courses || []);
    setAcademyCredentials(academyRes.credentials || []);
      setPresence(presenceRes);
    const marketplaceRes = await fetch(`${apiBase}/api/marketplace`).then((r) => r.json()).catch(() => ({ services: [], stats: { posted: 0, completed: 0, volume: "0", feeBps: 0 } }));
    setMarketplace(marketplaceRes);
    if (wallet) await fetchCitizenProfile(wallet);
  }

  async function fetchCitizenProfile(account: string) {
    const profile = await fetch(`${apiBase}/api/citizens/${account}/profile`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    setCitizenProfile(profile);
  }

  async function fetchProposalDetail(proposalId: number) {
    setSelectedProposalId(proposalId);
    const [timelineRes, checklistRes] = await Promise.all([
      fetch(`${apiBase}/api/proposals/${proposalId}/timeline`).then((r) => (r.ok ? r.json() : { timeline: [] })).catch(() => ({ timeline: [] })),
      fetch(`${apiBase}/api/proposals/${proposalId}/checklist`).then((r) => (r.ok ? r.json() : { checklist: [] })).catch(() => ({ checklist: [] }))
    ]);
    setProposalTimeline(timelineRes.timeline || []);
    setProposalChecklist(checklistRes.checklist || []);
  }

  async function reportPresence(account = wallet, currentCitizenId = citizenId) {
    if (!account) return;
    await fetch(`${apiBase}/api/presence/heartbeat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        wallet: account,
        citizenId: Number(currentCitizenId || 0),
        role: "citizen",
        label: currentCitizenId !== "0" ? `Citizen #${currentCitizenId}` : "Connected wallet"
      })
    }).catch(() => null);
    const nextPresence = await fetch(`${apiBase}/api/presence/online`).then((r) => r.json()).catch(() => null);
    if (nextPresence) setPresence(nextPresence);
  }

  async function connectWallet() {
    const ethereum = (window as unknown as { ethereum?: Eip1193Provider }).ethereum;
    if (!ethereum) {
      setNotice("No EVM wallet detected.");
      return;
    }
    const provider = new BrowserProvider(ethereum);
    const signer = await provider.getSigner();
    const network = await provider.getNetwork();
    const account = await signer.getAddress();
    setWallet(account);
    setChainId(Number(network.chainId));
    let nextCitizenId = "0";
    if (addresses.citizen) {
      const registry = new Contract(addresses.citizen, citizenRegistryAbi, signer);
      nextCitizenId = String(await registry.citizenOf(account));
      setCitizenId(nextCitizenId);
    }
    await reportPresence(account, nextCitizenId);
    setNotice("Wallet connected.");
  }

  async function runTx(kind: "register" | "proposal" | "vote" | "company" | "nominate" | "world" | "course" | "post-service", extraData?: string) {
    if (!wallet) await connectWallet();
    const provider = new BrowserProvider((window as unknown as { ethereum: Eip1193Provider }).ethereum);
    const signer = await provider.getSigner();
    try {
      if (kind === "register") {
        assertAddress(addresses.citizen, "CitizenRegistry");
        const contract = new Contract(addresses.citizen, citizenRegistryAbi, signer);
        const tx = await contract.registerCitizen(await signer.getAddress(), `ipfs://profile/${await signer.getAddress()}`);
        setNotice(`Citizen registration sent: ${tx.hash}`);
      }
      if (kind === "proposal") {
        assertAddress(addresses.governance, "GovernanceCore");
        const contract = new Contract(addresses.governance, governanceCoreAbi, signer);
        const tx = await contract.createProposal(0, "Open Academy District", `sha256:${Date.now()}`);
        setNotice(`Proposal transaction sent: ${tx.hash}`);
      }
      if (kind === "vote") {
        assertAddress(addresses.governance, "GovernanceCore");
        const contract = new Contract(addresses.governance, governanceCoreAbi, signer);
        const tx = await contract.vote(selectedProposal?.proposalId || 1, true);
        setNotice(`Vote transaction sent: ${tx.hash}`);
      }
      if (kind === "company") {
        assertAddress(addresses.company, "CompanyRegistry");
        const contract = new Contract(addresses.company, companyRegistryAbi, signer);
        const tx = await contract.createCompany("Builder Guild", "ipfs://builder-guild");
        setNotice(`Company creation sent: ${tx.hash}`);
      }
      if (kind === "nominate") {
        assertAddress(addresses.election, "ElectionManager");
        const contract = new Contract(addresses.election, electionManagerAbi, signer);
        const tx = await contract.nominate(1, `ipfs://campaign/${await signer.getAddress()}`);
        setNotice(`Campaign nomination sent: ${tx.hash}`);
      }
      if (kind === "world") {
        assertAddress(addresses.world, "WorldStateRegistry");
        const contract = new Contract(addresses.world, worldStateRegistryAbi, signer);
        const latest = await contract.latestWorldVersion();
        const tx = await contract.submitWorldVersion(Number(latest) + 1, manifest?.stateRoot || "sha256:pending", "local://manifest");
        setNotice(`World version publish sent: ${tx.hash}`);
      }
      if (kind === "course") {
        assertAddress(addresses.course, "CourseRegistry");
        const contract = new Contract(addresses.course, courseRegistryAbi, signer);
        const tx = await contract.proposeCourse("New Course", `ipfs://course/${Date.now()}`, 0);
        setNotice(`Course proposal sent: ${tx.hash}`);
      }
      if (kind === "post-service") {
        assertAddress(addresses.marketplace, "ServiceMarketplace");
        const contract = new Contract(addresses.marketplace, serviceMarketplaceAbi, signer);
        const tx = await contract.postService(extraData || "New Service", "Service description", "general", 0, 86400);
        setNotice(`Service posted: ${tx.hash}`);
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Transaction failed.");
    }
  }

  const timeLeft = useMemo(() => {
    if (!mayor) return "No active term";
    const seconds = Math.max(0, mayor.endAt - Math.floor(Date.now() / 1000));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
  }, [mayor]);

  return (
    <main className="shell">
      <aside className="rail">
        <div className="brand">
          <span>N</span>
          <div>
            <strong>NIUMA CITY</strong>
            <small>X Layer Alpha</small>
          </div>
        </div>
        <nav>
          {nav.map(([id, label, Icon]) => (
            <button className={view === id ? "active" : ""} key={id} onClick={() => setView(id)}>
              <Icon size={18} />
              {label}
            </button>
          ))}
        </nav>
        <div className="rail-footer">
          <button className="icon-action" title="Switch to X Layer Testnet" onClick={() => switchToXLayer(XLAYER_TESTNET)}>
            <Network size={18} />
          </button>
          <button className="icon-action" title="Switch to X Layer Mainnet" onClick={() => switchToXLayer(XLAYER_MAINNET)}>
            <ShieldCheck size={18} />
          </button>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">{view === "plaza" ? "X Layer decentralized world" : "NIUMA CITY operations"}</p>
            <h1>{view === "plaza" ? "NIUMA CITY" : viewTitle(view)}</h1>
          </div>
          <button className="primary" onClick={connectWallet}>
            <Wallet size={18} />
            {wallet ? short(wallet) : "Connect"}
          </button>
        </header>

        <div className="notice">
          <Radio size={16} />
          <span>{notice}</span>
          <button title="Dismiss" onClick={() => setNotice("")}>
            <X size={16} />
          </button>
        </div>

        {view === "plaza" && (
          <div className="plaza-grid">
            <section className="city-plane">
              <div className="skyline">
                <span />
                <span />
                <span />
                <span />
                <span />
              </div>
              <div className="city-copy">
                <p>Live world root</p>
                <strong>{manifest?.stateRoot ? shortHash(manifest.stateRoot) : "Waiting for node"}</strong>
                <span>Public events reduce into one verifiable city state.</span>
              </div>
            </section>
            <section className="stream">
              <h2>Proposal stream</h2>
              {proposals.map((proposal) => (
                <ProposalRow key={proposal.proposalId} proposal={proposal} />
              ))}
            </section>
          </div>
        )}

        {view === "join" && (
          <section className="join-grid">
            <div className="join-panel human">
              <h2><Wallet size={20} style={{verticalAlign:'middle',marginRight:8}} />Humans</h2>
              <p>Set direction, vote, invite agents, and review high-impact city changes.</p>
              <ol>
                <li>Connect wallet on X Layer Testnet.</li>
                <li>Register as a citizen — <button className="inline" onClick={() => runTx("register")}>Register now</button></li>
                <li>Create or vote on proposals — <button className="inline" onClick={() => runTx("proposal")}>Propose</button> <button className="inline" onClick={() => runTx("vote")}>Vote</button></li>
                <li>Form or join a company — <button className="inline" onClick={() => runTx("company")}>Create company</button></li>
                <li>Nominate for mayor — <button className="inline" onClick={() => runTx("nominate")}>Nominate</button></li>
                <li>Publish world version — <button className="inline" onClick={() => runTx("world")}>Publish</button></li>
              </ol>
              <div className="join-status">
                {wallet ? <span className="badge ok">Connected: {short(wallet)}</span> : <span className="badge warn">No wallet connected</span>}
                {citizenId !== "0" ? <span className="badge ok">Citizen #{citizenId}</span> : <span className="badge warn">Not registered</span>}
              </div>
            </div>
            <div className="join-panel agent">
              <h2><Radio size={20} style={{verticalAlign:'middle',marginRight:8}} />Agents</h2>
              <p>Bootstrap, register, check rotation, claim one quest, and open a proposal-linked PR.</p>
              <ol>
                <li><code>npm --workspace apps/agent run bootstrap</code></li>
                <li><code>npm --workspace apps/agent run register</code></li>
                <li>Check steward: <code>GET /api/agent/rotation</code></li>
                <li>Pick one open quest and build a small PR.</li>
              </ol>
              <div className="join-agent-info">
                <div><strong>Current steward:</strong> {bootstrap?.rotation.steward ? short(bootstrap.rotation.steward.wallet) : "None"}</div>
                <div><strong>Next steward:</strong> {bootstrap?.rotation.nextSteward ? short(bootstrap.rotation.nextSteward.wallet) : "None"}</div>
                <div><strong>Rotation window:</strong> {bootstrap?.rotation.rotationWindowSeconds ? `${bootstrap.rotation.rotationWindowSeconds / 3600}h` : "24h"}</div>
              </div>
              <a className="repo-link" href={bootstrap?.github.url || "https://github.com/wyalei14-cell/NIUMA-CITY-ON-X-LAYER"} target="_blank" rel="noreferrer">
                Open repository →
              </a>
            </div>
            <div className="join-panel steward">
              <h2>Current steward</h2>
              <strong>{bootstrap?.rotation.steward ? short(bootstrap.rotation.steward.wallet) : "No steward yet"}</strong>
              <p>Stewards triage issues, check PR proposal links, and coordinate reducer/publish work.</p>
              <span>Next: {bootstrap?.rotation.nextSteward ? short(bootstrap.rotation.nextSteward.wallet) : "none"}</span>
            </div>
            <div className="quest-list">
              <h2>Open quests</h2>
              {bootstrap?.quests.map((quest) => (
                <article className="quest-row" key={quest.id}>
                  <span className="quest-id">{quest.id}</span>
                  <strong>{quest.issueUrl ? <a href={quest.issueUrl} target="_blank" rel="noreferrer">{quest.title}</a> : quest.title}</strong>
                  <small className="quest-type">{quest.type} · proposalId {quest.proposalId}</small>
                  <p>{quest.summary}</p>
                </article>
              ))}
            </div>
          </section>
        )}

        {view === "city-hall" && (
          <section className="operations">
            <ActionPanel
              icon={<UserRoundPlus />}
              title="Citizen"
              meta={citizenId !== "0" ? `Citizen #${citizenId}` : "Not registered"}
              actions={[
                ["Register", () => runTx("register")],
                ["Nominate", () => runTx("nominate")]
              ]}
            />
            <ActionPanel
              icon={<ScrollText />}
              title="Governance"
              meta={`${proposals.length} indexed proposals`}
              actions={[
                ["Propose", () => runTx("proposal")],
                ["Vote yes", () => runTx("vote")]
              ]}
            />
            <ActionPanel icon={<Vote />} title="Mayor" meta={mayor ? `${short(mayor.wallet)} · ${timeLeft}` : "No active mayor"} actions={[["Refresh", refresh]]} />
            <CitizenProfileCard profile={citizenProfile} wallet={wallet} />
          </section>
        )}

        {view === "dev-center" && (
          <section className="dev-map">
            {proposals.map((proposal) => (
              <article className={`proposal-lane ${selectedProposalId === proposal.proposalId ? "expanded" : ""}`} key={proposal.proposalId}>
                <div className="lane" onClick={() => setSelectedProposalId(selectedProposalId === proposal.proposalId ? null : proposal.proposalId)}>
                  {selectedProposalId === proposal.proposalId ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  <span>P-{String(proposal.proposalId).padStart(4, "0")}</span>
                  <strong>{proposal.title}</strong>
                  <span className={`proposal-badge ${proposal.status.toLowerCase()}`}>{proposal.status}</span>
                  <ChevronRight />
                  <span>{proposal.issueNumber ? <a href={proposal.issueUrl} target="_blank" rel="noreferrer">Issue #{proposal.issueNumber}</a> : "No issue yet"}</span>
                  <ChevronRight />
                  <span>{proposal.linkedPRs.length ? `${proposal.linkedPRs.length} merged PR` : "Awaiting PR"}</span>
                  <b>{proposal.yesVotes}y</b>
                  <b>{proposal.noVotes}n</b>
                </div>
                {selectedProposalId === proposal.proposalId && (
                  <div className="proposal-detail">
                    <button className="timeline-load" onClick={() => fetchProposalDetail(proposal.proposalId)}>Load timeline & checklist</button>
                    {proposalTimeline.length > 0 && (
                      <div className="proposal-panels">
                        <div className="panel-timeline">
                          <h3><Clock size={16} /> Timeline ({proposalTimeline.length} events)</h3>
                          <ProposalTimeline entries={proposalTimeline} />
                        </div>
                        <div className="panel-checklist">
                          <h3><CheckSquare size={16} /> Checklist ({proposalChecklist.filter((c) => c.completed).length}/{proposalChecklist.length})</h3>
                          <ProposalChecklist items={proposalChecklist} />
                        </div>
                      </div>
                    )}
                    <ExecutionQueue executions={proposal.executionQueue || []} />
                  </div>
                )}
              </article>
            ))}
          </section>
        )}

        {view === "company" && (
          <section className="operations">
            <ActionPanel icon={<Building2 />} title="Create company" meta="One active company per citizen" actions={[["Create", () => runTx("company")]]} />
            <div className="table">
              {companies.map((company) => (
                <div className="table-row" key={company.companyId}>
                  <strong>{company.name}</strong>
                  <span>{short(company.owner)}</span>
                  <span>{company.members.length} members</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {view === "academy" && (
          <section className="operations">
            <ActionPanel
              icon={<GraduationCap />}
              title="Academy District"
              meta={`${academyCourses.length} courses · ${academyCredentials.length} credentials`}
              actions={[["Propose Course", () => runTx("course")]]}
            />
            <div className="academy-entrypoints">
              <a href={`${apiBase}/api/agent/bootstrap`} target="_blank" rel="noreferrer">Bootstrap</a>
              <a href={`${apiBase}/api/agent/quests`} target="_blank" rel="noreferrer">Quests</a>
              <a href="https://github.com/wyalei14-cell/NIUMA-CITY-ON-X-LAYER/issues" target="_blank" rel="noreferrer">Issues</a>
              <a href="https://github.com/wyalei14-cell/NIUMA-CITY-ON-X-LAYER/blob/main/proposals/P-0003-academy-district.md" target="_blank" rel="noreferrer">Proposal</a>
            </div>
            <div className="academy-section">
              <h3>Courses</h3>
              {academyCourses.length === 0 && <p className="empty">No courses yet. Be the first to propose one!</p>}
              <div className="table">
                {academyCourses.map((course) => (
                  <div className="table-row" key={course.courseId}>
                    <span className="course-id">C-{String(course.courseId).padStart(3,"0")}</span>
                    <strong>{course.title}</strong>
                    <span className={`difficulty d${course.difficulty}`}>{["Beginner","Intermediate","Advanced"][course.difficulty] || `Lvl ${course.difficulty}`}</span>
                    <span className={`course-status ${course.status.toLowerCase()}`}>{course.status}</span>
                    <span>{course.completionCount} completions</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="academy-section">
              <h3>Credentials</h3>
              {academyCredentials.length === 0 && <p className="empty">No credentials issued yet.</p>}
              <div className="table">
                {academyCredentials.map((cred) => (
                  <div className="table-row" key={cred.credentialId}>
                    <span className="cred-id">CR-{String(cred.credentialId).padStart(3,"0")}</span>
                    <span>Citizen {short(cred.citizen)}</span>
                    <span>Course C-{String(cred.courseId).padStart(3,"0")}</span>
                    <span className="evidence">{shortHash(cred.evidenceHash)}</span>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {view === "marketplace" && (
          <section className="operations">
            <ActionPanel
              icon={<Building2 />}
              title="Service Marketplace"
              meta={`${marketplace.stats.posted} services · ${marketplace.stats.completed} completed · ${marketplace.stats.feeBps / 100}% fee`}
              actions={[["Post Service", () => { const t = prompt("Service title:"); if (!t || !wallet) return; runTx("post-service", t); }]]}
            />
            <div className="academy-section">
              <h3>Open services</h3>
              {marketplace.services.filter(s => s.status === "Open").length === 0 && <p className="empty">No open services.</p>}
              <div className="table">
                {marketplace.services.filter(s => s.status === "Open").map((service) => (
                  <div className="table-row" key={service.serviceId}>
                    <span className="course-id">S-{String(service.serviceId).padStart(3, "0")}</span>
                    <strong>{service.title}</strong>
                    <span className="difficulty d0">{service.category}</span>
                    <span>{service.price === "0" ? "Free" : `${Number(service.price) / 1e18} OKB`}</span>
                    <small>{short(service.provider)}</small>
                  </div>
                ))}
              </div>
            </div>
            <div className="academy-section">
              <h3>All services</h3>
              <div className="table">
                {marketplace.services.map((service) => (
                  <div className="table-row" key={service.serviceId}>
                    <span className="course-id">S-{String(service.serviceId).padStart(3, "0")}</span>
                    <strong>{service.title}</strong>
                    <span className={`course-status ${service.status.toLowerCase()}`}>{service.status}</span>
                    <span>{service.price === "0" ? "Free" : `${Number(service.price) / 1e18} OKB`}</span>
                    <small>C#{service.providerCitizenId}</small>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {view === "archive" && (
          <section className="archive">
            <div>
              <p>World version</p>
              <strong>#{manifest?.version || 0}</strong>
            </div>
            <div>
              <p>GitHub sync</p>
              <strong>{manifest?.githubSync.repo || "local"}</strong>
            </div>
            <div>
              <p>Completed proposals</p>
              <strong>{manifest?.completedProposals.length || 0}</strong>
            </div>
            <button className="primary" onClick={() => runTx("world")}>
              <CheckCircle2 size={18} />
              Publish version
            </button>
          </section>
        )}
      </section>

      <aside className="inspector">
        <h2>City state</h2>
        <Status label="Network" value={chainId ? String(chainId) : "Not connected"} />
        <Status label="Contracts" value={contractsReady ? "Configured" : "Demo mode"} />
        <Status label="Mayor" value={mayor ? short(mayor.wallet) : "None"} />
        <Status label="Citizens" value={String(citizens.length)} />
        <Status label="Online" value={String(presence.count)} />
        <Status label="Active proposals" value={String(manifest?.activeProposals.length || 0)} />
        <Status label="World version" value={String(manifest?.version || 0)} />
        <Status label="Recent merge" value={manifest?.completedProposals.find((p) => p.linkedPRs.length)?.linkedPRs[0]?.mergeCommit ? "Indexed" : "None"} />
        <Status label="Citizen" value={citizenId !== "0" ? `#${citizenId}` : "Unknown"} />
        <Status label="Health" value={bootstrap?.health?.status || "Unknown"} />
        <div className="online-list">
          <h3>Online citizens</h3>
          {presence.citizens.length === 0 && <p>No heartbeat yet.</p>}
          {presence.citizens.slice(0, 5).map((citizen) => (
            <div className="online-row" key={citizen.wallet}>
              <span />
              <strong>{citizen.citizenId ? `#${citizen.citizenId}` : "wallet"}</strong>
              <small>{short(citizen.wallet)}</small>
            </div>
          ))}
        </div>
      </aside>
    </main>
  );
}

function ProposalRow({ proposal }: { proposal: Proposal }) {
  return (
    <article className="proposal-row">
      <span>{proposal.type}</span>
      <strong>{proposal.title}</strong>
      <small>{proposal.status}</small>
      <div>
        <b>{proposal.yesVotes}</b> yes
        <b>{proposal.noVotes}</b> no
      </div>
    </article>
  );
}

function ExecutionQueue({ executions }: { executions: GovernanceExecution[] }) {
  if (!executions.length) {
    return <div className="execution-empty">No governance execution queued.</div>;
  }
  return (
    <div className="execution-list">
      {executions.map((execution) => (
        <div className="execution-row" key={execution.executionId}>
          <span className={`execution-status ${execution.status.toLowerCase()}`}>{execution.status}</span>
          <strong>EX-{String(execution.executionId).padStart(4, "0")}</strong>
          <span>{short(execution.target)}</span>
          <span>{execution.value === "0" ? "0 OKB" : `${execution.value} wei`}</span>
          <span>{formatUnix(execution.earliestExecuteAt)}</span>
          <small title={execution.metadataURI}>{shortHash(execution.metadataURI)}</small>
        </div>
      ))}
    </div>
  );
}

function CitizenProfileCard({ profile, wallet }: { profile: CitizenProfile | null; wallet: string }) {
  const proofs = [
    ...(profile?.proofLinks.githubIssues || []),
    ...(profile?.proofLinks.githubPullRequests || []),
    ...(profile?.proofLinks.credentials || [])
  ].slice(0, 3);
  return (
    <article className="citizen-card">
      <div className="citizen-card-head">
        <span>{profile?.citizen.citizenId ? `#${profile.citizen.citizenId}` : "ID"}</span>
        <div>
          <h2>Digital citizen card</h2>
          <p>{profile ? short(profile.citizen.wallet) : wallet ? "Profile not indexed yet" : "Connect a wallet"}</p>
        </div>
        <strong className={profile?.online ? "online" : ""}>{profile?.online ? "Online" : "Offline"}</strong>
      </div>
      <div className="profile-stats">
        <ProfileStat label="Reputation" value={String(profile?.reputation.totalPoints ?? 0)} />
        <ProfileStat label="Votes" value={String(profile?.votes.length ?? 0)} />
        <ProfileStat label="Proposals" value={String(profile?.proposals.length ?? 0)} />
        <ProfileStat label="Credentials" value={String(profile?.credentials.length ?? 0)} />
      </div>
      <div className="profile-grid">
        <ProfileList title="Companies" items={(profile?.companyMemberships || []).map((company) => `${company.name} · ${company.role}`)} empty="No company yet" />
        <ProfileList title="Recent votes" items={(profile?.votes || []).slice(-3).map((vote) => `P-${vote.proposalId} · ${vote.support ? "yes" : "no"}`)} empty="No votes yet" />
        <ProfileList title="Proof links" items={proofs.map(shortHash)} empty="No public proof yet" />
      </div>
    </article>
  );
}

function ProfileStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ProfileList({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  return (
    <div className="profile-list">
      <h3>{title}</h3>
      {(items.length ? items : [empty]).map((item, index) => (
        <span key={`${title}-${index}`}>{item}</span>
      ))}
    </div>
  );
}

function ActionPanel({ icon, title, meta, actions }: { icon: React.ReactNode; title: string; meta: string; actions: Array<[string, () => void]> }) {
  return (
    <div className="action-panel">
      <div className="action-icon">{icon}</div>
      <h2>{title}</h2>
      <p>{meta}</p>
      <div>
        {actions.map(([label, onClick]) => (
          <button key={label} onClick={onClick}>
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Status({ label, value }: { label: string; value: string }) {
  return (
    <div className="status">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function viewTitle(view: View) {
  return {
    plaza: "Plaza",
    join: "Join",
    "city-hall": "City Hall",
    "dev-center": "Dev Center",
    company: "Company District",
    academy: "Academy",
    marketplace: "Marketplace",
    archive: "Archive"
  }[view];
}

function short(value: string) {
  return value ? `${value.slice(0, 6)}...${value.slice(-4)}` : "";
}

function shortHash(value: string) {
  if (!value) return "";
  if (value.length <= 24) return value;
  return `${value.slice(0, 13)}...${value.slice(-10)}`;
}

function formatUnix(value: number) {
  if (!value) return "No time";
  return new Date(value * 1000).toLocaleString([], { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function assertAddress(address: string, name: string) {
  if (!address) throw new Error(`${name} address is not configured. Deploy contracts and set VITE_* env variables.`);
}

function ProposalTimeline({ entries }: { entries: ProposalTimelineEntry[] }) {
  const phaseLabels: Record<string, string> = {
    creation: "Creation",
    discussion: "Discussion",
    voting: "Voting",
    finalization: "Finalization",
    execution: "Execution",
    implementation: "Implementation"
  };
  const typeIcons: Record<string, string> = {
    ProposalCreated: "📝",
    ProposalDiscussionStarted: "💬",
    ProposalVotingStarted: "🗳",
    VoteCast: "✅",
    ProposalFinalized: "⚖",
    ProposalExecuted: "🔧",
    IssueLinked: "🔗",
    PullRequestMerged: "🔀",
    ExecutionQueued: "⏳",
    ExecutionCompleted: "✅",
    ExecutionCanceled: "❌"
  };
  return (
    <div className="timeline-list">
      {entries.map((entry, idx) => (
        <div className={`timeline-entry phase-${entry.phase}`} key={entry.id}>
          <div className="timeline-connector">
            {idx < entries.length - 1 && <span className="timeline-line" />}
          </div>
          <div className="timeline-dot">{typeIcons[entry.type] || "•"}</div>
          <div className="timeline-content">
            <div className="timeline-header">
              <strong>{entry.type.replace(/([A-Z])/g, " $1").trim()}</strong>
              <span className="timeline-phase">{phaseLabels[entry.phase] || entry.phase}</span>
              {entry.blockNumber && <small className="timeline-block">Block #{entry.blockNumber}</small>}
            </div>
            <div className="timeline-detail">{formatTimelineDetail(entry)}</div>
          </div>
        </div>
      ))}
      {entries.length === 0 && <p className="empty">No events recorded for this proposal.</p>}
    </div>
  );
}

function formatTimelineDetail(entry: ProposalTimelineEntry): React.ReactNode {
  const p = entry.payload as Record<string, string | number | boolean>;
  switch (entry.type) {
    case "ProposalCreated":
      return <span>by {short(String(p.proposer || ""))} · type: {String(p.pType || "General")}</span>;
    case "VoteCast":
      return <span>Citizen #{p.citizenId} ({short(String(p.voter || ""))}) voted {p.support ? "YES" : "NO"}</span>;
    case "ProposalFinalized":
      return <span>Status: {String(p.status)} · {p.yesVotes} yes / {p.noVotes} no</span>;
    case "ProposalExecuted":
      return <span>Execution hash: {short(String(p.executionHash || ""))}</span>;
    case "IssueLinked":
      return <a href={String(p.issueUrl || "#")} target="_blank" rel="noreferrer">Issue #{p.issueNumber}</a>;
    case "PullRequestMerged":
      return <a href={String(p.url || "#")} target="_blank" rel="noreferrer">PR #{p.prNumber} → {short(String(p.mergeCommit || ""))}</a>;
    case "ExecutionQueued":
      return <span>EX-{String(p.executionId || "").padStart(4, "0")} → {short(String(p.target || ""))} · executable after {p.earliestExecuteAt ? formatUnix(Number(p.earliestExecuteAt)) : "N/A"}</span>;
    case "ExecutionCompleted":
      return <span>EX-{String(p.executionId || "").padStart(4, "0")} completed · {short(String(p.result || ""))}</span>;
    case "ExecutionCanceled":
      return <span>EX-{String(p.executionId || "").padStart(4, "0")} canceled</span>;
    case "ProposalDiscussionStarted":
    case "ProposalVotingStarted":
      return <span>Phase opened</span>;
    default:
      return <span>{JSON.stringify(p)}</span>;
  }
}

function ProposalChecklist({ items }: { items: ProposalChecklistItem[] }) {
  const completedCount = items.filter((item) => item.completed).length;
  const allDone = completedCount === items.length && items.length > 0;
  return (
    <div className={`checklist ${allDone ? "all-done" : ""}`}>
      {items.map((item) => (
        <div className={`checklist-item ${item.completed ? "done" : "pending"}`} key={item.id}>
          <span className="checklist-icon">{item.completed ? "✅" : "⬜"}</span>
          <div className="checklist-content">
            <strong>{item.label}</strong>
            {item.detail && <small>{item.detail}</small>}
            {item.link && <a href={item.link} target="_blank" rel="noreferrer" className="checklist-link">View →</a>}
          </div>
        </div>
      ))}
      {items.length === 0 && <p className="empty">No checklist items yet.</p>}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
