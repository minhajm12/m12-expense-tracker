'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/components/ui/toast';
import { formatCurrency, ChitCycleInfo } from '@finora/shared';
import {
  Trophy,
  Dices,
  RotateCw,
  CheckCircle2,
  Lock,
  Sparkles,
  Users,
  AlertCircle,
  Award,
  ChevronRight,
  ShieldCheck,
  RefreshCw,
} from 'lucide-react';

interface MemberItem {
  id: string;
  name: string;
  numberOfChits: number;
  contributionPerChit: number;
  totalExpectedPerPeriod: number;
}

interface SpinnerWheelProps {
  fundId: string;
  currency: string;
  currentCyclePeriod: string;
  cycleInfo?: ChitCycleInfo | null;
  confirmedWinner?: {
    id?: string;
    name?: string;
    confirmedAt?: string;
  } | null;
  onWinnerConfirmed: () => void;
}

const SLICE_COLORS = [
  '#05A100', // M12 Emerald Brand
  '#0284c7', // Sky Blue
  '#7c3aed', // Violet
  '#d97706', // Amber
  '#0d9488', // Teal
  '#e11d48', // Rose
  '#2563eb', // Blue
  '#16a34a', // Green
  '#9333ea', // Purple
  '#ea580c', // Orange
  '#0891b2', // Cyan
  '#4f46e5', // Indigo
];

export function ChitFundSpinnerWheel({
  fundId,
  currency,
  currentCyclePeriod,
  cycleInfo,
  confirmedWinner,
  onWinnerConfirmed,
}: SpinnerWheelProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const currentRotationRef = useRef<number>(0);
  const animFrameRef = useRef<number | null>(null);

  const [loadingEligible, setLoadingEligible] = useState(false);
  const [eligibleMembers, setEligibleMembers] = useState<MemberItem[]>([]);
  const [spinning, setSpinning] = useState(false);
  const [spinMode, setSpinMode] = useState<'official' | 'trial' | null>(null);
  const [currentRotation, setCurrentRotation] = useState(0);
  const [previewWinner, setPreviewWinner] = useState<MemberItem | null>(null);
  const [trialWinner, setTrialWinner] = useState<MemberItem | null>(null);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmationNotes, setConfirmationNotes] = useState('');

  const getApiUrl = () => process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

  // Cleanup animation frame on unmount
  useEffect(() => {
    return () => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, []);

  // Load eligible members for this cycle
  const fetchEligibleMembers = async () => {
    setLoadingEligible(true);
    try {
      const res = await fetch(`${getApiUrl()}/api/v1/chit-funds/${fundId}/eligible-members`, {
        credentials: 'include',
      });
      const json = await res.json();
      if (res.ok && json.success) {
        setEligibleMembers(json.data.eligibleMembers || []);
      }
    } catch {
      toast.error('Failed to load eligible chit fund members');
    } finally {
      setLoadingEligible(false);
    }
  };

  useEffect(() => {
    if (fundId) {
      fetchEligibleMembers();
    }
  }, [fundId, currentCyclePeriod]);

  // Draw the wheel onto HTML5 Canvas
  const drawWheel = (rotationAngle: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = Math.min(centerX, centerY) - 16;

    ctx.clearRect(0, 0, width, height);

    const numSlices = eligibleMembers.length;
    if (numSlices === 0) {
      // Empty wheel placeholder
      ctx.save();
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
      ctx.fillStyle = '#1e293b';
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#334155';
      ctx.stroke();

      ctx.fillStyle = '#94a3b8';
      ctx.font = 'bold 14px "Google Sans", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('No eligible members', centerX, centerY);
      ctx.restore();
      return;
    }

    const sliceAngle = (2 * Math.PI) / numSlices;

    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.rotate(rotationAngle);

    // Draw slices
    for (let i = 0; i < numSlices; i++) {
      const startAngle = i * sliceAngle;
      const endAngle = startAngle + sliceAngle;
      const member = eligibleMembers[i];
      const color = SLICE_COLORS[i % SLICE_COLORS.length];

      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, radius, startAngle, endAngle);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#0f172a';
      ctx.stroke();

      // Draw member label text
      ctx.save();
      ctx.rotate(startAngle + sliceAngle / 2);
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
      ctx.shadowBlur = 4;

      const label = member.name;
      const truncated = label.length > 16 ? label.slice(0, 14) + '..' : label;

      const fontSize = numSlices > 15 ? 11 : numSlices > 10 ? 12 : 14;
      ctx.font = `bold ${fontSize}px "Google Sans", sans-serif`;
      ctx.fillText(truncated, radius - 20, 0);
      ctx.restore();
    }

    // Outer wheel border ring
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, 2 * Math.PI);
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#05A100'; // M12 green highlight
    ctx.stroke();

    // Center hub
    ctx.beginPath();
    ctx.arc(0, 0, 32, 0, 2 * Math.PI);
    ctx.fillStyle = '#0f172a';
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#05A100';
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 12px "Google Sans", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('M12', 0, 0);

    ctx.restore();

    // Draw the Top Needle Pointer (pointing downwards into the top of the wheel)
    ctx.save();
    ctx.translate(centerX, centerY - radius + 4);
    ctx.beginPath();
    ctx.moveTo(-16, -24);
    ctx.lineTo(16, -24);
    ctx.lineTo(0, 8);
    ctx.closePath();
    ctx.fillStyle = '#f59e0b'; // Gold needle
    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
    ctx.shadowBlur = 6;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    ctx.restore();
  };

  useEffect(() => {
    drawWheel(currentRotationRef.current);
  }, [eligibleMembers]);

  // Handle Spin Click (Server-Selected with animated deceleration and precise landing)
  const handleSpinClick = async (isTrial: boolean = false) => {
    if (spinning) return;
    if (eligibleMembers.length === 0) {
      toast.error('No eligible members available to spin');
      return;
    }

    // Cancel any in-flight animation
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }

    setSpinning(true);
    setSpinMode(isTrial ? 'trial' : 'official');
    if (isTrial) {
      setTrialWinner(null);
    } else {
      setPreviewWinner(null);
    }

    try {
      // Unbiased random choice from server (trial vs official preview)
      const endpoint = isTrial ? 'trial-spin' : 'spin-preview';
      const res = await fetch(`${getApiUrl()}/api/v1/chit-funds/${fundId}/cycles/${currentCyclePeriod}/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });
      const json = await res.json();

      if (!res.ok || !json.success) {
        toast.error(json.error?.message || `Could not initiate ${isTrial ? 'trial' : 'official'} spin`);
        setSpinning(false);
        setSpinMode(null);
        return;
      }

      const serverSelected = json.data.selectedMember;
      const numSlices = eligibleMembers.length;
      const sliceAngle = (2 * Math.PI) / numSlices;

      // Find index of the server-selected member
      let targetIndex = eligibleMembers.findIndex((m) => m.id === serverSelected.id);
      if (targetIndex === -1) targetIndex = 0;

      // Needle pointer is located at top = 3 * Math.PI / 2 (270 degrees)
      const needleAngle = (3 * Math.PI) / 2;
      const sliceCenter = (targetIndex + 0.5) * sliceAngle;

      // For sliceCenter + R === needleAngle (mod 2pi):
      // R === needleAngle - sliceCenter (mod 2pi)
      const desiredOffset = ((needleAngle - sliceCenter) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);

      const startAngle = currentRotationRef.current;
      // Always guarantee at least 7 full revolutions for consistent high initial speed
      const minExtraRotation = 7 * 2 * Math.PI;
      const currentBase = startAngle + minExtraRotation;
      const currentBaseOffset = ((currentBase % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);

      let diff = desiredOffset - currentBaseOffset;
      if (diff < 0) {
        diff += 2 * Math.PI;
      }

      const targetRotation = currentBase + diff;
      const deltaAngle = targetRotation - startAngle;

      // Check prefers-reduced-motion
      const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (prefersReducedMotion) {
        currentRotationRef.current = targetRotation;
        setCurrentRotation(targetRotation);
        drawWheel(targetRotation);
        if (isTrial) {
          setTrialWinner(serverSelected);
          setPreviewWinner(null);
        } else {
          setPreviewWinner(serverSelected);
          setTrialWinner(null);
        }
        setSpinning(false);
        return;
      }

      // Smooth 4.5s animation with cubic ease-out
      const duration = 4500;
      const startTime = performance.now();

      const animate = (time: number) => {
        const elapsed = time - startTime;
        const progress = Math.min(1, elapsed / duration);

        // Smooth cubic ease-out: high initial angular speed, natural smooth deceleration
        const easeOut = 1 - Math.pow(1 - progress, 3);
        const currentAngle = startAngle + deltaAngle * easeOut;

        currentRotationRef.current = currentAngle;
        drawWheel(currentAngle);

        if (progress < 1) {
          animFrameRef.current = requestAnimationFrame(animate);
        } else {
          currentRotationRef.current = targetRotation;
          setCurrentRotation(targetRotation);
          drawWheel(targetRotation);
          setSpinning(false);
          if (isTrial) {
            setTrialWinner(serverSelected);
            setPreviewWinner(null);
          } else {
            setPreviewWinner(serverSelected);
            setTrialWinner(null);
          }
          animFrameRef.current = null;
        }
      };

      animFrameRef.current = requestAnimationFrame(animate);
    } catch {
      toast.error('Network error during spinner selection');
      setSpinning(false);
      setSpinMode(null);
    }
  };

  // Confirm Winner handler
  const handleConfirmWinner = async () => {
    if (!previewWinner) return;
    setConfirming(true);

    try {
      const res = await fetch(`${getApiUrl()}/api/v1/chit-funds/${fundId}/cycles/${currentCyclePeriod}/confirm-winner`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          memberId: previewWinner.id,
          notes: confirmationNotes.trim() || undefined,
        }),
      });

      const json = await res.json();
      if (res.ok && json.success) {
        toast.success(`🎉 ${previewWinner.name} is confirmed as the Winner for ${currentCyclePeriod}!`);
        setShowConfirmModal(false);
        setPreviewWinner(null);
        setTrialWinner(null);
        setSpinMode(null);
        setConfirmationNotes('');
        onWinnerConfirmed();
        fetchEligibleMembers();
      } else {
        toast.error(json.error?.message || 'Failed to confirm winner');
      }
    } catch {
      toast.error('Network error confirming winner');
    } finally {
      setConfirming(false);
    }
  };

  const isCycleLocked = Boolean(confirmedWinner && confirmedWinner.name);

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-card p-4 rounded-xl border border-border">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold tracking-tight">Chit Lot Spinner Wheel</h2>
            <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/30 gap-1 font-mono">
              <Sparkles className="h-3 w-3" />
              Cycle: {currentCyclePeriod}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Server-side unbiased random lot selection for the monthly prize on the 15th of every month.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Badge variant="outline" className="gap-1.5 py-1 px-3 text-xs bg-muted/50 border-border">
            <Users className="h-3.5 w-3.5 text-indigo-400" />
            <span className="font-semibold text-foreground">{eligibleMembers.length}</span> Eligible Members
          </Badge>
          <Button
            variant="outline"
            size="sm"
            onClick={fetchEligibleMembers}
            disabled={loadingEligible || spinning}
            className="gap-1.5 text-xs"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loadingEligible ? 'animate-spin' : ''}`} />
            Sync Pool
          </Button>
        </div>
      </div>

      {/* If Cycle Already Has a Confirmed Winner: Show Locked Trophy Card */}
      {isCycleLocked && (
        <Card className="border-amber-500/40 bg-amber-500/10 shadow-sm animate-in fade-in">
          <CardContent className="p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-start gap-3.5">
              <div className="p-2.5 rounded-full bg-amber-500/20 text-amber-400 shrink-0">
                <Trophy className="h-6 w-6" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-bold text-amber-400">
                    Winner Confirmed for {currentCyclePeriod}
                  </h3>
                  <Badge variant="outline" className="bg-amber-500/20 text-amber-300 border-amber-500/40 gap-1 text-[11px]">
                    <Lock className="h-3 w-3" />
                    Locked
                  </Badge>
                </div>
                <p className="text-sm font-semibold text-foreground mt-0.5">
                  Winner: <span className="text-amber-300 font-bold">{confirmedWinner?.name}</span>
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Duplicate confirmations are locked for this monthly cycle. You can still spin for preview, but confirmation is disabled.
                </p>
              </div>
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={() => onWinnerConfirmed()}
              className="border-amber-500/40 text-amber-400 hover:bg-amber-500/20 text-xs shrink-0"
            >
              View in Winners Tab →
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Main Spinner Arena */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left / Center: Interactive Canvas Wheel */}
        <div className="lg:col-span-7 flex flex-col items-center justify-center p-6 bg-card rounded-2xl border border-border shadow-sm">
          <div className="relative mb-6">
            <canvas
              ref={canvasRef}
              width={420}
              height={420}
              className="max-w-full h-auto drop-shadow-xl"
            />
          </div>

          <div className="flex items-center gap-3 flex-wrap justify-center">
            {/* Primary Action: Official Winner Spin */}
            <Button
              size="lg"
              onClick={() => handleSpinClick(false)}
              disabled={spinning || eligibleMembers.length === 0}
              className="gap-2 bg-[#05A100] hover:bg-[#048700] text-white px-6 py-6 text-sm sm:text-base font-bold shadow-lg shadow-emerald-500/20"
            >
              {spinning && spinMode === 'official' ? (
                <>
                  <RotateCw className="h-5 w-5 animate-spin" />
                  Spinning Official Wheel...
                </>
              ) : (
                <>
                  <Trophy className="h-5 w-5" />
                  {previewWinner ? 'Re-Spin Official Lot' : 'Spin Official Lot'}
                </>
              )}
            </Button>

            {/* Trial Spin: Free Preview */}
            <Button
              variant="outline"
              size="lg"
              onClick={() => handleSpinClick(true)}
              disabled={spinning || eligibleMembers.length === 0}
              className="gap-2 border-amber-500/50 hover:bg-amber-500/10 text-amber-400 px-6 py-6 text-sm sm:text-base font-semibold"
            >
              {spinning && spinMode === 'trial' ? (
                <>
                  <RotateCw className="h-5 w-5 animate-spin" />
                  Spinning Trial...
                </>
              ) : (
                <>
                  <Dices className="h-5 w-5 text-amber-400" />
                  Try Spin Lot — Free Preview
                </>
              )}
            </Button>

            {/* Clear Button */}
            {(previewWinner || trialWinner) && !spinning && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setPreviewWinner(null);
                  setTrialWinner(null);
                  setSpinMode(null);
                }}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Clear Result
              </Button>
            )}
          </div>

          <p className="text-[11px] text-muted-foreground mt-4 text-center max-w-md">
            Spinning is a <strong>preview only</strong> and does not mutate database records. Winner confirmation requires explicit action below.
          </p>
        </div>

        {/* Right: Selected Member Preview & Confirmation Card */}
        <div className="lg:col-span-5 space-y-4">
          {trialWinner ? (
            <Card className="border-amber-500/40 bg-amber-500/10 shadow-lg animate-in zoom-in-95 duration-200">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <Badge variant="outline" className="bg-amber-500/20 text-amber-300 border-amber-500/40 gap-1 font-bold text-[10px] tracking-wide">
                    <Sparkles className="h-3 w-3" />
                    TRIAL SPIN — NOT AN OFFICIAL WINNER
                  </Badge>
                  <span className="text-[11px] text-muted-foreground font-mono">
                    {currentCyclePeriod}
                  </span>
                </div>
                <CardTitle className="text-xl font-bold text-foreground mt-2">
                  Trial Spin Preview
                </CardTitle>
                <CardDescription className="text-xs text-muted-foreground">
                  The wheel landed on this member during a free practice spin.
                </CardDescription>
              </CardHeader>

              <CardContent className="space-y-4">
                <div className="p-4 rounded-xl bg-card border border-amber-500/30 flex items-center gap-3.5">
                  <div className="h-12 w-12 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center font-bold text-xl shrink-0">
                    <Dices className="h-6 w-6" />
                  </div>
                  <div>
                    <h4 className="text-lg font-bold text-foreground">{trialWinner.name}</h4>
                    <p className="text-xs text-muted-foreground">
                      Monthly contribution:{' '}
                      <span className="font-semibold text-amber-400">
                        {formatCurrency(trialWinner.totalExpectedPerPeriod, currency)}
                      </span>
                    </p>
                  </div>
                </div>

                <div className="p-3 rounded-lg bg-background/50 border border-amber-500/30 text-xs text-amber-300 space-y-1">
                  <div className="flex items-center gap-1.5 font-medium text-amber-400">
                    <AlertCircle className="h-3.5 w-3.5" />
                    Trial Mode Only
                  </div>
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    This result is strictly a preview. No winner was saved, cycle status remains unchanged, member eligibility is preserved, and no payout was created.
                  </p>
                </div>
              </CardContent>

              <CardFooter className="flex flex-col gap-2 pt-2">
                <Button
                  size="default"
                  variant="outline"
                  onClick={() => handleSpinClick(true)}
                  disabled={spinning || eligibleMembers.length === 0}
                  className="w-full gap-2 border-amber-500/40 text-amber-400 hover:bg-amber-500/20 font-semibold"
                >
                  <Dices className="h-4 w-4" />
                  Try Spin Again (Free Preview)
                </Button>
                <Button
                  size="default"
                  onClick={() => handleSpinClick(false)}
                  disabled={spinning || eligibleMembers.length === 0}
                  className="w-full gap-2 bg-[#05A100] hover:bg-[#048700] text-white font-bold"
                >
                  <Trophy className="h-4 w-4" />
                  Switch to Official Spin
                </Button>
              </CardFooter>
            </Card>
          ) : previewWinner ? (
            <Card className="border-emerald-500/40 bg-emerald-500/10 shadow-lg animate-in zoom-in-95 duration-200">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <Badge variant="outline" className="bg-emerald-500/20 text-emerald-400 border-emerald-500/40 gap-1 font-bold">
                    <Sparkles className="h-3 w-3" />
                    Official Spinner Candidate
                  </Badge>
                  <span className="text-[11px] text-muted-foreground font-mono">
                    {currentCyclePeriod}
                  </span>
                </div>
                <CardTitle className="text-xl font-bold text-foreground mt-2">
                  Selected Member
                </CardTitle>
                <CardDescription className="text-xs text-muted-foreground">
                  The wheel landed on this eligible participant.
                </CardDescription>
              </CardHeader>

              <CardContent className="space-y-4">
                <div className="p-4 rounded-xl bg-card border border-emerald-500/30 flex items-center gap-3.5">
                  <div className="h-12 w-12 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold text-xl shrink-0">
                    <Award className="h-6 w-6" />
                  </div>
                  <div>
                    <h4 className="text-lg font-bold text-foreground">{previewWinner.name}</h4>
                    <p className="text-xs text-muted-foreground">
                      Monthly contribution:{' '}
                      <span className="font-semibold text-emerald-400">
                        {formatCurrency(previewWinner.totalExpectedPerPeriod, currency)}
                      </span>
                    </p>
                  </div>
                </div>

                <div className="p-3 rounded-lg bg-background/50 border border-border/80 text-xs text-muted-foreground space-y-1">
                  <div className="flex items-center gap-1.5 font-medium text-foreground">
                    <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
                    Preview Selection Rules
                  </div>
                  <p>
                    This member will be excluded from future winner lots once confirmed. To make this result official, click the button below.
                  </p>
                </div>
              </CardContent>

              <CardFooter className="flex flex-col gap-2 pt-2">
                <Button
                  size="default"
                  onClick={() => setShowConfirmModal(true)}
                  disabled={isCycleLocked}
                  className="w-full gap-2 bg-[#05A100] hover:bg-[#048700] text-white font-bold"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  Mark as Winner for {currentCyclePeriod}
                </Button>

                {isCycleLocked && (
                  <p className="text-[11px] text-amber-400 text-center">
                    Locked: A winner has already been confirmed for this cycle.
                  </p>
                )}
              </CardFooter>
            </Card>
          ) : (
            <Card className="border-border bg-card">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-bold flex items-center gap-2">
                  <Trophy className="h-4 w-4 text-emerald-400" />
                  Eligible Lot Pool
                </CardTitle>
                <CardDescription className="text-xs">
                  Active members who have not yet won a prize.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 max-h-[360px] overflow-y-auto pr-1">
                {eligibleMembers.length === 0 ? (
                  <div className="text-center py-8 text-xs text-muted-foreground">
                    <AlertCircle className="h-6 w-6 text-muted-foreground mx-auto mb-2 opacity-50" />
                    No eligible members remaining. All members have won previously.
                  </div>
                ) : (
                  eligibleMembers.map((m, idx) => (
                    <div
                      key={m.id}
                      className="p-2.5 rounded-lg bg-muted/40 hover:bg-muted/70 border border-border/60 flex items-center justify-between text-xs transition-colors"
                    >
                      <div className="flex items-center gap-2.5">
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: SLICE_COLORS[idx % SLICE_COLORS.length] }}
                        />
                        <span className="font-medium text-foreground">{m.name}</span>
                      </div>
                      <span className="text-muted-foreground font-mono">
                        {formatCurrency(m.totalExpectedPerPeriod, currency)}
                      </span>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Winner Confirmation Modal */}
      {showConfirmModal && previewWinner && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in">
          <Card className="w-full max-w-md border-border bg-card shadow-2xl">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2 text-emerald-400">
                <Trophy className="h-5 w-5" />
                <CardTitle className="text-lg font-bold text-foreground">
                  Confirm Chit Winner
                </CardTitle>
              </div>
              <CardDescription className="text-xs text-muted-foreground">
                Locking this winner for cycle {currentCyclePeriod}.
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-4">
              <div className="p-4 rounded-xl bg-muted/50 border border-border space-y-2">
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Cycle Month:</span>
                  <span className="font-bold text-foreground font-mono">{currentCyclePeriod}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Winner Name:</span>
                  <span className="font-bold text-emerald-400 text-sm">{previewWinner.name}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Scheduled Prize Date:</span>
                  <span className="font-semibold text-foreground">
                    {cycleInfo?.formattedPrizeDate || '15th of the month'}
                  </span>
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-foreground block mb-1">
                  Confirmation Notes (Optional)
                </label>
                <textarea
                  value={confirmationNotes}
                  onChange={(e) => setConfirmationNotes(e.target.value)}
                  placeholder="e.g. Drawn via live family animated lot wheel on 15th"
                  className="w-full text-xs p-2.5 rounded-lg border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary h-20 resize-none"
                />
              </div>

              <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-400">
                <strong>Important:</strong> Exactly one winner can be confirmed per monthly cycle. Once confirmed, this member is excluded from future lot spinner selections.
              </div>
            </CardContent>

            <CardFooter className="flex justify-end gap-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowConfirmModal(false)}
                disabled={confirming}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleConfirmWinner}
                disabled={confirming}
                className="gap-1.5 bg-[#05A100] hover:bg-[#048700] text-white font-bold"
              >
                {confirming ? (
                  <>
                    <RotateCw className="h-3.5 w-3.5 animate-spin" />
                    Confirming...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Lock as Winner
                  </>
                )}
              </Button>
            </CardFooter>
          </Card>
        </div>
      )}
    </div>
  );
}
