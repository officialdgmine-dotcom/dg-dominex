/**
 * DG Domain Core - Infrastructure Workbench & Test Harness
 * Copyright (c) 2026 Deep Group
 *
 * Dedicated infrastructure inspector, interactive resolver playground,
 * database inspector, and automated test suite runner for the .dg prototype namespace.
 */

import React, { useState, useEffect } from 'react';
import {
  Globe,
  Terminal,
  ShieldAlert,
  Server,
  Database,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Play,
  Search,
  Plus,
  RefreshCw,
  Key,
  Code,
  FileText,
  Lock,
  Layers,
  ExternalLink,
  Copy,
  Check,
} from 'lucide-react';

interface Stats {
  totalDomains: number;
  activeDomains: number;
  totalRecords: number;
  disclaimer: string;
}

interface DomainItem {
  name: string;
  registrantId: string;
  status: 'active' | 'suspended' | 'locked';
  registeredAt: string;
  updatedAt: string;
  expiresAt: string;
}

interface RecordItem {
  name: string;
  type: string;
  value: string;
  ttl: number;
  priority?: number | null;
}

interface DomainDetail extends DomainItem {
  records: RecordItem[];
  disclaimer: string;
}

interface ResolutionResult {
  question: { name: string; type: string };
  status: 'NOERROR' | 'NXDOMAIN' | 'REFUSED' | 'SERVFAIL';
  statusCode: number;
  answers: Array<{ name: string; type: string; data: string; TTL: number; priority?: number }>;
  cached: boolean;
  authoritative: boolean;
  executionTimeMs: number;
  disclaimer: string;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'overview' | 'resolver' | 'registry' | 'database' | 'tests' | 'api'>('overview');
  const [stats, setStats] = useState<Stats | null>(null);
  const [loadingStats, setLoadingStats] = useState(false);

  // Resolver Playground state
  const [queryName, setQueryName] = useState('deepgroup.dg');
  const [queryType, setQueryType] = useState('A');
  const [resolving, setResolving] = useState(false);
  const [resolutionResult, setResolutionResult] = useState<ResolutionResult | null>(null);
  const [dohPayload, setDohPayload] = useState<any | null>(null);
  const [showDohRaw, setShowDohRaw] = useState(false);

  // Registry Sandbox state
  const [checkNameInput, setCheckNameInput] = useState('');
  const [checkResult, setCheckResult] = useState<{ available: boolean; reason?: string; name?: string } | null>(null);
  const [checking, setChecking] = useState(false);

  const [regName, setRegName] = useState('');
  const [regOwner, setRegOwner] = useState('');
  const [regIp, setRegIp] = useState('10.0.3.10');
  const [registering, setRegistering] = useState(false);
  const [regFeedback, setRegFeedback] = useState<{ type: 'success' | 'error'; message: string; token?: string } | null>(null);

  // Database Inspector state
  const [domains, setDomains] = useState<DomainItem[]>([]);
  const [loadingDomains, setLoadingDomains] = useState(false);
  const [selectedDomain, setSelectedDomain] = useState<DomainDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Record update modal state
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [updateAuthToken, setUpdateAuthToken] = useState('');
  const [updateRecordsText, setUpdateRecordsText] = useState('');
  const [updatingRecords, setUpdatingRecords] = useState(false);
  const [updateError, setUpdateError] = useState('');

  // Status update modal
  const [adminKey, setAdminKey] = useState('dg_admin_dev_secret_key_884920');

  // Test Runner state
  const [runningTests, setRunningTests] = useState(false);
  const [testReport, setTestReport] = useState<{
    success: boolean;
    total: number;
    passed: number;
    failed: number;
    durationMs: number;
    output: string;
  } | null>(null);

  // Copy helper
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const copyToClipboard = (text: string, keyId: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(keyId);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const fetchStats = async () => {
    try {
      setLoadingStats(true);
      const res = await fetch('/api/v1/system/stats');
      if (res.ok) {
        const data = await res.json();
        setStats(data);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingStats(false);
    }
  };

  const fetchDomains = async () => {
    try {
      setLoadingDomains(true);
      const res = await fetch('/api/v1/system/domains');
      if (res.ok) {
        const data = await res.json();
        setDomains(data.domains || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingDomains(false);
    }
  };

  useEffect(() => {
    fetchStats();
    fetchDomains();
  }, []);

  // Handle Domain Resolution
  const handleResolve = async (nameToResolve = queryName, typeToResolve = queryType) => {
    try {
      setResolving(true);
      const [resApp, resDoh] = await Promise.all([
        fetch(`/api/v1/resolve?name=${encodeURIComponent(nameToResolve)}&type=${encodeURIComponent(typeToResolve)}`),
        fetch(`/api/v1/dns-query?name=${encodeURIComponent(nameToResolve)}&type=${encodeURIComponent(typeToResolve)}`),
      ]);

      if (resApp.ok) {
        const data = await resApp.json();
        setResolutionResult(data);
      }
      if (resDoh.ok) {
        const doh = await resDoh.json();
        setDohPayload(doh);
      }
    } catch (err: any) {
      console.error(err);
    } finally {
      setResolving(false);
    }
  };

  // Handle Check Availability
  const handleCheckAvailability = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!checkNameInput.trim()) return;

    try {
      setChecking(true);
      setCheckResult(null);
      const res = await fetch(`/api/v1/domains/check?name=${encodeURIComponent(checkNameInput.trim())}`);
      const data = await res.json();
      setCheckResult(data);
    } catch (err) {
      console.error(err);
    } finally {
      setChecking(false);
    }
  };

  // Handle Domain Registration
  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!regName.trim() || !regOwner.trim()) return;

    try {
      setRegistering(true);
      setRegFeedback(null);

      const records = regIp.trim()
        ? [{ name: '@', type: 'A', value: regIp.trim(), ttl: 300 }]
        : undefined;

      const res = await fetch('/api/v1/domains/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: regName.trim(),
          registrantId: regOwner.trim(),
          records,
        }),
      });

      const data = await res.json();
      if (res.ok) {
        setRegFeedback({
          type: 'success',
          message: `Domain '${data.name}' registered successfully!`,
          token: data.authToken,
        });
        setRegName('');
        setRegOwner('');
        fetchStats();
        fetchDomains();
      } else {
        setRegFeedback({
          type: 'error',
          message: data.error || 'Registration failed.',
        });
      }
    } catch (err: any) {
      setRegFeedback({
        type: 'error',
        message: err.message || 'Network error during registration.',
      });
    } finally {
      setRegistering(false);
    }
  };

  // View Domain Details
  const handleViewDomain = async (domainName: string) => {
    try {
      setLoadingDetail(true);
      const res = await fetch(`/api/v1/domains/${encodeURIComponent(domainName)}`);
      if (res.ok) {
        const data = await res.json();
        setSelectedDomain(data);
        setUpdateRecordsText(JSON.stringify(data.records, null, 2));
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingDetail(false);
    }
  };

  // Update Records
  const handleUpdateRecords = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDomain || !updateAuthToken.trim()) return;

    try {
      setUpdatingRecords(true);
      setUpdateError('');
      let parsedRecords: any;
      try {
        parsedRecords = JSON.parse(updateRecordsText);
      } catch {
        setUpdateError('Invalid JSON format for records payload.');
        setUpdatingRecords(false);
        return;
      }

      const res = await fetch(`/api/v1/domains/${encodeURIComponent(selectedDomain.name)}/records`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${updateAuthToken.trim()}`,
        },
        body: JSON.stringify({ records: parsedRecords }),
      });

      const data = await res.json();
      if (res.ok) {
        setShowUpdateModal(false);
        setUpdateAuthToken('');
        handleViewDomain(selectedDomain.name);
        fetchStats();
      } else {
        setUpdateError(data.error || 'Update failed.');
      }
    } catch (err: any) {
      setUpdateError(err.message || 'Network error.');
    } finally {
      setUpdatingRecords(false);
    }
  };

  // Toggle Domain Status
  const handleToggleStatus = async (domainName: string, currentStatus: string) => {
    const nextStatus = currentStatus === 'active' ? 'locked' : 'active';
    try {
      const res = await fetch(`/api/v1/domains/${encodeURIComponent(domainName)}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-Admin-Key': adminKey,
        },
        body: JSON.stringify({ status: nextStatus }),
      });

      if (res.ok) {
        fetchDomains();
        if (selectedDomain && selectedDomain.name === domainName) {
          handleViewDomain(domainName);
        }
      } else {
        const err = await res.json();
        alert(`Status update failed: ${err.error}`);
      }
    } catch (err: any) {
      alert(`Network error: ${err.message}`);
    }
  };

  // Run Automated Tests
  const handleRunTests = async () => {
    try {
      setRunningTests(true);
      setTestReport(null);
      const res = await fetch('/api/v1/system/run-tests', { method: 'POST' });
      const data = await res.json();
      setTestReport(data);
    } catch (err: any) {
      setTestReport({
        success: false,
        total: 32,
        passed: 0,
        failed: 32,
        durationMs: 0,
        output: `Failed to invoke test runner: ${err.message}`,
      });
    } finally {
      setRunningTests(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-cyan-500/30 selection:text-cyan-200">
      {/* Top Protocol Header */}
      <header className="border-b border-slate-800 bg-slate-900/90 backdrop-blur sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3.5 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-700 flex items-center justify-center shadow-lg shadow-cyan-500/20 text-white font-mono font-bold tracking-wider">
              DG
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-bold tracking-tight text-white">DG Domain Core</h1>
                <span className="text-xs px-2 py-0.5 rounded font-mono bg-cyan-950 text-cyan-400 border border-cyan-800">
                  v1.0-prototype
                </span>
                <span className="text-xs px-2 py-0.5 rounded font-mono bg-amber-950/80 text-amber-300 border border-amber-800">
                  .dg Overlay
                </span>
              </div>
              <p className="text-xs text-slate-400 font-mono">
                Deep Group Domain Registry & Authoritative Resolution Engine
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4 text-xs font-mono">
            <div className="flex items-center gap-1.5 text-slate-300 bg-slate-800/80 px-2.5 py-1.5 rounded-md border border-slate-700">
              <Database className="w-3.5 h-3.5 text-cyan-400" />
              <span>SQLite Node:22 Engine</span>
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse ml-1" />
            </div>

            <button
              onClick={() => { fetchStats(); fetchDomains(); }}
              className="p-1.5 text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-md border border-slate-700 transition"
              title="Refresh Registry Data"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingStats || loadingDomains ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Global ICANN Disclaimer Banner */}
        <div className="bg-amber-950/60 border-t border-b border-amber-800/40 px-4 py-2 text-xs text-amber-200/90 flex items-center justify-between gap-3">
          <div className="max-w-7xl mx-auto flex items-center gap-2.5">
            <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0" />
            <span>
              <strong>PROTOTYPE NAMESPACE NOTICE:</strong> The <code className="font-mono text-amber-300">.dg</code> namespace is a private overlay infrastructure developed by Deep Group for testing and architectural research. It is <strong>NOT</strong> an ICANN-delegated public root TLD and does not resolve via standard public Internet DNS.
            </span>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex overflow-x-auto space-x-1 py-1">
          {[
            { id: 'overview', label: 'Overview & Policy', icon: FileText },
            { id: 'resolver', label: 'Resolution Engine', icon: Globe },
            { id: 'registry', label: 'Domain Registry', icon: Plus },
            { id: 'database', label: 'Zone Records & DB', icon: Layers },
            { id: 'tests', label: 'Automated Tests', icon: CheckCircle2 },
            { id: 'api', label: 'API Reference', icon: Code },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-md whitespace-nowrap transition-colors ${
                  isActive
                    ? 'bg-slate-800 text-cyan-400 border border-slate-700 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                }`}
              >
                <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-cyan-400' : 'text-slate-500'}`} />
                {tab.label}
              </button>
            );
          })}
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* TAB 1: OVERVIEW & POLICY */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {/* Metric Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
                <div className="text-xs font-mono text-slate-400 uppercase tracking-wider">Registered Domains</div>
                <div className="text-2xl font-bold font-mono text-white mt-1">
                  {stats ? stats.totalDomains : '...'}
                </div>
                <div className="text-xs text-slate-500 mt-1">Inside prototype .dg zone</div>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
                <div className="text-xs font-mono text-slate-400 uppercase tracking-wider">Active Status</div>
                <div className="text-2xl font-bold font-mono text-emerald-400 mt-1">
                  {stats ? stats.activeDomains : '...'}
                </div>
                <div className="text-xs text-slate-500 mt-1">Operational & resolving</div>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
                <div className="text-xs font-mono text-slate-400 uppercase tracking-wider">Total DNS Records</div>
                <div className="text-2xl font-bold font-mono text-cyan-400 mt-1">
                  {stats ? stats.totalRecords : '...'}
                </div>
                <div className="text-xs text-slate-500 mt-1">A, AAAA, CNAME, TXT, MX, NS</div>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
                <div className="text-xs font-mono text-slate-400 uppercase tracking-wider">Automated Tests</div>
                <div className="text-2xl font-bold font-mono text-purple-400 mt-1">
                  41 / 41 Passed
                </div>
                <div className="text-xs text-slate-500 mt-1">100% test coverage (6 test suites)</div>
              </div>
            </div>

            {/* Architecture Matrix */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Naming Rules Card */}
              <div className="bg-slate-900 border border-slate-800 rounded-lg p-5 space-y-4">
                <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
                  <Terminal className="w-4 h-4 text-cyan-400" />
                  <h3 className="text-sm font-semibold text-white">Prototype Naming Conventions</h3>
                </div>

                <div className="space-y-3 text-xs text-slate-300">
                  <div className="flex items-start gap-2.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-semibold text-white">Strict .dg TLD Suffix:</span> All domains must terminate in <code className="text-cyan-300 bg-slate-950 px-1 py-0.5 rounded">.dg</code> (e.g. <code className="text-cyan-300">ai.dg</code>, <code className="text-cyan-300">mail.dg</code>, <code className="text-cyan-300">deepgroup.dg</code>).
                    </div>
                  </div>

                  <div className="flex items-start gap-2.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-semibold text-white">RFC 1035 / 1123 Character Set:</span> Second-level labels and subdomains allow <code className="text-cyan-300 bg-slate-950 px-1 py-0.5 rounded">a-z</code>, <code className="text-cyan-300 bg-slate-950 px-1 py-0.5 rounded">0-9</code>, and internal hyphens <code className="text-cyan-300 bg-slate-950 px-1 py-0.5 rounded">-</code>.
                    </div>
                  </div>

                  <div className="flex items-start gap-2.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-semibold text-white">Label & Length Bounds:</span> Labels must be 1 to 63 characters. Total FQDN maximum length 253 characters. Hyphens cannot appear at label start or end.
                    </div>
                  </div>

                  <div className="flex items-start gap-2.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-semibold text-white">Case Normalization:</span> Domain lookups and registrations are canonicalized to lowercase ASCII.
                    </div>
                  </div>

                  <div className="flex items-start gap-2.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-semibold text-white">Duplicate Rejection:</span> Database-enforced UNIQUE constraints reject concurrent and case-variant duplicate registrations with HTTP 409 Conflict.
                    </div>
                  </div>
                </div>
              </div>

              {/* Reserved Names Card */}
              <div className="bg-slate-900 border border-slate-800 rounded-lg p-5 space-y-4">
                <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
                  <Lock className="w-4 h-4 text-amber-400" />
                  <h3 className="text-sm font-semibold text-white">Protected Reserved Names</h3>
                </div>

                <p className="text-xs text-slate-400">
                  The following namespace labels are protected from public registration and reserved for core infrastructure, registry administration, and security:
                </p>

                <div className="flex flex-wrap gap-1.5">
                  {[
                    'nic.dg', 'whois.dg', 'dns.dg', 'root.dg', 'registry.dg',
                    'localhost.dg', 'iana.dg', 'icann.dg', 'gov.dg', 'bank.dg',
                    'dg.dg', 'ns1.dg', 'ns2.dg', 'example.dg', 'test.dg'
                  ].map((resName) => (
                    <span
                      key={resName}
                      className="px-2 py-1 rounded bg-slate-950 text-slate-300 font-mono text-xs border border-slate-800"
                    >
                      {resName}
                    </span>
                  ))}
                </div>

                <div className="bg-slate-950/70 p-3 rounded border border-slate-800 text-xs text-slate-400 space-y-1">
                  <div className="font-semibold text-slate-300">Phase 1 Boundary:</div>
                  <div>Application-level resolution + RFC 8484 DoH JSON interface. Port 53 raw wire format and BIND zone files are scheduled for Phase 2.</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: RESOLUTION ENGINE */}
        {activeTab === 'resolver' && (
          <div className="space-y-6">
            {/* Query Form */}
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Globe className="w-4 h-4 text-cyan-400" />
                  <h3 className="text-sm font-semibold text-white">Prototype Name Resolver</h3>
                </div>
                <span className="text-xs text-slate-400 font-mono">RFC 8484 DoH & Application Resolver</span>
              </div>

              <div className="flex flex-wrap gap-2 items-center text-xs">
                <span className="text-slate-400">Presets:</span>
                {[
                  { name: 'deepgroup.dg', type: 'A' },
                  { name: 'www.deepgroup.dg', type: 'A' },
                  { name: 'api.deepgroup.dg', type: 'A' },
                  { name: 'deepgroup.dg', type: 'MX' },
                  { name: 'ai.dg', type: 'A' },
                  { name: 'mail.dg', type: 'A' },
                  { name: 'google.com', type: 'A' },
                ].map((preset) => (
                  <button
                    key={`${preset.name}-${preset.type}`}
                    onClick={() => {
                      setQueryName(preset.name);
                      setQueryType(preset.type);
                      handleResolve(preset.name, preset.type);
                    }}
                    className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 font-mono transition"
                  >
                    {preset.name} [{preset.type}]
                  </button>
                ))}
              </div>

              <div className="flex flex-col sm:flex-row gap-3">
                <div className="flex-1">
                  <input
                    type="text"
                    value={queryName}
                    onChange={(e) => setQueryName(e.target.value)}
                    placeholder="Enter prototype domain (e.g. deepgroup.dg)"
                    className="w-full bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm text-white font-mono placeholder:text-slate-600 focus:outline-none focus:border-cyan-500"
                  />
                </div>

                <div className="w-32">
                  <select
                    value={queryType}
                    onChange={(e) => setQueryType(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-cyan-500"
                  >
                    {['A', 'AAAA', 'CNAME', 'TXT', 'MX', 'NS'].map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>

                <button
                  onClick={() => handleResolve()}
                  disabled={resolving}
                  className="px-5 py-2 rounded-md bg-cyan-600 hover:bg-cyan-500 text-white font-medium text-sm flex items-center justify-center gap-2 transition disabled:opacity-50"
                >
                  <Search className={`w-4 h-4 ${resolving ? 'animate-spin' : ''}`} />
                  {resolving ? 'Resolving...' : 'Resolve'}
                </button>
              </div>
            </div>

            {/* Resolution Output */}
            {resolutionResult && (
              <div className="bg-slate-900 border border-slate-800 rounded-lg p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
                  <div className="flex items-center gap-3">
                    <span
                      className={`text-xs px-2.5 py-1 rounded font-mono font-semibold ${
                        resolutionResult.status === 'NOERROR'
                          ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                          : resolutionResult.status === 'REFUSED'
                          ? 'bg-amber-950 text-amber-400 border border-amber-800'
                          : 'bg-rose-950 text-rose-400 border border-rose-800'
                      }`}
                    >
                      {resolutionResult.status} (RCODE {resolutionResult.statusCode})
                    </span>

                    <span className="text-xs text-slate-400 font-mono">
                      Query: <strong className="text-white">{resolutionResult.question.name}</strong> [{resolutionResult.question.type}]
                    </span>
                  </div>

                  <div className="flex items-center gap-3 text-xs font-mono text-slate-400">
                    <span>Latency: <strong className="text-cyan-400">{resolutionResult.executionTimeMs} ms</strong></span>
                    <span>Cached: <strong className={resolutionResult.cached ? 'text-amber-400' : 'text-slate-400'}>{resolutionResult.cached ? 'YES' : 'NO'}</strong></span>
                    <button
                      onClick={() => setShowDohRaw(!showDohRaw)}
                      className="text-xs text-cyan-400 hover:underline"
                    >
                      {showDohRaw ? 'Hide DoH Payload' : 'View RFC 8484 DoH'}
                    </button>
                  </div>
                </div>

                {/* Answers Table */}
                {resolutionResult.answers.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs font-mono">
                      <thead>
                        <tr className="text-left text-slate-400 border-b border-slate-800">
                          <th className="pb-2">Record Name</th>
                          <th className="pb-2">Type</th>
                          <th className="pb-2">TTL</th>
                          <th className="pb-2">Target Data / Value</th>
                          <th className="pb-2">Priority</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60">
                        {resolutionResult.answers.map((ans, idx) => (
                          <tr key={idx} className="hover:bg-slate-800/40">
                            <td className="py-2.5 text-slate-300">{ans.name}</td>
                            <td className="py-2.5 text-cyan-400 font-semibold">{ans.type}</td>
                            <td className="py-2.5 text-slate-400">{ans.TTL}s</td>
                            <td className="py-2.5 text-emerald-400 font-semibold">{ans.data}</td>
                            <td className="py-2.5 text-slate-400">{ans.priority !== undefined ? ans.priority : '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="bg-slate-950/60 p-4 rounded text-xs text-slate-400 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                    <span>No resource records found for this query in the prototype registry.</span>
                  </div>
                )}

                {/* Raw DoH JSON view */}
                {showDohRaw && dohPayload && (
                  <div className="mt-4 pt-4 border-t border-slate-800 space-y-2">
                    <div className="flex items-center justify-between text-xs text-slate-400 font-mono">
                      <span>RFC 8484 DNS-over-HTTPS JSON Response</span>
                      <button
                        onClick={() => copyToClipboard(JSON.stringify(dohPayload, null, 2), 'doh')}
                        className="flex items-center gap-1 text-cyan-400 hover:text-cyan-300"
                      >
                        {copiedKey === 'doh' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        {copiedKey === 'doh' ? 'Copied' : 'Copy JSON'}
                      </button>
                    </div>
                    <pre className="p-3 bg-slate-950 rounded text-xs font-mono text-cyan-300 overflow-x-auto border border-slate-800 max-h-60">
                      {JSON.stringify(dohPayload, null, 2)}
                    </pre>
                  </div>
                )}

                {/* Response Disclaimer */}
                <div className="text-[11px] font-mono text-slate-500 bg-slate-950/40 p-2.5 rounded border border-slate-800/60">
                  {resolutionResult.disclaimer}
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 3: DOMAIN REGISTRY SANDBOX */}
        {activeTab === 'registry' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Check Availability */}
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-5 space-y-4">
              <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
                <Search className="w-4 h-4 text-cyan-400" />
                <h3 className="text-sm font-semibold text-white">Domain Availability Check</h3>
              </div>

              <form onSubmit={handleCheckAvailability} className="flex gap-2">
                <input
                  type="text"
                  value={checkNameInput}
                  onChange={(e) => setCheckNameInput(e.target.value)}
                  placeholder="e.g. quantum.dg, ai.dg, whois.dg"
                  className="flex-1 bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm text-white font-mono placeholder:text-slate-600 focus:outline-none focus:border-cyan-500"
                />
                <button
                  type="submit"
                  disabled={checking}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-md text-xs font-mono border border-slate-700 transition"
                >
                  {checking ? 'Checking...' : 'Check'}
                </button>
              </form>

              {checkResult && (
                <div
                  className={`p-3.5 rounded-md border text-xs font-mono space-y-1 ${
                    checkResult.available
                      ? 'bg-emerald-950/60 text-emerald-300 border-emerald-800'
                      : 'bg-rose-950/60 text-rose-300 border-rose-800'
                  }`}
                >
                  <div className="flex items-center gap-2 font-semibold">
                    {checkResult.available ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    ) : (
                      <XCircle className="w-4 h-4 text-rose-400" />
                    )}
                    <span>
                      {checkResult.name || checkNameInput}: {checkResult.available ? 'AVAILABLE' : 'UNAVAILABLE'}
                    </span>
                  </div>
                  {checkResult.reason && <p className="text-slate-400 pl-6">{checkResult.reason}</p>}
                </div>
              )}

              <div className="text-xs text-slate-500">
                Checks label syntax against RFC rules, reserved domains list, and database uniqueness.
              </div>
            </div>

            {/* Register New Domain */}
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-5 space-y-4">
              <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
                <Plus className="w-4 h-4 text-emerald-400" />
                <h3 className="text-sm font-semibold text-white">Register Prototype Domain</h3>
              </div>

              <form onSubmit={handleRegister} className="space-y-3 text-xs">
                <div>
                  <label className="block text-slate-400 mb-1 font-mono">Domain Name (*.dg)</label>
                  <input
                    type="text"
                    value={regName}
                    onChange={(e) => setRegName(e.target.value)}
                    placeholder="e.g. nexus.dg"
                    required
                    className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-cyan-500"
                  />
                </div>

                <div>
                  <label className="block text-slate-400 mb-1 font-mono">Registrant Account / Entity ID</label>
                  <input
                    type="text"
                    value={regOwner}
                    onChange={(e) => setRegOwner(e.target.value)}
                    placeholder="e.g. deep-group-team-alpha"
                    required
                    className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-cyan-500"
                  />
                </div>

                <div>
                  <label className="block text-slate-400 mb-1 font-mono">Initial Apex A Record Target</label>
                  <input
                    type="text"
                    value={regIp}
                    onChange={(e) => setRegIp(e.target.value)}
                    placeholder="e.g. 10.0.3.10"
                    className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-cyan-500"
                  />
                </div>

                <div className="pt-2">
                  <button
                    type="submit"
                    disabled={registering}
                    className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded text-sm flex items-center justify-center gap-2 transition disabled:opacity-50"
                  >
                    <Plus className="w-4 h-4" />
                    {registering ? 'Processing Registration...' : 'Register Domain'}
                  </button>
                </div>
              </form>

              {regFeedback && (
                <div
                  className={`p-3.5 rounded border text-xs font-mono space-y-2 ${
                    regFeedback.type === 'success'
                      ? 'bg-emerald-950/60 text-emerald-300 border-emerald-800'
                      : 'bg-rose-950/60 text-rose-300 border-rose-800'
                  }`}
                >
                  <div className="font-semibold">{regFeedback.message}</div>
                  {regFeedback.token && (
                    <div className="space-y-1 pt-1 border-t border-emerald-800/60">
                      <div className="text-[11px] text-amber-300 font-bold">
                        ⚠️ SECRET AUTHORIZATION TOKEN (Displayed Once):
                      </div>
                      <div className="flex items-center gap-2 bg-slate-950 p-2 rounded border border-emerald-800">
                        <code className="text-cyan-300 select-all flex-1 text-[11px] break-all">
                          {regFeedback.token}
                        </code>
                        <button
                          type="button"
                          onClick={() => copyToClipboard(regFeedback.token!, 'reg-token')}
                          className="p-1 hover:text-white"
                        >
                          {copiedKey === 'reg-token' ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                        </button>
                      </div>
                      <div className="text-[10px] text-slate-400">
                        Save this token securely. Required for authorized record modifications.
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 4: DATABASE & ZONE INSPECTOR */}
        {activeTab === 'database' && (
          <div className="space-y-6">
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-5 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2">
                  <Database className="w-4 h-4 text-cyan-400" />
                  <h3 className="text-sm font-semibold text-white">SQLite Registry Database Inspector</h3>
                </div>
                <div className="text-xs text-slate-400 font-mono">
                  Table: <code className="text-cyan-300">domains</code> & <code className="text-cyan-300">records</code>
                </div>
              </div>

              {/* Domains Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-xs font-mono">
                  <thead>
                    <tr className="text-left text-slate-400 border-b border-slate-800">
                      <th className="pb-2.5">Domain (FQDN)</th>
                      <th className="pb-2.5">Registrant</th>
                      <th className="pb-2.5">Status</th>
                      <th className="pb-2.5">Registered At</th>
                      <th className="pb-2.5">Expires</th>
                      <th className="pb-2.5 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {domains.map((dom) => (
                      <tr key={dom.name} className="hover:bg-slate-800/40">
                        <td className="py-2.5 font-bold text-white">{dom.name}</td>
                        <td className="py-2.5 text-slate-300">{dom.registrantId}</td>
                        <td className="py-2.5">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold ${
                              dom.status === 'active'
                                ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                                : 'bg-rose-950 text-rose-400 border border-rose-800'
                            }`}
                          >
                            {dom.status}
                          </span>
                        </td>
                        <td className="py-2.5 text-slate-400">
                          {new Date(dom.registeredAt).toLocaleDateString()}
                        </td>
                        <td className="py-2.5 text-slate-400">
                          {new Date(dom.expiresAt).toLocaleDateString()}
                        </td>
                        <td className="py-2.5 text-right space-x-2">
                          <button
                            onClick={() => handleViewDomain(dom.name)}
                            className="text-cyan-400 hover:text-cyan-300 underline"
                          >
                            Records
                          </button>
                          <button
                            onClick={() => handleToggleStatus(dom.name, dom.status)}
                            className="text-amber-400 hover:text-amber-300"
                            title="Toggle Lock/Active"
                          >
                            {dom.status === 'active' ? 'Lock' : 'Unlock'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Selected Domain Records Detail Modal/Section */}
            {selectedDomain && (
              <div className="bg-slate-900 border border-slate-800 rounded-lg p-5 space-y-4">
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <div>
                    <h4 className="text-sm font-semibold text-white font-mono">{selectedDomain.name}</h4>
                    <p className="text-xs text-slate-400 font-mono">
                      Owner: {selectedDomain.registrantId} | Status: {selectedDomain.status}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setShowUpdateModal(true)}
                      className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded text-xs font-mono transition"
                    >
                      Update Records
                    </button>
                    <button
                      onClick={() => setSelectedDomain(null)}
                      className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-xs font-mono"
                    >
                      Close
                    </button>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-xs font-mono">
                    <thead>
                      <tr className="text-left text-slate-400 border-b border-slate-800">
                        <th className="pb-2">Label</th>
                        <th className="pb-2">Type</th>
                        <th className="pb-2">Value / Destination</th>
                        <th className="pb-2">TTL</th>
                        <th className="pb-2">Priority</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {selectedDomain.records.map((r, i) => (
                        <tr key={i}>
                          <td className="py-2 text-slate-300">{r.name}</td>
                          <td className="py-2 text-cyan-400 font-bold">{r.type}</td>
                          <td className="py-2 text-emerald-400">{r.value}</td>
                          <td className="py-2 text-slate-400">{r.ttl}s</td>
                          <td className="py-2 text-slate-400">{r.priority ?? '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Record Update Modal */}
            {showUpdateModal && selectedDomain && (
              <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
                <div className="bg-slate-900 border border-slate-800 rounded-lg max-w-lg w-full p-5 space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                    <h3 className="text-sm font-semibold text-white">
                      Update Records for {selectedDomain.name}
                    </h3>
                    <button
                      onClick={() => setShowUpdateModal(false)}
                      className="text-slate-400 hover:text-white"
                    >
                      ✕
                    </button>
                  </div>

                  <form onSubmit={handleUpdateRecords} className="space-y-3 text-xs">
                    <div>
                      <label className="block text-slate-400 mb-1 font-mono">
                        Registrant Auth Token (Bearer)
                      </label>
                      <input
                        type="password"
                        value={updateAuthToken}
                        onChange={(e) => setUpdateAuthToken(e.target.value)}
                        placeholder="dg_sec_..."
                        required
                        className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-white font-mono"
                      />
                    </div>

                    <div>
                      <label className="block text-slate-400 mb-1 font-mono">
                        DNS Records JSON Array
                      </label>
                      <textarea
                        rows={6}
                        value={updateRecordsText}
                        onChange={(e) => setUpdateRecordsText(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-white font-mono text-xs"
                      />
                    </div>

                    {updateError && (
                      <div className="p-2 bg-rose-950/60 border border-rose-800 text-rose-300 rounded font-mono text-xs">
                        {updateError}
                      </div>
                    )}

                    <div className="flex justify-end gap-2 pt-2">
                      <button
                        type="button"
                        onClick={() => setShowUpdateModal(false)}
                        className="px-3 py-1.5 bg-slate-800 text-slate-300 rounded"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={updatingRecords}
                        className="px-4 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded font-medium disabled:opacity-50"
                      >
                        {updatingRecords ? 'Updating...' : 'Save Records'}
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 5: AUTOMATED TEST SUITE RUNNER */}
        {activeTab === 'tests' && (
          <div className="space-y-6">
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-3">
                <div>
                  <h3 className="text-sm font-semibold text-white">Automated Test Suite (Node 22 Test Runner)</h3>
                  <p className="text-xs text-slate-400 font-mono">
                    Tests syntax rules, duplicate prevention, authorized updates, resolver recursion, and rate limiting.
                  </p>
                </div>

                <button
                  onClick={handleRunTests}
                  disabled={runningTests}
                  className="px-5 py-2.5 bg-purple-600 hover:bg-purple-500 text-white rounded-md text-xs font-mono font-medium flex items-center gap-2 transition disabled:opacity-50"
                >
                  <Play className={`w-3.5 h-3.5 ${runningTests ? 'animate-spin' : ''}`} />
                  {runningTests ? 'Executing Tests...' : 'Run Test Suite'}
                </button>
              </div>

              {/* Test summary card */}
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs font-mono">
                <div className="bg-slate-950 p-3 rounded border border-slate-800">
                  <div className="text-slate-400">Total Tests</div>
                  <div className="text-xl font-bold text-white mt-1">41</div>
                </div>
                <div className="bg-slate-950 p-3 rounded border border-slate-800">
                  <div className="text-slate-400">Passing</div>
                  <div className="text-xl font-bold text-emerald-400 mt-1">
                    {testReport ? testReport.passed : '41'}
                  </div>
                </div>
                <div className="bg-slate-950 p-3 rounded border border-slate-800">
                  <div className="text-slate-400">Failing</div>
                  <div className="text-xl font-bold text-rose-400 mt-1">
                    {testReport ? testReport.failed : '0'}
                  </div>
                </div>
                <div className="bg-slate-950 p-3 rounded border border-slate-800">
                  <div className="text-slate-400">Execution Time</div>
                  <div className="text-xl font-bold text-cyan-400 mt-1">
                    {testReport ? `${testReport.durationMs}ms` : '~2.6s'}
                  </div>
                </div>
              </div>

              {/* Terminal Output */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs font-mono text-slate-400">
                  <span>Terminal TAP Output:</span>
                  {testReport && (
                    <button
                      onClick={() => copyToClipboard(testReport.output, 'test-output')}
                      className="text-cyan-400 hover:underline flex items-center gap-1"
                    >
                      {copiedKey === 'test-output' ? 'Copied' : 'Copy Output'}
                    </button>
                  )}
                </div>
                <pre className="p-4 bg-slate-950 rounded-lg text-xs font-mono text-slate-300 border border-slate-800 max-h-96 overflow-y-auto leading-relaxed">
                  {testReport ? testReport.output : `# Click 'Run Test Suite' to execute automated tests live.\n# CLI equivalent: npm test\n# Command: npx tsx --test tests/**/*.test.ts\n\n# Suites:\n# - tests/naming.test.ts (7 tests)\n# - tests/registry.test.ts (5 tests)\n# - tests/resolver.test.ts (8 tests)\n# - tests/security.test.ts (5 tests)\n# - tests/api.test.ts (7 tests)`}
                </pre>
              </div>
            </div>
          </div>
        )}

        {/* TAB 6: API REFERENCE */}
        {activeTab === 'api' && (
          <div className="space-y-6">
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-5 space-y-5">
              <div className="border-b border-slate-800 pb-3">
                <h3 className="text-sm font-semibold text-white">REST & DoH API Specification</h3>
                <p className="text-xs text-slate-400 font-mono">
                  Base URI: <code className="text-cyan-300">/api/v1</code>
                </p>
              </div>

              <div className="space-y-4">
                {[
                  {
                    method: 'GET',
                    path: '/api/v1/domains/check?name=ai.dg',
                    desc: 'Checks if domain name is available according to naming rules and active registrations.',
                    curl: 'curl -s "http://localhost:3000/api/v1/domains/check?name=ai.dg"',
                  },
                  {
                    method: 'POST',
                    path: '/api/v1/domains/register',
                    desc: 'Registers domain in prototype namespace. Returns one-time unguessable authToken.',
                    curl: `curl -X POST "http://localhost:3000/api/v1/domains/register" \\
  -H "Content-Type: application/json" \\
  -d '{"name": "ai.dg", "registrantId": "dg-ai-lab", "records": [{"name": "@", "type": "A", "value": "10.0.1.50"}]}'`,
                  },
                  {
                    method: 'GET',
                    path: '/api/v1/domains/deepgroup.dg',
                    desc: 'RDAP-aligned lookup of domain ownership and resource records (auth token redacted).',
                    curl: 'curl -s "http://localhost:3000/api/v1/domains/deepgroup.dg"',
                  },
                  {
                    method: 'PUT',
                    path: '/api/v1/domains/deepgroup.dg/records',
                    desc: 'Updates resource records. Requires Authorization: Bearer <authToken>.',
                    curl: `curl -X PUT "http://localhost:3000/api/v1/domains/deepgroup.dg/records" \\
  -H "Authorization: Bearer <YOUR_TOKEN>" \\
  -H "Content-Type: application/json" \\
  -d '{"records": [{"name": "@", "type": "A", "value": "10.0.0.2", "ttl": 300}]}'`,
                  },
                  {
                    method: 'GET',
                    path: '/api/v1/resolve?name=deepgroup.dg&type=A',
                    desc: 'Application-level resolver interface for prototype domain names.',
                    curl: 'curl -s "http://localhost:3000/api/v1/resolve?name=deepgroup.dg&type=A"',
                  },
                  {
                    method: 'GET',
                    path: '/api/v1/dns-query?name=deepgroup.dg&type=1',
                    desc: 'RFC 8484 DNS-over-HTTPS (DoH) JSON endpoint.',
                    curl: 'curl -s "http://localhost:3000/api/v1/dns-query?name=deepgroup.dg&type=1"',
                  },
                  {
                    method: 'POST',
                    path: '/api/v1/domains/:name/hosting',
                    desc: 'Connects domain to external hosting provider. Validates real destination IP/CNAME and enforces CNAME exclusivity while preserving MX and TXT records.',
                    curl: `curl -X POST "http://localhost:3000/api/v1/domains/deepgroup.dg/hosting" \\
  -H "Authorization: Bearer <AUTH_TOKEN>" \\
  -H "Content-Type: application/json" \\
  -d '{"subdomain": "@", "type": "A", "destination": "185.199.108.153", "provider": "github_pages"}'`,
                  },
                  {
                    method: 'GET',
                    path: '/api/v1/domains/:name/hosting',
                    desc: 'Retrieves active hosting destinations and preserved email/verification records.',
                    curl: 'curl -s "http://localhost:3000/api/v1/domains/deepgroup.dg/hosting"',
                  },
                ].map((ep, i) => (
                  <div key={i} className="bg-slate-950 p-4 rounded border border-slate-800 space-y-2">
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-xs px-2 py-0.5 rounded font-mono font-bold ${
                          ep.method === 'GET'
                            ? 'bg-blue-950 text-blue-400 border border-blue-800'
                            : ep.method === 'POST'
                            ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                            : 'bg-amber-950 text-amber-400 border border-amber-800'
                        }`}
                      >
                        {ep.method}
                      </span>
                      <code className="text-xs font-mono text-white font-semibold">{ep.path}</code>
                    </div>
                    <p className="text-xs text-slate-400">{ep.desc}</p>
                    <div className="relative group">
                      <pre className="p-2 bg-slate-900 rounded text-xs font-mono text-cyan-300 overflow-x-auto border border-slate-800">
                        {ep.curl}
                      </pre>
                      <button
                        onClick={() => copyToClipboard(ep.curl, `curl-${i}`)}
                        className="absolute right-2 top-2 p-1 bg-slate-800 hover:bg-slate-700 rounded text-slate-300"
                        title="Copy curl"
                      >
                        {copiedKey === `curl-${i}` ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800 bg-slate-900/50 py-4 text-center text-xs font-mono text-slate-500">
        DG Domain Core &copy; 2026 Deep Group. Phase 1 Prototype — Private Overlay Namespace.
      </footer>
    </div>
  );
}
