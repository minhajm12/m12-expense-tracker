'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { toast } from '@/components/ui/toast';
import {
  ShieldCheck,
  ShieldAlert,
  Search,
  RefreshCw,
  KeyRound,
  Database,
  Mail,
  Activity,
  Layers,
  Users as UsersIcon,
  CheckCircle2,
  FileText,
  Clock,
  Server,
  Wallet,
  CreditCard,
  TrendingUp,
  Coins,
  Building2,
  Calendar,
  Lock,
} from 'lucide-react';
import { UserProfile, UserRole } from '@finora/shared';

interface ModuleItem {
  id: string;
  name: string;
  status: string;
  description: string;
  recordCount: number;
  unit: string;
}

interface FeatureStatusData {
  systemHealth: {
    status: string;
    database: string;
    databaseHost: string;
    uptimeSeconds: number;
    emailServiceConfigured: boolean;
    nodeVersion: string;
    timestamp: string;
  };
  userStatistics: {
    totalUsers: number;
    activeUsers: number;
    inactiveUsers: number;
    adminUsers: number;
  };
  modules: ModuleItem[];
}

export default function AdminPage() {
  const { user, isAdmin, isAuthenticated, isLoading, refreshUser } = useAuth();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);

  // Feature Status & Audit Logs State
  const [featureStatus, setFeatureStatus] = useState<FeatureStatusData | null>(null);
  const [loadingFeatures, setLoadingFeatures] = useState(false);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [activeTab, setActiveTab] = useState<'modules' | 'users' | 'audit'>('modules');

  // Bootstrap Flow States
  const [isBootstrapOpen, setIsBootstrapOpen] = useState(false);
  const [checkingBootstrap, setCheckingBootstrap] = useState(true);
  const [bootstrapping, setBootstrapping] = useState(false);

  const getApiUrl = () => process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

  useEffect(() => {
    const checkBootstrap = async () => {
      try {
        const res = await fetch(`${getApiUrl()}/api/v1/admin/bootstrap-status`);
        const json = await res.json();
        if (json.success && json.data) {
          setIsBootstrapOpen(Boolean(json.data.isBootstrapOpen));
        }
      } catch {
        // Ignored
      } finally {
        setCheckingBootstrap(false);
      }
    };

    if (!isAdmin) {
      checkBootstrap();
    } else {
      setCheckingBootstrap(false);
    }
  }, [isAdmin]);

  const fetchUsers = async () => {
    setLoadingUsers(true);
    try {
      const res = await fetch(`${getApiUrl()}/api/v1/admin/users?search=${encodeURIComponent(searchTerm)}`, {
        credentials: 'include',
      });
      const json = await res.json();
      if (res.ok && json.success) {
        setUsers(json.data || []);
      } else {
        toast.error(json.error?.message || 'Failed to fetch users');
      }
    } catch {
      toast.error('Network error loading users');
    } finally {
      setLoadingUsers(false);
    }
  };

  const fetchFeatureStatus = async () => {
    setLoadingFeatures(true);
    try {
      const res = await fetch(`${getApiUrl()}/api/v1/admin/feature-status`, {
        credentials: 'include',
      });
      const json = await res.json();
      if (res.ok && json.success) {
        setFeatureStatus(json.data);
      }
    } catch {
      // Ignored
    } finally {
      setLoadingFeatures(false);
    }
  };

  const fetchAuditLogs = async () => {
    setLoadingLogs(true);
    try {
      const res = await fetch(`${getApiUrl()}/api/v1/admin/audit-logs?limit=30`, {
        credentials: 'include',
      });
      const json = await res.json();
      if (res.ok && json.success) {
        setAuditLogs(json.data || []);
      }
    } catch {
      // Ignored
    } finally {
      setLoadingLogs(false);
    }
  };

  useEffect(() => {
    if (isAdmin) {
      fetchUsers();
      fetchFeatureStatus();
      fetchAuditLogs();
    }
  }, [isAdmin]);

  const toggleUserStatus = async (targetUser: UserProfile) => {
    setActionLoadingId(targetUser.id);
    try {
      const res = await fetch(`${getApiUrl()}/api/v1/admin/users/${targetUser.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ isActive: !targetUser.isActive }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        toast.success(`User ${targetUser.fullName} has been ${!targetUser.isActive ? 'activated' : 'deactivated'}.`);
        fetchUsers();
        fetchFeatureStatus();
      } else {
        toast.error(json.error?.message || 'Action failed');
      }
    } catch {
      toast.error('Network error updating status');
    } finally {
      setActionLoadingId(null);
    }
  };

  const toggleUserRole = async (targetUser: UserProfile) => {
    setActionLoadingId(targetUser.id);
    const newRole = targetUser.role === UserRole.ADMIN ? UserRole.USER : UserRole.ADMIN;
    try {
      const res = await fetch(`${getApiUrl()}/api/v1/admin/users/${targetUser.id}/role`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ role: newRole }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        toast.success(`User ${targetUser.fullName} role updated to ${newRole}.`);
        fetchUsers();
        fetchFeatureStatus();
      } else {
        toast.error(json.error?.message || 'Failed to update role');
      }
    } catch {
      toast.error('Network error updating role');
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleClaimAdmin = async () => {
    setBootstrapping(true);
    try {
      const res = await fetch(`${getApiUrl()}/api/v1/admin/bootstrap`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: user?.email }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        toast.success('Administrator privileges successfully granted!');
        await refreshUser();
      } else {
        toast.error(json.error?.message || 'Failed to claim administrator privileges');
      }
    } catch {
      toast.error('Network error executing admin bootstrap');
    } finally {
      setBootstrapping(false);
    }
  };

  if (isLoading || checkingBootstrap) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!isAuthenticated || !isAdmin) {
    if (isBootstrapOpen) {
      return (
        <div className="max-w-xl mx-auto p-4 sm:p-8 animate-in fade-in">
          <Card className="border-indigo-500/30 bg-card shadow-lg overflow-hidden">
            <div className="h-1.5 bg-gradient-to-r from-amber-500 via-indigo-500 to-emerald-500" />
            <CardHeader className="text-center pb-3">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-500/10 text-indigo-400 mx-auto mb-2 border border-indigo-500/20">
                <ShieldCheck className="h-8 w-8" />
              </div>
              <CardTitle className="text-xl font-bold">First-Time Administrator Setup</CardTitle>
              <CardDescription className="text-xs">
                No administrator account has been designated yet for this M12 Expense Tracker instance.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-xs text-muted-foreground">
              {isAuthenticated && user ? (
                <div className="space-y-3">
                  <div className="p-4 rounded-xl bg-muted/40 border border-border/80 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-foreground">Current Account:</span>
                      <Badge variant="outline" className="capitalize">{user.role}</Badge>
                    </div>
                    <div className="text-foreground font-medium text-sm">{user.fullName}</div>
                    <div className="text-muted-foreground font-mono">{user.email}</div>
                  </div>

                  <p className="leading-relaxed">
                    You can securely promote this existing account to <strong className="text-foreground">System Administrator</strong>. Your user ID, existing bank accounts, transaction histories, credit cards, and chit fund records will remain completely intact.
                  </p>

                  <Button
                    onClick={handleClaimAdmin}
                    disabled={bootstrapping}
                    className="w-full h-11 bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-xs gap-2"
                  >
                    <ShieldCheck className="h-4 w-4" />
                    <span>{bootstrapping ? 'Claiming Admin...' : `Claim Administrator Privileges for ${user.fullName}`}</span>
                  </Button>
                </div>
              ) : (
                <div className="text-center space-y-3">
                  <p>
                    Please log in with your registered account first to establish administrative control.
                  </p>
                  <Link href="/login">
                    <Button variant="outline" size="sm" className="gap-2">
                      Log In to Claim Admin
                    </Button>
                  </Link>
                </div>
              )}
            </CardContent>
            <CardFooter className="border-t border-border/60 bg-muted/20 py-3 text-[11px] text-muted-foreground flex items-center justify-center gap-1.5">
              <KeyRound className="h-3.5 w-3.5" />
              Once claimed, the initial bootstrap procedure permanently closes.
            </CardFooter>
          </Card>
        </div>
      );
    }

    return (
      <div className="flex flex-col items-center justify-center p-12 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-destructive/10 text-destructive mb-4">
          <ShieldAlert className="h-8 w-8" />
        </div>
        <h2 className="text-xl font-bold tracking-tight">Administrative Access Required</h2>
        <p className="text-sm text-muted-foreground mt-2 max-w-md">
          This portal is restricted to authorized M12 Expense Tracker system administrators. If you require access, please contact an existing system administrator to promote your account.
        </p>
      </div>
    );
  }

  const systemHealth = featureStatus?.systemHealth;
  const userStats = featureStatus?.userStatistics;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">Administration Control Center</h1>
            <Badge variant="warning">Admin Only</Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            M12 Expense Tracker core system health, 12-module status, user management, and audit logs.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            onClick={() => {
              fetchFeatureStatus();
              fetchUsers();
              fetchAuditLogs();
            }}
            variant="outline"
            size="sm"
            className="gap-2"
          >
            <RefreshCw className={`h-4 w-4 ${loadingFeatures || loadingUsers ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* System Health Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-4 border-border/60 bg-card">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Database Engine</span>
            <Database className="h-4 w-4 text-emerald-500" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-lg font-bold text-foreground">
              {systemHealth?.database === 'connected' ? 'Connected' : 'Connecting...'}
            </span>
            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-600">
              MongoDB
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground mt-1 truncate">
            Host: {systemHealth?.databaseHost || 'Atlas Cluster'}
          </p>
        </Card>

        <Card className="p-4 border-border/60 bg-card">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Email Service (OTP)</span>
            <Mail className="h-4 w-4 text-primary" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-lg font-bold text-foreground">
              {systemHealth?.emailServiceConfigured ? 'Configured' : 'Dev Mock'}
            </span>
            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-primary/10 text-primary">
              Resend
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">
            Verification &amp; Password Reset Delivery
          </p>
        </Card>

        <Card className="p-4 border-border/60 bg-card">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Registered Users</span>
            <UsersIcon className="h-4 w-4 text-blue-500" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-foreground">
              {userStats?.totalUsers || users.length}
            </span>
            <span className="text-xs text-muted-foreground">
              ({userStats?.activeUsers || 0} active, {userStats?.adminUsers || 0} admins)
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">
            Strict Multi-Tenant Ledger Isolation
          </p>
        </Card>

        <Card className="p-4 border-border/60 bg-card">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">System Modules</span>
            <Layers className="h-4 w-4 text-purple-500" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-foreground">12 / 12</span>
            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-600">
              100% Operational
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">
            All accounting and tracking engines online
          </p>
        </Card>
      </div>

      {/* Navigation Tabs */}
      <div className="flex items-center gap-2 border-b border-border pb-2">
        <Button
          variant={activeTab === 'modules' ? 'default' : 'ghost'}
          size="sm"
          onClick={() => setActiveTab('modules')}
          className="gap-2 text-xs h-9 rounded-lg"
        >
          <Layers className="h-4 w-4" />
          <span>Core Modules (12)</span>
        </Button>
        <Button
          variant={activeTab === 'users' ? 'default' : 'ghost'}
          size="sm"
          onClick={() => setActiveTab('users')}
          className="gap-2 text-xs h-9 rounded-lg"
        >
          <UsersIcon className="h-4 w-4" />
          <span>User Accounts ({users.length})</span>
        </Button>
        <Button
          variant={activeTab === 'audit' ? 'default' : 'ghost'}
          size="sm"
          onClick={() => setActiveTab('audit')}
          className="gap-2 text-xs h-9 rounded-lg"
        >
          <FileText className="h-4 w-4" />
          <span>Security Audit Trail ({auditLogs.length})</span>
        </Button>
      </div>

      {/* TAB 1: 12-MODULE OVERVIEW */}
      {activeTab === 'modules' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-semibold text-foreground">M12 Core Application Modules</h3>
              <p className="text-xs text-muted-foreground">
                Live status and ledger records across all 12 platform subsystems
              </p>
            </div>
            <Badge variant="success">All Services Operational</Badge>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {featureStatus?.modules.map((m) => (
              <Card key={m.id} className="p-4 border-border/80 bg-card hover:border-primary/40 transition-colors">
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-1">
                    <h4 className="font-semibold text-sm text-foreground">{m.name}</h4>
                    <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                      {m.description}
                    </p>
                  </div>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 shrink-0">
                    <CheckCircle2 className="h-3 w-3" />
                    <span>ACTIVE</span>
                  </span>
                </div>

                <div className="mt-4 pt-3 border-t border-border/60 flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Data Volume:</span>
                  <span className="font-mono font-semibold text-foreground">
                    {m.recordCount.toLocaleString()} {m.unit}
                  </span>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* TAB 2: USER MANAGEMENT */}
      {activeTab === 'users' && (
        <Card>
          <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4">
            <div>
              <CardTitle>Registered Users</CardTitle>
              <CardDescription>
                Total users: {users.length} (Private financial information remains strictly isolated)
              </CardDescription>
            </div>

            <div className="flex items-center gap-2 max-w-xs w-full">
              <div className="relative w-full">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search email or name..."
                  className="flex h-9 w-full rounded-lg border border-input bg-background pl-8 pr-3 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && fetchUsers()}
                />
              </div>
              <Button size="sm" onClick={fetchUsers} variant="secondary">
                Search
              </Button>
            </div>
          </CardHeader>

          <CardContent>
            {loadingUsers ? (
              <div className="space-y-3">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : users.length === 0 ? (
              <EmptyState
                icon={Search}
                title="No users found"
                description="No user records matched your search query."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-border text-xs font-semibold uppercase tracking-wider text-muted-foreground bg-muted/40">
                      <th className="p-3">User</th>
                      <th className="p-3">Role</th>
                      <th className="p-3">Currency</th>
                      <th className="p-3">Status</th>
                      <th className="p-3">Joined</th>
                      <th className="p-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {users.map((u) => (
                      <tr key={u.id} className="hover:bg-muted/30 transition-colors">
                        <td className="p-3">
                          <p className="font-medium text-foreground">{u.fullName}</p>
                          <p className="text-xs text-muted-foreground">{u.email}</p>
                        </td>
                        <td className="p-3">
                          <Badge variant={u.role === UserRole.ADMIN ? 'warning' : 'secondary'}>
                            {u.role.toUpperCase()}
                          </Badge>
                        </td>
                        <td className="p-3 font-mono text-xs">{u.currency}</td>
                        <td className="p-3">
                          <Badge variant={u.isActive ? 'success' : 'destructive'}>
                            {u.isActive ? 'Active' : 'Deactivated'}
                          </Badge>
                        </td>
                        <td className="p-3 text-xs text-muted-foreground">
                          {new Date(u.createdAt).toLocaleDateString()}
                        </td>
                        <td className="p-3 text-right space-x-2">
                          {u.id !== user?.id && (
                            <>
                              <Button
                                variant="outline"
                                size="sm"
                                className="text-xs h-8"
                                disabled={actionLoadingId === u.id}
                                onClick={() => toggleUserRole(u)}
                              >
                                {u.role === UserRole.ADMIN ? 'Demote' : 'Promote'}
                              </Button>
                              <Button
                                variant={u.isActive ? 'destructive' : 'default'}
                                size="sm"
                                className="text-xs h-8"
                                disabled={actionLoadingId === u.id}
                                onClick={() => toggleUserStatus(u)}
                              >
                                {u.isActive ? 'Deactivate' : 'Activate'}
                              </Button>
                            </>
                          )}
                          {u.id === user?.id && (
                            <span className="text-xs text-muted-foreground italic px-2">Current Session</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* TAB 3: AUDIT TRAIL */}
      {activeTab === 'audit' && (
        <Card>
          <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4">
            <div>
              <CardTitle>Security &amp; Administrative Audit Log</CardTitle>
              <CardDescription>
                Immutable record of administrative actions, role assignments, and authentication activities
              </CardDescription>
            </div>
            <Button onClick={fetchAuditLogs} variant="outline" size="sm" className="gap-2">
              <RefreshCw className={`h-3.5 w-3.5 ${loadingLogs ? 'animate-spin' : ''}`} />
              Refresh Logs
            </Button>
          </CardHeader>

          <CardContent>
            {loadingLogs ? (
              <div className="space-y-3">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : auditLogs.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                No administrative audit records logged yet.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-border font-semibold uppercase tracking-wider text-muted-foreground bg-muted/40">
                      <th className="p-3">Timestamp</th>
                      <th className="p-3">Action</th>
                      <th className="p-3">Admin User ID</th>
                      <th className="p-3">Target User ID</th>
                      <th className="p-3">Details</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {auditLogs.map((log) => (
                      <tr key={log.id} className="hover:bg-muted/30 transition-colors">
                        <td className="p-3 font-mono text-[11px] text-muted-foreground whitespace-nowrap">
                          {new Date(log.createdAt).toLocaleString()}
                        </td>
                        <td className="p-3 font-semibold text-foreground">
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] bg-primary/10 text-primary">
                            {log.action}
                          </span>
                        </td>
                        <td className="p-3 font-mono text-[11px] text-muted-foreground">
                          {log.userId ? log.userId.slice(-8) : 'System'}
                        </td>
                        <td className="p-3 font-mono text-[11px] text-muted-foreground">
                          {log.targetUserId ? log.targetUserId.slice(-8) : '—'}
                        </td>
                        <td className="p-3 text-muted-foreground font-mono text-[11px] max-w-xs truncate">
                          {log.details ? JSON.stringify(log.details) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
