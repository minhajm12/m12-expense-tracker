'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { toast } from '@/components/ui/toast';
import { ShieldCheck, ShieldAlert, UserX, UserCheck, Search, RefreshCw, KeyRound, Sparkles } from 'lucide-react';
import { UserProfile, UserRole } from '@finora/shared';

export default function AdminPage() {
  const { user, isAdmin, isAuthenticated, isLoading, refreshUser } = useAuth();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);

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

  useEffect(() => {
    if (isAdmin) {
      fetchUsers();
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
                    isLoading={bootstrapping}
                    className="w-full h-11 bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-xs gap-2"
                  >
                    <ShieldCheck className="h-4 w-4" />
                    Claim Administrator Privileges for {user.fullName}
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
            Manage user accounts, roles, and review tenant security status
          </p>
        </div>

        <Button onClick={fetchUsers} variant="outline" size="sm" className="gap-2 self-start sm:self-auto">
          <RefreshCw className={`h-4 w-4 ${loadingUsers ? 'animate-spin' : ''}`} />
          Refresh Users
        </Button>
      </div>

      {/* Users Management Card */}
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
                              isLoading={actionLoadingId === u.id}
                              onClick={() => toggleUserRole(u)}
                            >
                              {u.role === UserRole.ADMIN ? 'Demote' : 'Promote'}
                            </Button>
                            <Button
                              variant={u.isActive ? 'destructive' : 'default'}
                              size="sm"
                              className="text-xs h-8"
                              isLoading={actionLoadingId === u.id}
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
    </div>
  );
}
