'use client';

import React, { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth-context';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { toast } from '@/components/ui/toast';
import { DatePicker } from '@/components/ui/date-picker';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  PieChart,
  Plus,
  RefreshCw,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  TrendingDown,
  Calendar,
  Sparkles,
} from 'lucide-react';
import { formatCurrency, DEFAULT_EXPENSE_CATEGORIES } from '@finora/shared';

interface BudgetData {
  id: string;
  category: string;
  limitAmount: number;
  period: 'monthly' | 'custom';
  startDate: string;
  endDate: string;
  spentAmount: number;
  remainingAmount: number;
  percentUsed: number;
  alertThresholdPercent: number;
  isAlertTriggered: boolean;
  isExceeded: boolean;
  isActive: boolean;
}

export default function BudgetsPage() {
  const { user } = useAuth();
  const [budgets, setBudgets] = useState<BudgetData[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Form State
  const now = new Date();
  const defaultStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
  const defaultEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];

  const [category, setCategory] = useState('Food');
  const [limitAmount, setLimitAmount] = useState('10000');
  const [period, setPeriod] = useState<'monthly' | 'custom'>('monthly');
  const [startDate, setStartDate] = useState(defaultStart);
  const [endDate, setEndDate] = useState(defaultEnd);
  const [alertThresholdPercent, setAlertThresholdPercent] = useState('80');

  const getApiUrl = () => process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

  const fetchBudgets = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${getApiUrl()}/api/v1/budgets`, {
        credentials: 'include',
      });
      const json = await res.json();
      if (res.ok && json.success) {
        setBudgets(json.data || []);
      } else {
        toast.error(json.error?.message || 'Failed to load budgets');
      }
    } catch {
      toast.error('Network error loading budgets');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBudgets();
  }, []);

  const handleCreateBudget = async (e: React.FormEvent) => {
    e.preventDefault();
    const limit = parseFloat(limitAmount);
    const threshold = parseInt(alertThresholdPercent, 10);

    if (isNaN(limit) || limit <= 0) {
      toast.error('Budget limit must be greater than 0');
      return;
    }

    if (isNaN(threshold) || threshold < 1 || threshold > 100) {
      toast.error('Alert threshold must be between 1% and 100%');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`${getApiUrl()}/api/v1/budgets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          category,
          limitAmount: limit,
          period,
          startDate: new Date(startDate).toISOString(),
          endDate: new Date(endDate).toISOString(),
          alertThresholdPercent: threshold,
        }),
      });

      const json = await res.json();
      if (res.ok && json.success) {
        toast.success('Budget created successfully');
        setShowAddModal(false);
        fetchBudgets();
      } else {
        toast.error(json.error?.message || 'Failed to create budget');
      }
    } catch {
      toast.error('Network error creating budget');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteBudget = async (id: string, catName: string) => {
    if (!confirm(`Are you sure you want to delete the budget for "${catName}"?`)) return;

    try {
      const res = await fetch(`${getApiUrl()}/api/v1/budgets/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const json = await res.json();
      if (res.ok && json.success) {
        toast.success('Budget deleted');
        setBudgets(budgets.filter((b) => b.id !== id));
      } else {
        toast.error(json.error?.message || 'Failed to delete budget');
      }
    } catch {
      toast.error('Network error deleting budget');
    }
  };

  // Aggregates
  const totalBudgetLimit = budgets.reduce((acc, b) => acc + b.limitAmount, 0);
  const totalBudgetSpent = budgets.reduce((acc, b) => acc + b.spentAmount, 0);
  const totalBudgetRemaining = Math.max(0, totalBudgetLimit - totalBudgetSpent);
  const exceededCount = budgets.filter((b) => b.isExceeded).length;
  const alertCount = budgets.filter((b) => b.isAlertTriggered && !b.isExceeded).length;

  return (
    <div className="space-y-8 max-w-7xl mx-auto pb-12">
      {/* Page Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-2.5">
            <PieChart className="h-8 w-8 text-[#05A100]" />
            Budget Management
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Enforce discipline with server-authoritative progress tracking and automated threshold alerts.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={fetchBudgets} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button size="sm" onClick={() => setShowAddModal(true)} className="bg-emerald-600 hover:bg-emerald-700 text-white">
            <Plus className="h-4 w-4 mr-2" />
            New Budget
          </Button>
        </div>
      </div>

      {/* Aggregate KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-card/70 backdrop-blur-sm border-border">
          <CardContent className="p-5">
            <div className="flex items-center justify-between text-muted-foreground text-xs font-semibold uppercase tracking-wider">
              <span>Total Budget Limit</span>
              <PieChart className="h-4 w-4 text-emerald-500" />
            </div>
            <p className="text-2xl font-bold tracking-tight text-foreground mt-2">
              {formatCurrency(totalBudgetLimit, user?.currency || 'INR')}
            </p>
            <p className="text-xs text-muted-foreground mt-1">{budgets.length} active budget categories</p>
          </CardContent>
        </Card>

        <Card className="bg-card/70 backdrop-blur-sm border-border">
          <CardContent className="p-5">
            <div className="flex items-center justify-between text-muted-foreground text-xs font-semibold uppercase tracking-wider">
              <span>Period Spent</span>
              <TrendingDown className="h-4 w-4 text-rose-500" />
            </div>
            <p className="text-2xl font-bold tracking-tight text-foreground mt-2">
              {formatCurrency(totalBudgetSpent, user?.currency || 'INR')}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {totalBudgetLimit > 0 ? `${((totalBudgetSpent / totalBudgetLimit) * 100).toFixed(1)}% of total limit` : 'No limits defined'}
            </p>
          </CardContent>
        </Card>

        <Card className="bg-card/70 backdrop-blur-sm border-border">
          <CardContent className="p-5">
            <div className="flex items-center justify-between text-muted-foreground text-xs font-semibold uppercase tracking-wider">
              <span>Remaining Limit</span>
              <CheckCircle2 className="h-4 w-4 text-teal-500" />
            </div>
            <p className="text-2xl font-bold tracking-tight text-foreground mt-2">
              {formatCurrency(totalBudgetRemaining, user?.currency || 'INR')}
            </p>
            <p className="text-xs text-muted-foreground mt-1">Across all categories</p>
          </CardContent>
        </Card>

        <Card className="bg-card/70 backdrop-blur-sm border-border">
          <CardContent className="p-5">
            <div className="flex items-center justify-between text-muted-foreground text-xs font-semibold uppercase tracking-wider">
              <span>Health Status</span>
              <AlertTriangle className={`h-4 w-4 ${exceededCount > 0 ? 'text-rose-500' : alertCount > 0 ? 'text-amber-500' : 'text-emerald-500'}`} />
            </div>
            <div className="flex items-center gap-2 mt-2">
              {exceededCount > 0 ? (
                <Badge variant="destructive" className="text-xs font-bold px-2 py-0.5">
                  {exceededCount} Exceeded
                </Badge>
              ) : alertCount > 0 ? (
                <Badge variant="warning" className="text-xs font-bold px-2 py-0.5">
                  {alertCount} Near Limit
                </Badge>
              ) : (
                <Badge variant="success" className="text-xs font-bold px-2 py-0.5">
                  All Under Control
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {exceededCount + alertCount > 0 ? 'Action recommended' : 'Zero budget breaches'}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Budgets Grid */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-48 w-full rounded-xl" />
          ))}
        </div>
      ) : budgets.length === 0 ? (
        <EmptyState
          icon={PieChart}
          title="No Budgets Defined Yet"
          description="Create your first budget to monitor spending against category caps and get proactive threshold notifications."
          actionLabel="Create Your First Budget"
          onAction={() => setShowAddModal(true)}
        />
      ) : (

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {budgets.map((b) => {
            const isRed = b.isExceeded || b.percentUsed >= 100;
            const isYellow = !isRed && b.isAlertTriggered;

            return (
              <Card
                key={b.id}
                className={`relative overflow-hidden border transition-all duration-200 hover:shadow-md ${isRed
                    ? 'border-rose-500/40 bg-rose-500/5'
                    : isYellow
                      ? 'border-amber-500/40 bg-amber-500/5'
                      : 'border-border bg-card'
                  }`}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="font-semibold text-xs capitalize">
                          {b.category}
                        </Badge>
                        {b.isExceeded && (
                          <Badge variant="destructive" className="text-[10px] uppercase font-bold py-0">
                            Exceeded
                          </Badge>
                        )}
                        {!b.isExceeded && b.isAlertTriggered && (
                          <Badge variant="warning" className="text-[10px] uppercase font-bold py-0">
                            Alert ({b.alertThresholdPercent}%)
                          </Badge>
                        )}
                      </div>
                      <CardTitle className="text-xl font-bold tracking-tight text-foreground mt-2">
                        {formatCurrency(b.limitAmount, user?.currency || 'INR')}
                      </CardTitle>
                      <CardDescription className="text-xs text-muted-foreground mt-0.5">
                        {b.period === 'monthly' ? 'Monthly Allocation' : 'Custom Window'}
                      </CardDescription>
                    </div>

                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDeleteBudget(b.id, b.category)}
                      className="text-muted-foreground hover:text-rose-600 h-8 w-8 p-0"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardHeader>

                <CardContent className="space-y-4 pt-1">
                  {/* Progress Bar */}
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-xs font-semibold">
                      <span className="text-muted-foreground">Spent: {formatCurrency(b.spentAmount, user?.currency || 'INR')}</span>
                      <span className={isRed ? 'text-rose-600 font-bold' : isYellow ? 'text-amber-600 font-bold' : 'text-emerald-600'}>
                        {b.percentUsed}%
                      </span>
                    </div>

                    <div className="w-full bg-muted/60 h-2.5 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${isRed
                            ? 'bg-rose-500'
                            : isYellow
                              ? 'bg-amber-500'
                              : 'bg-emerald-500'
                          }`}
                        style={{ width: `${Math.min(100, b.percentUsed)}%` }}
                      />
                    </div>
                  </div>

                  {/* Remaining & Dates Info */}
                  <div className="flex items-center justify-between text-xs pt-2 border-t border-border/50">
                    <div>
                      <p className="text-muted-foreground">Remaining</p>
                      <p className={`font-semibold ${isRed ? 'text-rose-600' : 'text-foreground'}`}>
                        {formatCurrency(b.remainingAmount, user?.currency || 'INR')}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-muted-foreground flex items-center justify-end gap-1">
                        <Calendar className="h-3 w-3" /> Window Ends
                      </p>
                      <p className="font-semibold text-foreground">
                        {new Date(b.endDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Add Budget Modal */}
      <Dialog open={showAddModal} onOpenChange={setShowAddModal}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-emerald-500" />
              Define New Budget
            </DialogTitle>
            <DialogDescription>
              Track category expenses against a hard limit with automated notifications.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreateBudget} className="space-y-4">
            <div>
              <label className="text-xs font-semibold text-foreground block mb-1">
                Category
              </label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Overall Budget (All Categories)</SelectItem>
                  {DEFAULT_EXPENSE_CATEGORIES.map((c) => (
                    <SelectItem key={c.name} value={c.name}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-semibold text-foreground block mb-1">
                  Budget Limit ({user?.currency || 'INR'})
                </label>
                <Input
                  type="number"
                  min="1"
                  step="any"
                  value={limitAmount}
                  onChange={(e) => setLimitAmount(e.target.value)}
                  required
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-foreground block mb-1">
                  Alert Threshold (%)
                </label>
                <Input
                  type="number"
                  min="1"
                  max="100"
                  value={alertThresholdPercent}
                  onChange={(e) => setAlertThresholdPercent(e.target.value)}
                  required
                />
                <p className="text-[11px] text-muted-foreground mt-0.5">Triggers warning when reached</p>
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-foreground block mb-1">
                Period Type
              </label>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant={period === 'monthly' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setPeriod('monthly')}
                >
                  Current Month
                </Button>
                <Button
                  type="button"
                  variant={period === 'custom' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setPeriod('custom')}
                >
                  Custom Date Range
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-semibold text-foreground block mb-1">
                  Start Date
                </label>
                <DatePicker
                  value={startDate}
                  onChange={setStartDate}
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-foreground block mb-1">
                  End Date
                </label>
                <DatePicker
                  value={endDate}
                  onChange={setEndDate}
                />
              </div>
            </div>

            <DialogFooter className="pt-4 border-t border-border">
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowAddModal(false)}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={submitting}
                className="bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                {submitting ? 'Creating...' : 'Save Budget'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
