'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { useDataSync } from '@/lib/data-sync';
import { authFetch, getApiUrl } from '@/lib/api-client';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  CalendarDays,
  Repeat,
  Landmark,
  CheckCircle,
  Clock,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  ArrowRight,
  Filter,
  DollarSign,
  Play,
  TrendingUp,
  Ban,
} from 'lucide-react';
import {
  formatCurrency,
  UpcomingPaymentForecast,
  UpcomingPaymentItem,
} from '@finora/shared';

export function UpcomingMonthlyPayments() {
  const { user } = useAuth();

  // Month navigation in Asia/Kolkata
  const getCurrentMonthKey = () => {
    const d = new Date();
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
    });
    return formatter.format(d);
  };

  const getNextMonthKey = () => {
    const d = new Date();
    d.setDate(1); // prevent month rollover bug on 31st of month
    d.setMonth(d.getMonth() + 1);
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
    });
    return formatter.format(d);
  };

  const [selectedMonth, setSelectedMonth] = useState<string>(getCurrentMonthKey());
  const [forecast, setForecast] = useState<UpcomingPaymentForecast | null>(null);
  const [loading, setLoading] = useState(true);
  const [filterTab, setFilterTab] = useState<'all' | 'recurring' | 'emi' | 'investment' | 'unpaid' | 'paid'>('all');

  const fetchForecast = async () => {
    setLoading(true);
    try {
      const res = await authFetch(`${getApiUrl()}/api/v1/analytics/upcoming-forecast?month=${selectedMonth}`);
      const json = await res.json();
      if (res.ok && json.success) {
        setForecast(json.data);
      }
    } catch (err) {
      console.warn('Failed to load upcoming forecast:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchForecast();
  }, [selectedMonth]);

  useDataSync(fetchForecast, ['transactions', 'recurring', 'emi', 'investments', 'accounts']);

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

  const formatMonthLabel = (monthKey: string) => {
    const parts = monthKey.split('-');
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10);
    const d = new Date(Date.UTC(year, month - 1, 15));
    return d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  };

  const currentMonthKey = getCurrentMonthKey();
  const nextMonthKey = getNextMonthKey();

  const items = forecast?.items || [];
  const filteredItems = items.filter((item) => {
    if (filterTab === 'recurring') return item.type === 'recurring';
    if (filterTab === 'emi') return item.type === 'emi';
    if (filterTab === 'investment') return item.type === 'investment';
    if (filterTab === 'unpaid') return item.status === 'unpaid';
    if (filterTab === 'paid') return item.status === 'paid';
    return true; // 'all'
  });

  return (
    <Card className="border-border/80 bg-card/60 backdrop-blur-sm overflow-hidden">
      <CardHeader className="pb-3 border-b border-border/60">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <CardTitle className="text-lg font-bold text-foreground flex items-center gap-2">
              <CalendarDays className="h-5 w-5 text-emerald-500" />
              Upcoming Monthly Payments
            </CardTitle>
            <CardDescription className="text-xs text-muted-foreground mt-0.5">
              Track how much you still need to pay this month and plan ahead for next month.
            </CardDescription>
          </div>

          {/* Month Selector Controls */}
          <div className="flex items-center gap-2 self-start sm:self-auto">
            <Button
              variant="outline"
              size="sm"
              onClick={() => changeMonth(-1)}
              className="h-8 w-8 p-0"
              title="Previous Month"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>

            <span className="text-xs font-bold font-mono px-2 min-w-[120px] text-center text-foreground">
              {formatMonthLabel(selectedMonth)}
            </span>

            <Button
              variant="outline"
              size="sm"
              onClick={() => changeMonth(1)}
              className="h-8 w-8 p-0"
              title="Next Month"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>

            <div className="flex items-center gap-1 ml-2">
              <Button
                variant={selectedMonth === currentMonthKey ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSelectedMonth(currentMonthKey)}
                className="h-8 text-xs font-semibold px-2.5"
              >
                Current Month
              </Button>
              <Button
                variant={selectedMonth === nextMonthKey ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSelectedMonth(nextMonthKey)}
                className="h-8 text-xs font-semibold px-2.5"
              >
                Next Month
              </Button>
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-5 space-y-6">
        {/* Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
          {/* Total Expected Payments */}
          <div className="p-3.5 rounded-xl border border-border bg-muted/30">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Total Expected
            </p>
            {loading ? (
              <Skeleton className="h-7 w-20 mt-1.5" />
            ) : (
              <p className="text-xl font-bold font-mono text-foreground mt-1">
                {formatCurrency(forecast?.totalExpectedPayments || 0, user?.currency || 'INR')}
              </p>
            )}
            <p className="text-[10px] text-muted-foreground mt-0.5">Recurring + EMI + Invest</p>
          </div>

          {/* Recurring Payments Remaining */}
          <div className="p-3.5 rounded-xl border border-border bg-muted/30">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Recurring Remaining
            </p>
            {loading ? (
              <Skeleton className="h-7 w-20 mt-1.5" />
            ) : (
              <p className="text-xl font-bold font-mono text-blue-500 mt-1">
                {formatCurrency(forecast?.recurringPaymentsRemaining || 0, user?.currency || 'INR')}
              </p>
            )}
            <p className="text-[10px] text-muted-foreground mt-0.5">Unpaid recurring bills</p>
          </div>

          {/* EMI Payments Remaining */}
          <div className="p-3.5 rounded-xl border border-border bg-muted/30">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              EMI Remaining
            </p>
            {loading ? (
              <Skeleton className="h-7 w-20 mt-1.5" />
            ) : (
              <p className="text-xl font-bold font-mono text-amber-500 mt-1">
                {formatCurrency(forecast?.emiPaymentsRemaining || 0, user?.currency || 'INR')}
              </p>
            )}
            <p className="text-[10px] text-muted-foreground mt-0.5">Unpaid EMI installments</p>
          </div>

          {/* Investment Payments Remaining */}
          <div className="p-3.5 rounded-xl border border-border bg-muted/30">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Investment Remaining
            </p>
            {loading ? (
              <Skeleton className="h-7 w-20 mt-1.5" />
            ) : (
              <p className="text-xl font-bold font-mono text-purple-500 mt-1">
                {formatCurrency(forecast?.investmentPaymentsRemaining || 0, user?.currency || 'INR')}
              </p>
            )}
            <p className="text-[10px] text-muted-foreground mt-0.5">Unpaid SIP / Chits</p>
          </div>

          {/* Total Paid */}
          <div className="p-3.5 rounded-xl border border-border bg-muted/30">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Total Paid
            </p>
            {loading ? (
              <Skeleton className="h-7 w-20 mt-1.5" />
            ) : (
              <p className="text-xl font-bold font-mono text-emerald-500 mt-1">
                {formatCurrency(forecast?.totalPaid || 0, user?.currency || 'INR')}
              </p>
            )}
            <p className="text-[10px] text-muted-foreground mt-0.5">Confirmed actual paid</p>
          </div>

          {/* Remaining Amount Needed */}
          <div className="p-3.5 rounded-xl border border-emerald-500/30 bg-emerald-500/5">
            <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
              Remaining Needed
            </p>
            {loading ? (
              <Skeleton className="h-7 w-20 mt-1.5" />
            ) : (
              <p className="text-xl font-extrabold font-mono text-emerald-600 dark:text-emerald-400 mt-1">
                {formatCurrency(forecast?.remainingAmountNeeded || 0, user?.currency || 'INR')}
              </p>
            )}
            <p className="text-[10px] text-muted-foreground mt-0.5">Still required this month</p>
          </div>
        </div>

        {/* Filter Tabs */}
        <div className="flex items-center gap-1.5 border-b border-border/60 pb-2.5 flex-wrap">
          {[
            { id: 'all', label: 'All Obligations', count: items.length },
            { id: 'unpaid', label: 'Unpaid', count: items.filter((i) => i.status === 'unpaid').length },
            { id: 'paid', label: 'Paid', count: items.filter((i) => i.status === 'paid').length },
            { id: 'recurring', label: 'Recurring', count: items.filter((i) => i.type === 'recurring').length },
            { id: 'emi', label: 'EMI', count: items.filter((i) => i.type === 'emi').length },
            { id: 'investment', label: 'Investments', count: items.filter((i) => i.type === 'investment').length },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setFilterTab(tab.id as any)}
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
                filterTab === tab.id
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:bg-muted/60'
              }`}
            >
              <span>{tab.label}</span>
              <span
                className={`px-1.5 py-0.2 rounded-full text-[10px] ${
                  filterTab === tab.id ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-muted text-muted-foreground'
                }`}
              >
                {tab.count}
              </span>
            </button>
          ))}
        </div>

        {/* Obligations List */}
        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12 w-full rounded-lg" />
            ))}
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="p-6 text-center text-xs text-muted-foreground">
            No payments scheduled for {formatMonthLabel(selectedMonth)} under this filter.
          </div>
        ) : (
          <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
            {filteredItems.map((item) => {
              const isPaid = item.status === 'paid';
              return (
                <div
                  key={`${item.type}-${item.id}`}
                  className={`flex items-center justify-between p-3 rounded-xl border text-xs transition-all ${
                    isPaid ? 'border-emerald-500/25 bg-emerald-500/5' : 'border-border bg-card/60 hover:border-border/80'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${
                        item.type === 'emi'
                          ? 'bg-amber-500/10 text-amber-500'
                          : item.type === 'investment'
                          ? 'bg-purple-500/10 text-purple-500'
                          : 'bg-blue-500/10 text-blue-500'
                      }`}
                    >
                      {item.type === 'emi' ? (
                        <Landmark className="h-4 w-4" />
                      ) : item.type === 'investment' ? (
                        <TrendingUp className="h-4 w-4" />
                      ) : (
                        <Repeat className="h-4 w-4" />
                      )}
                    </div>

                    <div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="font-bold text-foreground">{item.title}</p>
                        <Badge variant="outline" className="text-[9px] uppercase px-1.5 py-0">
                          {item.type}
                        </Badge>
                        {item.isExternalChit && (
                          <Badge variant="outline" className="text-[9px] text-amber-500 border-amber-500/30 px-1.5 py-0">
                            External Chit
                          </Badge>
                        )}
                        {item.isFlexibleDate && (
                          <Badge variant="outline" className="text-[9px] text-cyan-500 border-cyan-500/30 px-1.5 py-0">
                            Flexible Date
                          </Badge>
                        )}
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        Due: {new Date(item.dueDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <p className="font-mono font-bold text-foreground">
                        {formatCurrency(isPaid && item.actualAmount ? item.actualAmount : item.expectedAmount, user?.currency || 'INR')}
                      </p>
                      {isPaid && item.actualAmount && item.actualAmount < item.expectedAmount ? (
                        <p className="text-[10px] text-emerald-500">
                          Saved ₹{item.expectedAmount - item.actualAmount}
                        </p>
                      ) : (
                        <span className="text-[10px] text-muted-foreground">
                          {isPaid ? 'Paid' : item.status === 'skipped' ? 'Skipped' : 'Expected'}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      {isPaid ? (
                        <Badge variant="default" className="bg-emerald-600 text-white text-[10px] flex items-center gap-1">
                          <CheckCircle className="h-3 w-3" /> Paid
                        </Badge>
                      ) : item.status === 'skipped' ? (
                        <Badge variant="outline" className="text-amber-500 border-amber-500/40 bg-amber-500/10 text-[10px] flex items-center gap-1">
                          <Ban className="h-3 w-3" /> Skipped
                        </Badge>
                      ) : item.isOverdue ? (
                        <Badge variant="outline" className="text-red-500 border-red-500/40 bg-red-500/10 text-[10px] flex items-center gap-1">
                          <AlertCircle className="h-3 w-3" /> Overdue
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-amber-500 border-amber-500/40 text-[10px] flex items-center gap-1">
                          <Clock className="h-3 w-3" /> Due
                        </Badge>
                      )}

                      {!isPaid && item.status !== 'skipped' && (
                        <Link
                          href={
                            item.type === 'emi'
                              ? `/emi?pay=${item.ruleId}&occurrence=${item.occurrenceKey}`
                              : item.type === 'investment'
                              ? `/investments/${item.ruleId}`
                              : '/recurring'
                          }
                        >
                          <Button size="sm" variant="outline" className="h-7 text-[11px] px-2 font-semibold">
                            {item.type === 'emi' ? 'Pay EMI' : item.type === 'investment' ? 'Pay Investment' : 'Log Now'}
                          </Button>
                        </Link>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
