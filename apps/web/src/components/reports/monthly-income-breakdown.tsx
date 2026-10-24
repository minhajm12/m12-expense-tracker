'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import {
  Briefcase,
  Laptop,
  Coins,
  TrendingUp,
  TrendingDown,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Sliders,
  Check,
  CheckCircle2,
  DollarSign,
  Layers,
  ChevronDown,
  ChevronUp,
  Info,
} from 'lucide-react';
import { formatCurrency } from '@finora/shared';
import { useAuth } from '@/lib/auth-context';
import { useDataSync } from '@/lib/data-sync';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';

interface IncomeTransaction {
  id: string;
  title: string;
  amount: number;
  date: string;
  paymentMethod: string;
  merchantOrRecipient?: string;
}

interface CategoryBreakdownItem {
  category: string;
  amount: number;
  transactionCount: number;
  percentage: number;
  isConfigured: boolean;
  transactions?: IncomeTransaction[];
}

interface MonthlyIncomeData {
  month: string;
  monthLabel: string;
  totalMonthlyIncome: number;
  allIncomeTotal: number;
  salaryIncome: number;
  freelanceIncome: number;
  otherSelectedIncome: number;
  qualifyingTransactionCount: number;
  configuredCategories: string[];
  categoryBreakdown: CategoryBreakdownItem[];
  previousMonthComparison?: {
    previousMonth: string;
    previousTotal: number;
    changeAmount: number;
    changePercentage: number | null;
  };
  trend: Array<{
    month: string;
    income: number;
  }>;
}

interface CategoryOption {
  name: string;
  isCustom: boolean;
  isConfigured: boolean;
}

export function MonthlyIncomeBreakdown() {
  const { user } = useAuth();

  const getCurrentMonthKey = () => {
    const d = new Date();
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
    });
    return formatter.format(d);
  };

  const [selectedMonth, setSelectedMonth] = useState<string>(getCurrentMonthKey());
  const [data, setData] = useState<MonthlyIncomeData | null>(null);
  const [loading, setLoading] = useState(true);

  // Settings Modal State
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [availableCategories, setAvailableCategories] = useState<CategoryOption[]>([]);
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set());
  const [savingSettings, setSavingSettings] = useState(false);
  const [loadingSettings, setLoadingSettings] = useState(false);

  // Expanded category transaction inspection
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);

  const getApiUrl = () => process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

  const fetchIncomeReport = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${getApiUrl()}/api/v1/reports/income-summary?month=${selectedMonth}`, {
        credentials: 'include',
      });
      const json = await res.json();
      if (res.ok && json.success) {
        setData(json.data);
      }
    } catch {
      toast.error('Failed to load monthly income summary');
    } finally {
      setLoading(false);
    }
  };

  const fetchCategorySettings = async () => {
    setLoadingSettings(true);
    try {
      const res = await fetch(`${getApiUrl()}/api/v1/reports/income-categories`, {
        credentials: 'include',
      });
      const json = await res.json();
      if (res.ok && json.success) {
        setAvailableCategories(json.data.categories || []);
        setSelectedCategories(new Set(json.data.configuredCategories || []));
      }
    } catch {
      toast.error('Failed to load income category settings');
    } finally {
      setLoadingSettings(false);
    }
  };

  useEffect(() => {
    fetchIncomeReport();
  }, [selectedMonth]);

  useDataSync(fetchIncomeReport, ['transactions']);

  const changeMonth = (offset: number) => {
    const parts = selectedMonth.split('-');
    let year = parseInt(parts[0], 10);
    let month = parseInt(parts[1], 10) + offset;
    if (month > 12) {
      month = 1;
      year += 1;
    } else if (month < 1) {
      month = 12;
      year -= 1;
    }
    setSelectedMonth(`${year}-${String(month).padStart(2, '0')}`);
  };

  const handleToggleCategory = (catName: string) => {
    setSelectedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(catName)) {
        next.delete(catName);
      } else {
        next.add(catName);
      }
      return next;
    });
  };

  const handleSaveCategories = async () => {
    setSavingSettings(true);
    try {
      const res = await fetch(`${getApiUrl()}/api/v1/reports/income-categories`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ categories: Array.from(selectedCategories) }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        toast.success('Income calculation categories updated');
        setShowSettingsModal(false);
        fetchIncomeReport();
      } else {
        toast.error(json.error?.message || 'Failed to save categories');
      }
    } catch {
      toast.error('Network error saving income categories');
    } finally {
      setSavingSettings(false);
    }
  };

  const comparison = data?.previousMonthComparison;
  const hasComparison = comparison && comparison.previousTotal > 0 && comparison.changePercentage !== null;

  return (
    <Card className="border-border/80 bg-card/60 backdrop-blur-sm overflow-hidden">
      <CardHeader className="pb-3 border-b border-border/60">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <CardTitle className="text-lg font-bold text-foreground flex items-center gap-2">
                <Coins className="h-5 w-5 text-emerald-500" />
                Monthly Income Breakdown
              </CardTitle>
              <Badge variant="outline" className="text-[10px] uppercase font-semibold">
                Configurable
              </Badge>
            </div>
            <CardDescription className="text-xs text-muted-foreground mt-0.5">
              Authoritative salary, freelance, and configured category income summary for {data?.monthLabel || selectedMonth}
            </CardDescription>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Month Navigation */}
            <div className="flex items-center gap-1 border border-border/60 rounded-lg p-0.5 bg-muted/20">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => changeMonth(-1)}
                className="h-7 w-7 p-0"
                title="Previous Month"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-xs font-bold font-mono px-2 min-w-[110px] text-center text-foreground">
                {data?.monthLabel || selectedMonth}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => changeMonth(1)}
                className="h-7 w-7 p-0"
                title="Next Month"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>

            {/* Configure Categories Trigger */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                fetchCategorySettings();
                setShowSettingsModal(true);
              }}
              className="h-8 gap-1.5 text-xs font-semibold"
            >
              <Sliders className="h-3.5 w-3.5 text-muted-foreground" />
              Income Categories
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-5 space-y-6">
        {/* Top Metric Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Salary Income */}
          <div className="p-4 rounded-xl border border-border bg-muted/30">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Salary Income
              </span>
              <div className="h-6 w-6 rounded-lg bg-emerald-500/10 text-emerald-500 flex items-center justify-center">
                <Briefcase className="h-3.5 w-3.5" />
              </div>
            </div>
            {loading ? (
              <Skeleton className="h-7 w-24 mt-2" />
            ) : (
              <p className="text-xl font-bold font-mono text-foreground mt-1.5">
                {formatCurrency(data?.salaryIncome || 0, user?.currency || 'INR')}
              </p>
            )}
            <p className="text-[10px] text-muted-foreground mt-0.5">Primary employment</p>
          </div>

          {/* Freelance Income */}
          <div className="p-4 rounded-xl border border-border bg-muted/30">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Freelance Income
              </span>
              <div className="h-6 w-6 rounded-lg bg-cyan-500/10 text-cyan-500 flex items-center justify-center">
                <Laptop className="h-3.5 w-3.5" />
              </div>
            </div>
            {loading ? (
              <Skeleton className="h-7 w-24 mt-2" />
            ) : (
              <p className="text-xl font-bold font-mono text-cyan-600 dark:text-cyan-400 mt-1.5">
                {formatCurrency(data?.freelanceIncome || 0, user?.currency || 'INR')}
              </p>
            )}
            <p className="text-[10px] text-muted-foreground mt-0.5">Contract & side projects</p>
          </div>

          {/* Other Selected Income */}
          <div className="p-4 rounded-xl border border-border bg-muted/30">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Other Configured Income
              </span>
              <div className="h-6 w-6 rounded-lg bg-purple-500/10 text-purple-500 flex items-center justify-center">
                <Layers className="h-3.5 w-3.5" />
              </div>
            </div>
            {loading ? (
              <Skeleton className="h-7 w-24 mt-2" />
            ) : (
              <p className="text-xl font-bold font-mono text-purple-600 dark:text-purple-400 mt-1.5">
                {formatCurrency(data?.otherSelectedIncome || 0, user?.currency || 'INR')}
              </p>
            )}
            <p className="text-[10px] text-muted-foreground mt-0.5">Business, investments, etc.</p>
          </div>

          {/* Total Monthly Income */}
          <div className="p-4 rounded-xl border border-emerald-500/30 bg-emerald-500/5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                Total Monthly Income
              </span>
              <div className="h-6 w-6 rounded-lg bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 flex items-center justify-center font-bold text-xs">
                ₹
              </div>
            </div>
            {loading ? (
              <Skeleton className="h-7 w-28 mt-2" />
            ) : (
              <p className="text-2xl font-black font-mono text-emerald-600 dark:text-emerald-400 mt-1.5">
                {formatCurrency(data?.totalMonthlyIncome || 0, user?.currency || 'INR')}
              </p>
            )}
            <div className="flex items-center gap-1.5 mt-1 text-[10px]">
              {hasComparison ? (
                comparison.changeAmount >= 0 ? (
                  <span className="text-emerald-600 dark:text-emerald-400 font-semibold flex items-center gap-0.5">
                    <TrendingUp className="h-3 w-3" /> +{comparison.changePercentage}% vs prior
                  </span>
                ) : (
                  <span className="text-rose-500 font-semibold flex items-center gap-0.5">
                    <TrendingDown className="h-3 w-3" /> {comparison.changePercentage}% vs prior
                  </span>
                )
              ) : (
                <span className="text-muted-foreground">
                  {data?.qualifyingTransactionCount || 0} qualifying receipts
                </span>
              )}
            </div>
          </div>
        </div>

        {/* 6-Month Income Trend & Category Breakdown Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Trend Chart (2 columns) */}
          <div className="lg:col-span-2 p-4 rounded-xl border border-border bg-card/40">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                6-Month Income Trend (Configured Categories)
              </h4>
              <Badge variant="outline" className="text-[9px]">
                Asia/Kolkata
              </Badge>
            </div>
            {loading ? (
              <Skeleton className="h-48 w-full rounded-lg" />
            ) : data?.trend && data.trend.length > 0 ? (
              <div className="h-48 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.trend} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                    <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} tickFormatter={(val) => `₹${val >= 1000 ? `${val / 1000}k` : val}`} />
                    <Tooltip
                      formatter={(val: any) => [formatCurrency(Number(val) || 0, user?.currency || 'INR'), 'Income']}
                      contentStyle={{ backgroundColor: 'hsl(var(--card))', borderRadius: '8px', border: '1px solid hsl(var(--border))' }}
                    />
                    <Bar dataKey="income" fill="#10b981" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="h-48 flex items-center justify-center text-xs text-muted-foreground">
                No trend data recorded.
              </div>
            )}
          </div>

          {/* Active Configuration Pill Box */}
          <div className="p-4 rounded-xl border border-border bg-card/40 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Active Income Categories
                </h4>
                <span className="text-[10px] text-muted-foreground font-mono">
                  {data?.configuredCategories?.length || 0} active
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground mb-3 leading-relaxed">
                Only completed income transactions in these categories are aggregated into your monthly total:
              </p>
              <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto pr-1">
                {data?.configuredCategories && data.configuredCategories.length > 0 ? (
                  data.configuredCategories.map((c) => (
                    <Badge
                      key={c}
                      variant="outline"
                      className="bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400 text-xs py-0.5 px-2"
                    >
                      <Check className="h-3 w-3 mr-1" />
                      {c}
                    </Badge>
                  ))
                ) : (
                  <p className="text-xs text-amber-500">No categories currently selected.</p>
                )}
              </div>
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                fetchCategorySettings();
                setShowSettingsModal(true);
              }}
              className="mt-4 w-full text-xs font-semibold gap-1.5"
            >
              <Sliders className="h-3.5 w-3.5" />
              Adjust Category Selection
            </Button>
          </div>
        </div>

        {/* Detailed Category Breakdown Table */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold uppercase tracking-wider text-foreground">
              Category Breakdown & Underlying Transactions
            </h4>
            <span className="text-[11px] text-muted-foreground">
              Click a category to inspect recorded transactions
            </span>
          </div>

          {loading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-12 w-full rounded-lg" />
              ))}
            </div>
          ) : !data?.categoryBreakdown || data.categoryBreakdown.length === 0 ? (
            <div className="p-8 text-center border border-dashed rounded-xl border-border text-xs text-muted-foreground">
              No income transactions recorded for {data?.monthLabel || selectedMonth}.
            </div>
          ) : (
            <div className="space-y-2">
              {data.categoryBreakdown.map((item) => {
                const isExpanded = expandedCategory === item.category;
                return (
                  <div
                    key={item.category}
                    className="rounded-xl border border-border bg-card/60 overflow-hidden transition-all"
                  >
                    <div
                      onClick={() => setExpandedCategory(isExpanded ? null : item.category)}
                      className="p-3.5 flex items-center justify-between cursor-pointer hover:bg-muted/30 transition-all select-none"
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex items-center gap-2">
                          <p className="font-bold text-xs text-foreground">{item.category}</p>
                          <Badge
                            variant={item.isConfigured ? 'success' : 'secondary'}
                            className="text-[9px] px-1.5 py-0"
                          >
                            {item.isConfigured ? 'Counts as Income' : 'Excluded from Total'}
                          </Badge>
                        </div>
                        <span className="text-[11px] text-muted-foreground">
                          ({item.transactionCount} transaction{item.transactionCount === 1 ? '' : 's'})
                        </span>
                      </div>

                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <p className="font-mono font-bold text-xs text-foreground">
                            {formatCurrency(item.amount, user?.currency || 'INR')}
                          </p>
                          <p className="text-[10px] text-muted-foreground font-mono">
                            {item.percentage}% of total
                          </p>
                        </div>
                        {isExpanded ? (
                          <ChevronUp className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        )}
                      </div>
                    </div>

                    {/* Underlying Transactions List */}
                    {isExpanded && item.transactions && item.transactions.length > 0 && (
                      <div className="border-t border-border/60 bg-muted/20 p-3 space-y-1.5 animate-in fade-in duration-150">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                          Transactions in {item.category}
                        </p>
                        {item.transactions.map((tx) => (
                          <div
                            key={tx.id}
                            className="flex items-center justify-between py-1.5 px-2.5 rounded-lg bg-card/80 border border-border/60 text-xs"
                          >
                            <div>
                              <p className="font-medium text-foreground">{tx.title}</p>
                              <p className="text-[10px] text-muted-foreground">
                                {new Date(tx.date).toLocaleDateString('en-IN', {
                                  day: '2-digit',
                                  month: 'short',
                                  year: 'numeric',
                                  timeZone: 'Asia/Kolkata',
                                })}{' '}
                                • {tx.paymentMethod.replace('_', ' ').toUpperCase()}
                              </p>
                            </div>
                            <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">
                              +{formatCurrency(tx.amount, user?.currency || 'INR')}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </CardContent>

      {/* Income Calculation Settings Modal */}
      <Dialog open={showSettingsModal} onOpenChange={setShowSettingsModal}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex items-center justify-between">
              <DialogTitle className="text-lg font-bold text-foreground flex items-center gap-2">
                <Sliders className="h-5 w-5 text-emerald-500" />
                <span>Income Calculation Settings</span>
              </DialogTitle>
              <Badge variant="outline" className="text-xs">
                User Preferences
              </Badge>
            </div>
            <DialogDescription className="text-xs text-muted-foreground mt-1 leading-relaxed">
              Choose which income categories should be included in your monthly income calculations and summary reports.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 pt-1">
            {loadingSettings ? (
              <div className="space-y-2">
                {[1, 2, 3, 4].map((i) => (
                  <Skeleton key={i} className="h-10 w-full rounded-lg" />
                ))}
              </div>
            ) : (
              <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                {availableCategories.map((cat) => {
                  const isChecked = selectedCategories.has(cat.name);
                  return (
                    <label
                      key={cat.name}
                      onClick={() => handleToggleCategory(cat.name)}
                      className={`flex items-center justify-between p-3 rounded-xl border text-xs cursor-pointer transition-all ${
                        isChecked
                          ? 'border-emerald-500/50 bg-emerald-500/10 text-foreground'
                          : 'border-border bg-card/60 text-muted-foreground hover:bg-muted/40'
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <div
                          className={`h-4 w-4 rounded flex items-center justify-center border transition-all ${
                            isChecked
                              ? 'bg-emerald-600 border-emerald-600 text-white'
                              : 'border-muted-foreground/40 bg-transparent'
                          }`}
                        >
                          {isChecked && <Check className="h-3 w-3 stroke-[3]" />}
                        </div>
                        <span className="font-semibold">{cat.name}</span>
                        {cat.isCustom && (
                          <Badge variant="outline" className="text-[9px] px-1 py-0">
                            Custom
                          </Badge>
                        )}
                      </div>
                      <span className="text-[10px] text-muted-foreground font-mono">
                        {isChecked ? 'Included' : 'Excluded'}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          <DialogFooter className="flex items-center justify-between sm:justify-between pt-3 border-t border-border/60">
            <span className="text-xs text-muted-foreground font-mono">
              {selectedCategories.size} selected
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowSettingsModal(false)}
                disabled={savingSettings}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleSaveCategories}
                disabled={savingSettings}
                className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                <CheckCircle2 className="h-4 w-4" />
                {savingSettings ? 'Saving...' : 'Save Settings'}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
