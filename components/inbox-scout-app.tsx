"use client";

import {
  Activity,
  AtSign,
  ArrowRight,
  BriefcaseBusiness,
  Building2,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Compass,
  Download,
  ExternalLink,
  FileText,
  Globe2,
  Home,
  ListFilter,
  LoaderCircle,
  Mail,
  MapPin,
  Menu,
  MessagesSquare,
  Network,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  Target,
  Upload,
  UserRound,
  Users,
  X,
  XCircle,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { createClient } from "@/lib/supabase/client";
import { initials, renderTemplate } from "@/lib/template";
import type {
  AppBootstrap,
  Campaign,
  CampaignInput,
  Lead,
  LeadStatus,
  RegionMode,
  SearchInput,
  SourceType,
} from "@/lib/types";

type View = "overview" | "discover" | "leads" | "campaigns" | "settings";
type Toast = { id: number; tone: "success" | "error" | "neutral"; message: string };

const DEFAULT_SUBJECT = "Email designer application for {{company}}";
const DEFAULT_BODY = `Hi {{name}},

I’m an email designer based in Nepal, and I’ve been following the thoughtful work coming from {{company}}. I would love to be considered for email design opportunities with your team.

I have attached my CV for a quick introduction. I would be happy to share my portfolio and discuss how I could contribute to your client work.

Best regards,
Your name`;

const SOURCE_META: Record<SourceType, { label: string; icon: React.ComponentType<{ size?: number }> }> = {
  web: { label: "Web", icon: Globe2 },
  linkedin: { label: "LinkedIn", icon: Network },
  instagram: { label: "Instagram", icon: AtSign },
  facebook: { label: "Facebook", icon: MessagesSquare },
};

const NAV_ITEMS: Array<{ id: View; label: string; icon: React.ComponentType<{ size?: number }> }> = [
  { id: "overview", label: "Overview", icon: Home },
  { id: "discover", label: "Find leads", icon: Search },
  { id: "leads", label: "Lead library", icon: Users },
  { id: "campaigns", label: "Campaigns", icon: Send },
  { id: "settings", label: "Connections", icon: Settings },
];

const TIMEZONES = [
  "Asia/Kathmandu",
  "Asia/Kolkata",
  "Europe/London",
  "America/New_York",
  "America/Los_Angeles",
  "Australia/Melbourne",
];

function splitList(value: string): string[] {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function formatDate(value: string | null): string {
  if (!value) return "Not scheduled";
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(
    new Date(value),
  );
}

function sourceIcon(source: SourceType) {
  const Icon = SOURCE_META[source].icon;
  return <Icon size={14} />;
}

function statusLabel(status: LeadStatus) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function confidenceTone(score: number) {
  if (score >= 85) return "high";
  if (score >= 65) return "medium";
  return "low";
}

async function responseJson<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? "Request failed.");
  return payload;
}

function LoadingScreen() {
  return (
    <main className="app-loading">
      <div className="loading-logo"><Compass size={28} /></div>
      <h1>Preparing your workspace</h1>
      <p>Loading leads, campaigns, and connections…</p>
      <div className="loading-line"><span /></div>
    </main>
  );
}

function EmptyState({ icon: Icon, title, copy, action }: {
  icon: React.ComponentType<{ size?: number }>;
  title: string;
  copy: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon"><Icon size={23} /></div>
      <h3>{title}</h3>
      <p>{copy}</p>
      {action}
    </div>
  );
}

export function InboxScoutApp() {
  const [view, setView] = useState<View>("overview");
  const [bootstrap, setBootstrap] = useState<AppBootstrap | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [mobileNav, setMobileNav] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);

  const [regionMode, setRegionMode] = useState<RegionMode>("both");
  const [roles, setRoles] = useState("Email designer, Email marketing agency, Klaviyo designer");
  const [query, setQuery] = useState("");
  const [countries, setCountries] = useState("United States, United Kingdom, Australia, Canada");
  const [cities, setCities] = useState("Kathmandu, Lalitpur");
  const [leadType, setLeadType] = useState<SearchInput["leadType"]>("all");
  const [sources, setSources] = useState<SourceType[]>(["web", "linkedin", "instagram", "facebook"]);
  const [deepScan, setDeepScan] = useState(true);
  const [searching, setSearching] = useState(false);
  const [lastSearchCount, setLastSearchCount] = useState<number | null>(null);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [leadSearch, setLeadSearch] = useState("");
  const [leadFilter, setLeadFilter] = useState<"all" | LeadStatus>("all");
  const [sourceFilter, setSourceFilter] = useState<Set<SourceType>>(new Set());
  const [updatingLeads, setUpdatingLeads] = useState(false);

  const [campaignOpen, setCampaignOpen] = useState(false);
  const [campaignLeadIds, setCampaignLeadIds] = useState<string[]>([]);
  const [campaignName, setCampaignName] = useState("Portfolio outreach");
  const [subject, setSubject] = useState(DEFAULT_SUBJECT);
  const [body, setBody] = useState(DEFAULT_BODY);
  const [dailyLimit, setDailyLimit] = useState(12);
  const [sendTimezone, setSendTimezone] = useState("Asia/Kathmandu");
  const [sendStart, setSendStart] = useState("09:00");
  const [sendEnd, setSendEnd] = useState("17:00");
  const [scheduledAt, setScheduledAt] = useState("");
  const [cvPath, setCvPath] = useState<string | null>(null);
  const [cvName, setCvName] = useState("");
  const [uploadingCv, setUploadingCv] = useState(false);
  const [creatingCampaign, setCreatingCampaign] = useState(false);

  function notify(message: string, tone: Toast["tone"] = "neutral") {
    const id = ++toastId.current;
    setToasts((current) => [...current, { id, tone, message }]);
    window.setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 4200);
  }

  async function loadWorkspace() {
    setLoading(true);
    setLoadError("");
    try {
      const payload = await responseJson<AppBootstrap>(await fetch("/api/bootstrap", { cache: "no-store" }));
      setBootstrap(payload);
      setLeads(payload.leads);
      setCampaigns(payload.campaigns);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Unable to load InboxScout.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadWorkspace();
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const gmail = params.get("gmail");
    if (gmail === "connected") notify("Gmail connected successfully.", "success");
    if (gmail === "error") notify(`Gmail connection failed: ${params.get("reason") ?? "unknown error"}`, "error");
    if (gmail) window.history.replaceState({}, "", window.location.pathname);
  }, []);

  const approvedLeads = useMemo(
    () => leads.filter((lead) => lead.status === "approved" && lead.email && lead.emailPublic),
    [leads],
  );
  const filteredLeads = useMemo(() => {
    const term = leadSearch.trim().toLowerCase();
    return leads.filter((lead) => {
      if (leadFilter !== "all" && lead.status !== leadFilter) return false;
      if (sourceFilter.size && !sourceFilter.has(lead.sourceType)) return false;
      if (!term) return true;
      return [lead.name, lead.company, lead.role, lead.email, lead.location, lead.country]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(term);
    });
  }, [leadFilter, leadSearch, leads, sourceFilter]);

  const stats = useMemo(() => {
    const sent = campaigns.reduce((sum, campaign) => sum + campaign.sent, 0);
    const replies = campaigns.reduce((sum, campaign) => sum + campaign.replied, 0);
    return {
      leads: leads.length,
      ready: approvedLeads.length,
      sent,
      replies,
      replyRate: sent ? Math.round((replies / sent) * 100) : 0,
    };
  }, [approvedLeads.length, campaigns, leads.length]);

  function toggleSource(source: SourceType) {
    setSources((current) =>
      current.includes(source)
        ? current.length === 1
          ? current
          : current.filter((item) => item !== source)
        : [...current, source],
    );
  }

  function toggleSourceFilter(source: SourceType) {
    setSourceFilter((current) => {
      const next = new Set(current);
      if (next.has(source)) next.delete(source);
      else next.add(source);
      return next;
    });
  }

  async function runSearch(event: React.FormEvent) {
    event.preventDefault();
    setSearching(true);
    setLastSearchCount(null);
    try {
      const input: SearchInput = {
        query,
        roles: splitList(roles),
        regionMode,
        countries: regionMode === "nepal" ? [] : splitList(countries),
        cities: splitList(cities),
        sources,
        leadType,
        deepScan,
      };
      const payload = await responseJson<{
        leads: Lead[];
        addedCount?: number;
        perSource?: Partial<Record<SourceType, number>>;
      }>(
        await fetch("/api/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        }),
      );
      if (bootstrap?.demoMode) {
        const merged = new Map(leads.map((lead) => [lead.id, lead]));
        payload.leads.forEach((lead) => merged.set(lead.id, lead));
        setLeads([...merged.values()]);
      } else {
        setLeads(payload.leads);
      }
      const count = payload.addedCount ?? payload.leads.length;
      setLastSearchCount(count);
      const breakdown = payload.perSource
        ? sources
            .map((source) => `${SOURCE_META[source].label} ${payload.perSource?.[source] ?? 0}`)
            .join(" · ")
        : "";
      notify(
        `Search found ${count} relevant result${count === 1 ? "" : "s"}${breakdown ? ` — ${breakdown}` : ""}.`,
        count ? "success" : "neutral",
      );
      // Show exactly what this search targeted; the chips can be cleared anytime.
      setSourceFilter(new Set(sources));
      setView("leads");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Search failed.", "error");
    } finally {
      setSearching(false);
    }
  }

  function toggleSelected(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function updateStatus(ids: string[], status: "new" | "approved" | "rejected") {
    if (!ids.length) return;
    setUpdatingLeads(true);
    try {
      await responseJson<{ ok: boolean }>(
        await fetch("/api/leads/status", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids, status }),
        }),
      );
      setLeads((current) => current.map((lead) => (ids.includes(lead.id) ? { ...lead, status } : lead)));
      setSelected(new Set());
      notify(`${ids.length} lead${ids.length === 1 ? "" : "s"} marked ${status}.`, "success");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Unable to update the leads.", "error");
    } finally {
      setUpdatingLeads(false);
    }
  }

  function exportCsv() {
    const rows = (selected.size ? leads.filter((lead) => selected.has(lead.id)) : filteredLeads);
    if (!rows.length) return notify("There are no leads to export.", "error");
    const safeCell = (value: unknown) => {
      let text = String(value ?? "");
      if (/^[=+\-@]/.test(text)) text = `'${text}`;
      return `"${text.replaceAll('"', '""')}"`;
    };
    const headers = ["Name", "Company", "Role", "Email", "Location", "Country", "Status", "Confidence", "Source", "Source URL"];
    const csv = [
      headers.map(safeCell).join(","),
      ...rows.map((lead) =>
        [lead.name, lead.company, lead.role, lead.email, lead.location, lead.country, lead.status, lead.confidence, lead.sourceType, lead.sourceUrl]
          .map(safeCell)
          .join(","),
      ),
    ].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `inboxscout-leads-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function openCampaignComposer() {
    const requested = selected.size
      ? leads.filter((lead) => selected.has(lead.id) && lead.status === "approved" && lead.email)
      : approvedLeads;
    if (!requested.length) {
      notify("Approve at least one lead with a published email before creating a campaign.", "error");
      setView("leads");
      return;
    }
    if (!bootstrap?.demoMode && !bootstrap?.gmailConnected) {
      notify("Connect Gmail before scheduling a live campaign.", "error");
      setView("settings");
      return;
    }
    setCampaignLeadIds(requested.map((lead) => lead.id));
    setCampaignOpen(true);
  }

  async function uploadCv(file: File | undefined) {
    if (!file) return;
    setUploadingCv(true);
    try {
      const form = new FormData();
      form.set("file", file);
      const result = await responseJson<{ path: string; name: string }>(
        await fetch("/api/cv", { method: "POST", body: form }),
      );
      setCvPath(result.path);
      setCvName(result.name);
      notify("CV uploaded to private storage.", "success");
    } catch (error) {
      notify(error instanceof Error ? error.message : "CV upload failed.", "error");
    } finally {
      setUploadingCv(false);
    }
  }

  async function createNewCampaign(event: React.FormEvent) {
    event.preventDefault();
    setCreatingCampaign(true);
    try {
      const input: CampaignInput = {
        name: campaignName,
        subjectTemplate: subject,
        bodyTemplate: body,
        leadIds: campaignLeadIds,
        cvPath,
        dailyLimit,
        sendTimezone,
        sendStart,
        sendEnd,
        scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null,
      };
      const result = await responseJson<{ campaign: Campaign }>(
        await fetch("/api/campaigns", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        }),
      );
      setCampaigns((current) => [result.campaign, ...current]);
      setCampaignOpen(false);
      setSelected(new Set());
      setView("campaigns");
      notify("Campaign approved and added to the sending queue.", "success");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Unable to schedule the campaign.", "error");
    } finally {
      setCreatingCampaign(false);
    }
  }

  async function toggleCampaign(campaign: Campaign) {
    const status = campaign.status === "paused" ? "scheduled" : "paused";
    try {
      await responseJson<{ ok: boolean }>(
        await fetch(`/api/campaigns/${campaign.id}/status`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        }),
      );
      setCampaigns((current) => current.map((item) => (item.id === campaign.id ? { ...item, status } : item)));
      notify(status === "paused" ? "Campaign paused." : "Campaign resumed.", "success");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Unable to update the campaign.", "error");
    }
  }

  async function disconnectGmail() {
    try {
      await responseJson<{ ok: boolean }>(await fetch("/api/gmail", { method: "DELETE" }));
      setBootstrap((current) => current ? { ...current, gmailConnected: false, connectedEmail: null } : current);
      notify("Gmail disconnected.", "success");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Unable to disconnect Gmail.", "error");
    }
  }

  async function signOut() {
    if (bootstrap?.demoMode) return;
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.assign("/login");
  }

  if (loading) return <LoadingScreen />;
  if (loadError || !bootstrap) {
    return (
      <main className="fatal-state">
        <div className="fatal-card">
          <XCircle size={28} />
          <h1>InboxScout could not start</h1>
          <p>{loadError}</p>
          <button className="primary-button" onClick={() => void loadWorkspace()}><RefreshCw size={17} /> Try again</button>
        </div>
      </main>
    );
  }

  const previewLead = leads.find((lead) => campaignLeadIds.includes(lead.id)) ?? approvedLeads[0];

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNav ? "sidebar-open" : ""}`}>
        <div className="sidebar-head">
          <div className="brand">
            <span className="brand-mark"><Compass size={19} strokeWidth={2.5} /></span>
            <span>InboxScout</span>
          </div>
          <button className="icon-button sidebar-close" onClick={() => setMobileNav(false)} aria-label="Close navigation"><X size={19} /></button>
        </div>

        <nav className="main-nav" aria-label="Main navigation">
          <p className="nav-label">Workspace</p>
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={`nav-item ${view === item.id ? "nav-active" : ""}`}
                onClick={() => { setView(item.id); setMobileNav(false); }}
              >
                <Icon size={18} />
                <span>{item.label}</span>
                {item.id === "leads" && <span className="nav-count">{leads.length}</span>}
              </button>
            );
          })}
        </nav>

        <div className="sidebar-guide">
          <span className="guide-icon"><Sparkles size={17} /></span>
          <div>
            <strong>Quality over volume</strong>
            <p>Review every contact before adding them to a campaign.</p>
          </div>
        </div>

        <div className="sidebar-foot">
          <div className="user-avatar">YS</div>
          <div className="user-copy">
            <strong>Your workspace</strong>
            <span>{bootstrap.demoMode ? "Demo mode" : "Private account"}</span>
          </div>
          {!bootstrap.demoMode && <button className="icon-button" onClick={() => void signOut()} title="Sign out"><ArrowRight size={17} /></button>}
        </div>
      </aside>

      {mobileNav && <button className="sidebar-backdrop" onClick={() => setMobileNav(false)} aria-label="Close navigation" />}

      <main className="main-content">
        <header className="topbar">
          <button className="icon-button mobile-menu" onClick={() => setMobileNav(true)} aria-label="Open navigation"><Menu size={20} /></button>
          <div className="topbar-title">
            <span>{NAV_ITEMS.find((item) => item.id === view)?.label}</span>
            {bootstrap.demoMode && <span className="demo-pill"><Zap size={12} /> Safe demo</span>}
          </div>
          <div className="topbar-actions">
            <button className="secondary-button desktop-action" onClick={() => setView("discover")}><Search size={16} /> Find leads</button>
            <button className="primary-button" onClick={openCampaignComposer}><Plus size={17} /> New campaign</button>
          </div>
        </header>

        <div className="page-content">
          {view === "overview" && (
            <section className="view-stack">
              <div className="welcome-row">
                <div>
                  <span className="eyebrow">Monday, August 24</span>
                  <h1>Good afternoon. Let’s find your next opportunity.</h1>
                  <p>Your outreach workspace is ready for Nepal and international searches.</p>
                </div>
                <button className="primary-button primary-large" onClick={() => setView("discover")}>
                  Start a lead search <ArrowRight size={18} />
                </button>
              </div>

              <div className="stats-grid">
                <article className="stat-card">
                  <div className="stat-icon stat-purple"><Users size={20} /></div>
                  <div><span>Total leads</span><strong>{stats.leads}</strong><small>Across Nepal & abroad</small></div>
                </article>
                <article className="stat-card">
                  <div className="stat-icon stat-green"><CheckCircle2 size={20} /></div>
                  <div><span>Ready to contact</span><strong>{stats.ready}</strong><small>Approved with public email</small></div>
                </article>
                <article className="stat-card">
                  <div className="stat-icon stat-blue"><Send size={20} /></div>
                  <div><span>Emails sent</span><strong>{stats.sent}</strong><small>Controlled campaign sends</small></div>
                </article>
                <article className="stat-card">
                  <div className="stat-icon stat-amber"><Activity size={20} /></div>
                  <div><span>Reply rate</span><strong>{stats.replyRate}%</strong><small>{stats.replies} replies detected</small></div>
                </article>
              </div>

              <div className="overview-grid">
                <article className="panel coverage-panel">
                  <div className="panel-head">
                    <div><span className="eyebrow">Search coverage</span><h2>One workspace, wider reach</h2></div>
                    <span className="live-status"><i /> Ready</span>
                  </div>
                  <div className="coverage-body">
                    <div className="orbit-visual" aria-hidden="true">
                      <span className="orbit orbit-one" />
                      <span className="orbit orbit-two" />
                      <Globe2 size={58} strokeWidth={1.25} />
                      <i className="dot dot-nepal" />
                      <i className="dot dot-world" />
                    </div>
                    <div className="coverage-copy">
                      <div><span className="flag-badge">NP</span><div><strong>Nepal</strong><small>Kathmandu, Lalitpur, Pokhara & nationwide</small></div></div>
                      <div><span className="flag-badge flag-world"><Globe2 size={15} /></span><div><strong>International</strong><small>Target countries, cities, or remote teams</small></div></div>
                      <button className="text-button" onClick={() => setView("discover")}>Adjust search regions <ChevronRight size={15} /></button>
                    </div>
                  </div>
                </article>

                <article className="panel steps-panel">
                  <div className="panel-head"><div><span className="eyebrow">Your workflow</span><h2>From search to shortlist</h2></div></div>
                  <ol className="steps-list">
                    <li className="step-done"><span><Check size={15} /></span><div><strong>Workspace configured</strong><small>Supabase architecture and privacy rules</small></div></li>
                    <li className={leads.length ? "step-done" : "step-current"}><span>{leads.length ? <Check size={15} /> : "2"}</span><div><strong>Discover relevant contacts</strong><small>Search public sources and business sites</small></div></li>
                    <li className={approvedLeads.length ? "step-done" : ""}><span>{approvedLeads.length ? <Check size={15} /> : "3"}</span><div><strong>Review and approve</strong><small>Verify evidence before outreach</small></div></li>
                    <li className={campaigns.length ? "step-done" : ""}><span>{campaigns.length ? <Check size={15} /> : "4"}</span><div><strong>Schedule a campaign</strong><small>Personalize, attach CV, and send gradually</small></div></li>
                  </ol>
                </article>
              </div>

              <article className="panel recent-panel">
                <div className="panel-head">
                  <div><span className="eyebrow">Latest discoveries</span><h2>Recent leads</h2></div>
                  <button className="text-button" onClick={() => setView("leads")}>View all <ArrowRight size={15} /></button>
                </div>
                {leads.length ? (
                  <div className="compact-leads">
                    {leads.slice(0, 5).map((lead) => (
                      <button key={lead.id} className="compact-lead" onClick={() => setView("leads")}>
                        <span className={`lead-avatar avatar-${lead.sourceType}`}>{initials(lead.company || lead.name)}</span>
                        <span className="compact-primary"><strong>{lead.name}</strong><small>{lead.role} · {lead.company}</small></span>
                        <span className="compact-location"><MapPin size={14} /> {lead.location}</span>
                        <span className={`confidence confidence-${confidenceTone(lead.confidence)}`}>{lead.confidence}%</span>
                        <ChevronRight size={16} />
                      </button>
                    ))}
                  </div>
                ) : (
                  <EmptyState icon={Search} title="No leads yet" copy="Start your first search to build a focused shortlist." action={<button className="primary-button" onClick={() => setView("discover")}>Find leads</button>} />
                )}
              </article>
            </section>
          )}

          {view === "discover" && (
            <section className="view-stack">
              <div className="page-heading">
                <div><span className="eyebrow">Public lead discovery</span><h1>Find teams worth reaching out to</h1><p>Set your focus. InboxScout will search public indexes and scan only relevant business websites.</p></div>
              </div>

              <div className="discover-layout">
                <form className="panel search-form" onSubmit={runSearch}>
                  <div className="form-section">
                    <div className="section-number">1</div>
                    <div className="section-content">
                      <label className="section-title">Where do you want to search?</label>
                      <div className="segmented-control segmented-three">
                        {(["nepal", "international", "both"] as RegionMode[]).map((mode) => (
                          <button type="button" key={mode} className={regionMode === mode ? "selected" : ""} onClick={() => setRegionMode(mode)}>
                            {mode === "nepal" ? "Nepal" : mode === "international" ? "Outside Nepal" : "Both"}
                          </button>
                        ))}
                      </div>
                      <div className="two-fields">
                        <label><span>Cities <small>optional</small></span><input value={cities} onChange={(event) => setCities(event.target.value)} placeholder="Kathmandu, London" /></label>
                        {regionMode !== "nepal" && <label><span>Countries <small>comma separated</small></span><input value={countries} onChange={(event) => setCountries(event.target.value)} placeholder="Australia, Canada" /></label>}
                      </div>
                    </div>
                  </div>

                  <div className="form-section">
                    <div className="section-number">2</div>
                    <div className="section-content">
                      <label className="section-title" htmlFor="roles">What kind of work should match?</label>
                      <label><span>Roles and agency types <small>comma separated</small></span><input id="roles" value={roles} onChange={(event) => setRoles(event.target.value)} required /></label>
                      <label><span>Extra keywords <small>optional</small></span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ecommerce, retention, remote, hiring" /></label>
                      <div className="segmented-control">
                        {(["all", "agency", "person"] as const).map((type) => (
                          <button type="button" key={type} className={leadType === type ? "selected" : ""} onClick={() => setLeadType(type)}>
                            {type === "all" ? "Agencies & people" : type === "agency" ? "Agencies only" : "People only"}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="form-section">
                    <div className="section-number">3</div>
                    <div className="section-content">
                      <span className="section-title">Choose discovery sources</span>
                      <div className="source-grid">
                        {(Object.keys(SOURCE_META) as SourceType[]).map((source) => {
                          const Icon = SOURCE_META[source].icon;
                          const active = sources.includes(source);
                          return <button type="button" key={source} className={`source-option ${active ? "source-selected" : ""}`} onClick={() => toggleSource(source)}><span><Icon size={18} /></span><strong>{SOURCE_META[source].label}</strong><i>{active && <Check size={13} />}</i></button>;
                        })}
                      </div>
                      <label className="switch-row">
                        <button type="button" role="switch" aria-checked={deepScan} className={`switch ${deepScan ? "switch-on" : ""}`} onClick={() => setDeepScan(!deepScan)}><span /></button>
                        <span><strong>Scan official websites for published contacts</strong><small>Checks a few public Contact, About, Team, and Careers pages.</small></span>
                      </label>
                    </div>
                  </div>

                  <button className="primary-button search-submit" disabled={searching || !roles.trim()}>
                    {searching ? <><LoaderCircle className="spin" size={18} /> Researching public sources…</> : <><Search size={18} /> Find relevant leads</>}
                  </button>
                  {lastSearchCount !== null && <p className="search-complete"><CheckCircle2 size={16} /> Last search found {lastSearchCount} results.</p>}
                </form>

                <aside className="discover-aside">
                  <article className="panel process-card">
                    <span className="aside-icon"><ShieldCheck size={21} /></span>
                    <h3>What InboxScout scans</h3>
                    <div className="mini-flow">
                      <div><span>1</span><p><strong>Search index</strong><small>Find candidate websites and public profile URLs.</small></p></div>
                      <i />
                      <div><span>2</span><p><strong>Official websites</strong><small>Check only a limited set of relevant public pages.</small></p></div>
                      <i />
                      <div><span>3</span><p><strong>Your review</strong><small>Every email includes evidence and its original source.</small></p></div>
                    </div>
                  </article>
                  <article className="tip-card">
                    <Sparkles size={18} />
                    <div><strong>Search tip</strong><p>Start with two or three specific roles and a few target countries. Focused searches usually create a better shortlist.</p></div>
                  </article>
                  <article className="safety-note"><XCircle size={17} /><p>No login bypasses, private databases, guessed emails, or direct social-media scraping.</p></article>
                </aside>
              </div>
            </section>
          )}

          {view === "leads" && (
            <section className="view-stack">
              <div className="page-heading page-heading-actions">
                <div><span className="eyebrow">Source-backed contacts</span><h1>Lead library</h1><p>Verify the evidence, approve the right contacts, and leave the rest behind.</p></div>
                <button className="secondary-button" onClick={exportCsv}><Download size={16} /> Export CSV</button>
              </div>

              <article className="panel leads-panel">
                <div className="leads-toolbar">
                  <label className="search-box"><Search size={17} /><input value={leadSearch} onChange={(event) => setLeadSearch(event.target.value)} placeholder="Search names, companies, roles…" /></label>
                  <div className="filter-wrap"><ListFilter size={16} /><select value={leadFilter} onChange={(event) => setLeadFilter(event.target.value as typeof leadFilter)}><option value="all">All statuses</option><option value="new">New</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="contacted">Contacted</option><option value="replied">Replied</option></select></div>
                  <div className="source-filter" role="group" aria-label="Filter by source">
                    {(Object.keys(SOURCE_META) as SourceType[]).map((source) => {
                      const active = sourceFilter.has(source);
                      return (
                        <button key={source} type="button" className={`source-chip ${active ? "source-chip-on" : ""}`} title={`Show only ${SOURCE_META[source].label} leads`} onClick={() => toggleSourceFilter(source)}>
                          {sourceIcon(source)} {SOURCE_META[source].label}
                        </button>
                      );
                    })}
                    {sourceFilter.size > 0 && (
                      <button type="button" className="source-chip source-chip-clear" onClick={() => setSourceFilter(new Set())}>
                        <X size={13} /> All
                      </button>
                    )}
                  </div>
                  <span className="result-count">{filteredLeads.length} result{filteredLeads.length === 1 ? "" : "s"}</span>
                </div>

                {selected.size > 0 && (
                  <div className="bulk-bar">
                    <span><strong>{selected.size}</strong> selected</span>
                    <button onClick={() => void updateStatus([...selected], "approved")} disabled={updatingLeads}><Check size={15} /> Approve</button>
                    <button onClick={() => void updateStatus([...selected], "rejected")} disabled={updatingLeads}><X size={15} /> Reject</button>
                    <button onClick={openCampaignComposer}><Send size={15} /> Add to campaign</button>
                    <button className="bulk-clear" onClick={() => setSelected(new Set())}>Clear</button>
                  </div>
                )}

                {filteredLeads.length ? (
                  <div className="table-scroll">
                    <table className="leads-table">
                      <thead><tr><th><input type="checkbox" aria-label="Select all visible leads" checked={filteredLeads.length > 0 && filteredLeads.every((lead) => selected.has(lead.id))} onChange={() => setSelected(filteredLeads.every((lead) => selected.has(lead.id)) ? new Set() : new Set(filteredLeads.map((lead) => lead.id)))} /></th><th>Contact</th><th>Published email</th><th>Location</th><th>Source</th><th>Confidence</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
                      <tbody>
                        {filteredLeads.map((lead) => (
                          <tr key={lead.id} className={selected.has(lead.id) ? "row-selected" : ""}>
                            <td><input type="checkbox" checked={selected.has(lead.id)} onChange={() => toggleSelected(lead.id)} aria-label={`Select ${lead.name}`} /></td>
                            <td><div className="lead-person"><span className={`lead-avatar avatar-${lead.sourceType}`}>{initials(lead.company || lead.name)}</span><div><strong>{lead.name}</strong><small>{lead.role} · {lead.company}</small></div></div></td>
                            <td>{lead.email ? <div className="email-cell"><strong>{lead.email}</strong><small title={lead.evidence ?? undefined}>{lead.evidence ?? "Public source recorded"}</small></div> : <span className="missing-email">Not found</span>}</td>
                            <td><span className="location-cell"><MapPin size={14} /> {lead.location}</span></td>
                            <td><a className={`source-badge source-${lead.sourceType}`} href={lead.sourceUrl} target="_blank" rel="noreferrer" title="Open original source">{sourceIcon(lead.sourceType)} {SOURCE_META[lead.sourceType].label} <ExternalLink size={11} /></a></td>
                            <td><span className={`confidence confidence-${confidenceTone(lead.confidence)}`}>{lead.confidence}%</span></td>
                            <td><span className={`status-chip status-${lead.status}`}>{statusLabel(lead.status)}</span></td>
                            <td><div className="row-actions">{lead.status !== "approved" && lead.email && <button className="icon-button" title="Approve" onClick={() => void updateStatus([lead.id], "approved")}><Check size={16} /></button>}<a className="icon-button" href={lead.sourceUrl} target="_blank" rel="noreferrer" title="Open source"><ExternalLink size={15} /></a></div></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <EmptyState icon={Users} title="No matching leads" copy="Try a different filter or start a new discovery search." action={<button className="primary-button" onClick={() => setView("discover")}>Find leads</button>} />
                )}
              </article>
            </section>
          )}

          {view === "campaigns" && (
            <section className="view-stack">
              <div className="page-heading page-heading-actions">
                <div><span className="eyebrow">Controlled Gmail outreach</span><h1>Campaigns</h1><p>Approved contacts only, conservative daily limits, and a clear sending history.</p></div>
                <button className="primary-button" onClick={openCampaignComposer}><Plus size={17} /> New campaign</button>
              </div>

              <div className="campaign-summary">
                <div><span className="campaign-summary-icon"><Send size={18} /></span><p><strong>{campaigns.filter((campaign) => campaign.status === "scheduled").length}</strong><small>Active campaigns</small></p></div>
                <div><span className="campaign-summary-icon"><Clock3 size={18} /></span><p><strong>{campaigns.reduce((sum, campaign) => sum + campaign.queued, 0)}</strong><small>Queued emails</small></p></div>
                <div><span className="campaign-summary-icon"><Mail size={18} /></span><p><strong>{stats.sent}</strong><small>Sent safely</small></p></div>
                <div><span className="campaign-summary-icon"><Activity size={18} /></span><p><strong>{stats.replies}</strong><small>Replies found</small></p></div>
              </div>

              {campaigns.length ? (
                <div className="campaign-list">
                  {campaigns.map((campaign) => {
                    const progress = campaign.total ? Math.round((campaign.sent / campaign.total) * 100) : 0;
                    return (
                      <article className="panel campaign-card" key={campaign.id}>
                        <div className="campaign-main">
                          <span className="campaign-icon"><BriefcaseBusiness size={20} /></span>
                          <div className="campaign-title"><div><h3>{campaign.name}</h3><span className={`status-chip campaign-${campaign.status}`}>{campaign.status}</span></div><p>{campaign.subjectTemplate}</p></div>
                          <button className="secondary-button compact-button" onClick={() => void toggleCampaign(campaign)}>{campaign.status === "paused" ? <><Play size={15} /> Resume</> : <><Pause size={15} /> Pause</>}</button>
                        </div>
                        <div className="campaign-metrics">
                          <span><small>Audience</small><strong>{campaign.total} contacts</strong></span>
                          <span><small>Daily limit</small><strong>{campaign.dailyLimit} emails</strong></span>
                          <span><small>Send window</small><strong>{campaign.sendStart}–{campaign.sendEnd}</strong></span>
                          <span><small>Starts</small><strong>{formatDate(campaign.scheduledAt)}</strong></span>
                        </div>
                        <div className="progress-row"><div><span style={{ width: `${progress}%` }} /></div><small>{campaign.sent} sent · {campaign.queued} queued · {campaign.replied} replied</small></div>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <article className="panel"><EmptyState icon={Send} title="No campaigns yet" copy="Approve a few leads, connect Gmail, and create your first thoughtful outreach campaign." action={<button className="primary-button" onClick={openCampaignComposer}>Create campaign</button>} /></article>
              )}
            </section>
          )}

          {view === "settings" && (
            <section className="view-stack settings-view">
              <div className="page-heading"><div><span className="eyebrow">Private integrations</span><h1>Connections</h1><p>Connect the services InboxScout needs. Secret credentials are never sent to the browser.</p></div></div>
              <div className="connection-grid">
                <article className="panel connection-card">
                  <div className="connection-brand gmail-brand"><Mail size={22} /></div>
                  <div className="connection-copy"><div><h3>Gmail</h3>{bootstrap.gmailConnected ? <span className="connected-pill"><i /> Connected</span> : <span className="not-connected-pill">Not connected</span>}</div><p>Send approved campaigns and detect replies through Google OAuth.</p>{bootstrap.connectedEmail && <strong className="connected-account">{bootstrap.connectedEmail}</strong>}</div>
                  <div className="connection-actions">
                    {bootstrap.demoMode ? <button className="secondary-button" onClick={() => notify("Turn off demo mode and add Google OAuth credentials first.", "neutral")}>Demo only</button> : bootstrap.gmailConnected ? <button className="secondary-button" onClick={() => void disconnectGmail()}>Disconnect</button> : <a className={`primary-button ${!bootstrap.gmailConfigured ? "button-disabled" : ""}`} href={bootstrap.gmailConfigured ? "/api/gmail/connect" : undefined}>Connect Gmail</a>}
                  </div>
                </article>

                <article className="panel connection-card">
                  <div className="connection-brand supabase-brand"><Zap size={22} /></div>
                  <div className="connection-copy"><div><h3>Supabase</h3><span className="connected-pill"><i /> {bootstrap.demoMode ? "Demo" : "Connected"}</span></div><p>Postgres database, authentication, private CV storage, and scheduled background jobs.</p></div>
                  <div className="connection-actions"><span className="read-only-note"><ShieldCheck size={15} /> Owner-only data</span></div>
                </article>

                <article className="panel connection-card">
                  <div className="connection-brand tavily-brand"><Search size={22} /></div>
                  <div className="connection-copy"><div><h3>Tavily Search</h3>{bootstrap.searchConfigured ? <span className="connected-pill"><i /> Ready</span> : <span className="not-connected-pill">Key needed</span>}</div><p>Find public business websites and indexed social-profile URLs without scraping search pages.</p></div>
                  <div className="connection-actions"><span className="read-only-note"><Globe2 size={15} /> Public index</span></div>
                </article>
              </div>

              <article className="panel guardrail-panel">
                <div className="guardrail-head"><span><ShieldCheck size={22} /></span><div><span className="eyebrow">Built-in guardrails</span><h2>Responsible by default</h2></div></div>
                <div className="guardrail-grid">
                  <div><Check size={16} /><p><strong>Published emails only</strong><small>No generated or guessed addresses.</small></p></div>
                  <div><Check size={16} /><p><strong>Human campaign approval</strong><small>No contact receives an email automatically after discovery.</small></p></div>
                  <div><Check size={16} /><p><strong>Suppression enforcement</strong><small>Skipped contacts stay skipped across campaigns.</small></p></div>
                  <div><Check size={16} /><p><strong>Conservative rate limits</strong><small>Daily sending is capped at 50 and defaults much lower.</small></p></div>
                </div>
              </article>
            </section>
          )}
        </div>
      </main>

      {campaignOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setCampaignOpen(false); }}>
          <section className="campaign-modal" role="dialog" aria-modal="true" aria-labelledby="campaign-title">
            <header className="modal-head"><div><span className="eyebrow">Review before scheduling</span><h2 id="campaign-title">Create outreach campaign</h2></div><button className="icon-button" onClick={() => setCampaignOpen(false)} aria-label="Close campaign"><X size={20} /></button></header>
            <form onSubmit={createNewCampaign}>
              <div className="modal-body">
                <div className="composer-main">
                  <div className="composer-audience"><span><Users size={17} /></span><p><strong>{campaignLeadIds.length} approved contact{campaignLeadIds.length === 1 ? "" : "s"}</strong><small>Only contacts with a published email are included.</small></p><button type="button" className="text-button" onClick={() => { setCampaignOpen(false); setView("leads"); }}>Review</button></div>
                  <label><span>Campaign name</span><input value={campaignName} onChange={(event) => setCampaignName(event.target.value)} required minLength={2} /></label>
                  <label><span>Subject</span><input value={subject} onChange={(event) => setSubject(event.target.value)} required maxLength={180} /></label>
                  <label><span>Message</span><textarea value={body} onChange={(event) => setBody(event.target.value)} required rows={11} minLength={20} /></label>
                  <div className="template-tokens"><span>Personalization:</span>{["{{name}}", "{{company}}", "{{role}}", "{{location}}"].map((token) => <button type="button" key={token} onClick={() => setBody((current) => `${current}${current.endsWith(" ") ? "" : " "}${token}`)}>{token}</button>)}</div>

                  <div className="cv-upload">
                    <input id="cv-file" type="file" accept="application/pdf,.pdf" onChange={(event) => void uploadCv(event.target.files?.[0])} />
                    <label htmlFor="cv-file"><span className={cvPath ? "upload-complete" : ""}>{uploadingCv ? <LoaderCircle className="spin" size={20} /> : cvPath ? <Check size={20} /> : <Upload size={20} />}</span><p><strong>{cvName || "Attach your CV"}</strong><small>{cvPath ? "Stored privately and ready to attach" : "PDF only · maximum 10 MB"}</small></p><em>{cvPath ? "Replace" : "Choose file"}</em></label>
                  </div>
                </div>

                <aside className="composer-side">
                  <div className="schedule-card">
                    <h3><Clock3 size={17} /> Sending controls</h3>
                    <label><span>Daily limit</span><input type="number" value={dailyLimit} onChange={(event) => setDailyLimit(Number(event.target.value))} min={1} max={50} /></label>
                    <label><span>Timezone</span><select value={sendTimezone} onChange={(event) => setSendTimezone(event.target.value)}>{TIMEZONES.map((zone) => <option key={zone}>{zone}</option>)}</select></label>
                    <div className="two-fields"><label><span>From</span><input type="time" value={sendStart} onChange={(event) => setSendStart(event.target.value)} /></label><label><span>Until</span><input type="time" value={sendEnd} onChange={(event) => setSendEnd(event.target.value)} /></label></div>
                    <label><span>Start date <small>optional</small></span><input type="datetime-local" value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} /></label>
                    <p className="schedule-note"><ShieldCheck size={15} /> Emails are spaced by the background queue and stop at the daily limit.</p>
                  </div>

                  <div className="preview-card">
                    <span className="eyebrow">Live preview</span>
                    <div className="preview-email"><span className="preview-avatar">{initials(previewLead?.company ?? "InboxScout")}</span><p><strong>To: {previewLead?.email ?? "approved contact"}</strong><small>{previewLead?.company ?? "Company"}</small></p></div>
                    <strong className="preview-subject">{renderTemplate(subject, previewLead ?? {})}</strong>
                    <p className="preview-body">{renderTemplate(body, previewLead ?? {}).slice(0, 230)}{body.length > 230 ? "…" : ""}</p>
                    {cvPath && <span className="preview-attachment"><FileText size={14} /> {cvName || "CV.pdf"}</span>}
                  </div>
                </aside>
              </div>
              <footer className="modal-foot"><p><ShieldCheck size={15} /> Scheduling confirms that you reviewed this audience and message.</p><div><button type="button" className="secondary-button" onClick={() => setCampaignOpen(false)}>Cancel</button><button className="primary-button" disabled={creatingCampaign || !campaignLeadIds.length}>{creatingCampaign ? <LoaderCircle className="spin" size={17} /> : <Send size={17} />} Approve & schedule</button></div></footer>
            </form>
          </section>
        </div>
      )}

      <div className="toast-stack" aria-live="polite">
        {toasts.map((toast) => <div key={toast.id} className={`toast toast-${toast.tone}`}>{toast.tone === "success" ? <CheckCircle2 size={18} /> : toast.tone === "error" ? <XCircle size={18} /> : <ShieldCheck size={18} />}<span>{toast.message}</span><button onClick={() => setToasts((current) => current.filter((item) => item.id !== toast.id))}><X size={15} /></button></div>)}
      </div>
    </div>
  );
}
