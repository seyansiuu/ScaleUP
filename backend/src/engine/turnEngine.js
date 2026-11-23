/**
 * Deterministic Simulation Engine — Pure Function.
 *
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  ZERO database imports.  This module is a pure function that    ║
 * ║  takes the current startup state + founder decisions and        ║
 * ║  returns the next state, market events, and accounting ledger.  ║
 * ║  Every turn is fully reproducible given the same seed.          ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

import { mulberry32 } from '../utils/prng.js';

// ─── Constants ──────────────────────────────────────────────────
const SALARY_MAP = {
  ENGINEERING: 1200000, // $12,000 / month
  SALES:        900000, // $9,000  / month
  MARKETING:    800000, // $8,000  / month
  SUPPORT:      600000, // $6,000  / month
};

const COGS_BPS          = 2000;    // 20 % of MRR
const FIXED_OPEX_CENTS  = 500000;  // $5,000 / month
const BASE_CHURN_BPS    = 500;     // 5 % monthly churn baseline
const BASE_CONVERSION_BPS = 1000;  // 10 % lead → customer baseline

// ─── Main entry point ───────────────────────────────────────────

/**
 * Execute a single monthly turn.
 *
 * @param {object} state      Current startup state (all numbers, no BigInts).
 * @param {object} decisions  Founder decisions for this turn.
 * @returns {{ newState, events, ledger, availableTermSheet }}
 */
export function executeTurn(state, decisions) {
  const {
    month, cashCents, employees, cohorts, qualityScore,
    productPriceCents, founderEquityBps, seed, status,
    raisedSeed, raisedSeriesA,
  } = state;

  if (status !== 'ACTIVE') {
    throw new Error('Cannot advance turn: startup is not active');
  }

  const newMonth = month + 1;
  const rng = mulberry32(seed + newMonth); // deterministic per-month

  // Deep-clone mutable collections
  let newEmployees  = JSON.parse(JSON.stringify(employees));
  let newCohorts    = JSON.parse(JSON.stringify(cohorts));
  let newQuality    = qualityScore;
  const newPrice    = decisions.priceCents ?? productPriceCents;
  let newEquity     = founderEquityBps;
  let newRaisedSeed = raisedSeed ?? false;
  let newRaisedA    = raisedSeriesA ?? false;
  const events      = [];
  const ledger      = [];

  // ════════════════════════════════════════════════════════════════
  // Step 1 — Apply Founder Decisions (hire / fire / price)
  // ════════════════════════════════════════════════════════════════

  for (const hire of (decisions.hires ?? [])) {
    const salary = SALARY_MAP[hire.role];
    if (!salary) continue;
    for (let i = 0; i < hire.count; i++) {
      newEmployees.push({
        /* id intentionally absent — server persists as new row */
        role: hire.role,
        salaryCents: salary,
        hiredMonth: newMonth,
        isActive: true,
      });
    }
  }

  for (const fireId of (decisions.fires ?? [])) {
    const emp = newEmployees.find(e => e.id === fireId && e.isActive);
    if (emp) {
      emp.isActive   = false;
      emp.firedMonth = newMonth;
    }
  }

  // Headcount helpers
  const active        = newEmployees.filter(e => e.isActive);
  const engineerCount = active.filter(e => e.role === 'ENGINEERING').length;
  const salesCount    = active.filter(e => e.role === 'SALES').length;
  const supportCount  = active.filter(e => e.role === 'SUPPORT').length;

  // ════════════════════════════════════════════════════════════════
  // Step 2 — Engineering Velocity & Product Quality
  // ════════════════════════════════════════════════════════════════

  const qualityDelta = Math.floor(Math.sqrt(Math.max(engineerCount, 0)) * 3);
  newQuality = Math.min(100, newQuality + qualityDelta);

  // ════════════════════════════════════════════════════════════════
  // Step 3 — Customer Cohort Churn
  // ════════════════════════════════════════════════════════════════

  const qualityMod = -Math.floor((newQuality - 50) * 10);
  const supportMod = -Math.floor(Math.sqrt(supportCount) * 50);
  const priceMod   =  Math.floor(Math.max(0, newPrice - 5000) / 1000 * 20);
  let effectiveChurnBps = BASE_CHURN_BPS + qualityMod + supportMod + priceMod;
  effectiveChurnBps = Math.max(100, Math.min(3000, effectiveChurnBps));

  let totalChurned = 0;
  for (const cohort of newCohorts) {
    if (cohort.currentCount <= 0) continue;
    const churned = Math.floor(cohort.currentCount * effectiveChurnBps / 10000);
    cohort.currentCount = Math.max(0, cohort.currentCount - churned);
    totalChurned += churned;
  }

  // ════════════════════════════════════════════════════════════════
  // Step 4 — Marketing Leads & Sales Conversion
  // ════════════════════════════════════════════════════════════════

  const mktg = decisions.marketing ?? { organic: 0, paid: 0, content: 0 };
  const organicLeads = Math.floor(Math.sqrt(Math.max(mktg.organic, 0) / 100) * 2);
  const paidLeads    = Math.floor(Math.sqrt(Math.max(mktg.paid,    0) / 100) * 5);
  const contentLeads = Math.floor(Math.sqrt(Math.max(mktg.content, 0) / 100) * 3);
  const totalLeads   = organicLeads + paidLeads + contentLeads;

  const salesMod      = Math.floor(Math.sqrt(salesCount) * 300);
  const conversionBps = Math.min(5000, BASE_CONVERSION_BPS + salesMod); // cap 50 %
  const newCustomers  = Math.floor(totalLeads * conversionBps / 10000);

  if (newCustomers > 0) {
    newCohorts.push({
      acquiredMonth: newMonth,
      initialCount: newCustomers,
      currentCount: newCustomers,
      monthlyPriceCents: newPrice,
    });
  }

  // ════════════════════════════════════════════════════════════════
  // Step 5 — Financial Calculations (all in integer cents)
  // ════════════════════════════════════════════════════════════════

  const totalActiveCustomers = newCohorts.reduce((s, c) => s + c.currentCount, 0);
  const mrrCents = newCohorts.reduce(
    (s, c) => s + c.currentCount * c.monthlyPriceCents, 0,
  );
  const arrCents = mrrCents * 12;

  const cogsCents          = Math.floor(mrrCents * COGS_BPS / 10000);
  const payrollCents       = active.reduce((s, e) => s + e.salaryCents, 0);
  const totalMarketingCents = (mktg.organic || 0) + (mktg.paid || 0) + (mktg.content || 0);

  const totalRevenueCents  = mrrCents;
  const totalExpensesCents = cogsCents + payrollCents + totalMarketingCents + FIXED_OPEX_CENTS;
  const netBurnCents       = totalRevenueCents - totalExpensesCents;

  // ── VC Term-Sheet Logic ─────────────────────────────────────
  let fundingCents       = 0;
  let availableTermSheet = null;

  if (mrrCents >= 500000 && newEquity > 7500 && !newRaisedSeed) {
    availableTermSheet = {
      type: 'SEED',
      amountCents: 200000000,     // $2 M
      equityCostBps: 2000,        // 20 %
      label: 'Seed Round: $2M for 20%',
    };
  } else if (mrrCents >= 2000000 && newEquity > 5000 && newRaisedSeed && !newRaisedA) {
    availableTermSheet = {
      type: 'SERIES_A',
      amountCents: 1000000000,    // $10 M
      equityCostBps: 2500,        // 25 %
      label: 'Series A: $10M for 25%',
    };
  }

  if (decisions.acceptTermSheet && availableTermSheet) {
    fundingCents = availableTermSheet.amountCents;
    newEquity   -= availableTermSheet.equityCostBps;
    if (availableTermSheet.type === 'SEED')     newRaisedSeed = true;
    if (availableTermSheet.type === 'SERIES_A') newRaisedA    = true;
    events.push({
      type: 'FUNDING_RAISED',
      description: `💰 Closed ${availableTermSheet.label}!`,
      impact: 'positive',
    });
  }

  // ── Cash-flow totals ─────────────────────────────────────────
  const totalInflows  = totalRevenueCents + fundingCents;
  const totalOutflows = totalExpensesCents;
  const endingCashCents = cashCents + totalInflows - totalOutflows;

  // Derived metrics
  const cacCents      = newCustomers > 0 ? Math.floor(totalMarketingCents / newCustomers) : 0;
  const grossMarginBps = mrrCents > 0
    ? Math.floor((mrrCents - cogsCents) * 10000 / mrrCents)
    : 0;
  const runwayMonths  = netBurnCents < 0
    ? Math.max(0, Math.floor(endingCashCents / Math.abs(netBurnCents)))
    : 999;

  // ════════════════════════════════════════════════════════════════
  // Step 6 — Accounting Invariant
  // ════════════════════════════════════════════════════════════════
  //
  // previousCash + totalInflows − totalOutflows === endingCash
  //
  const invariantCheck = cashCents + totalInflows - totalOutflows;
  if (invariantCheck !== endingCashCents) {
    throw new Error(
      `ACCOUNTING INVARIANT VIOLATED: ` +
      `${cashCents} + ${totalInflows} - ${totalOutflows} = ${invariantCheck} ≠ ${endingCashCents}`,
    );
  }

  // Build immutable ledger
  ledger.push(
    { type: 'INFLOW',  label: 'Revenue (MRR)', amountCents: mrrCents },
  );
  if (fundingCents > 0) {
    ledger.push({ type: 'INFLOW', label: 'Funding', amountCents: fundingCents });
  }
  ledger.push(
    { type: 'OUTFLOW', label: 'COGS',         amountCents: cogsCents },
    { type: 'OUTFLOW', label: 'Payroll',       amountCents: payrollCents },
    { type: 'OUTFLOW', label: 'Marketing',     amountCents: totalMarketingCents },
    { type: 'OUTFLOW', label: 'Fixed OpEx',    amountCents: FIXED_OPEX_CENTS },
    { type: 'NET',     label: 'Net Cash Flow', amountCents: netBurnCents + fundingCents },
  );

  // ════════════════════════════════════════════════════════════════
  // Step 7 — Seeded Market Events
  // ════════════════════════════════════════════════════════════════

  const eventRoll = rng();

  if (eventRoll < 0.05) {
    // 5 % — Viral tweet
    const viralCount = Math.floor(rng() * 20) + 10;
    newCohorts.push({
      acquiredMonth: newMonth,
      initialCount: viralCount,
      currentCount: viralCount,
      monthlyPriceCents: newPrice,
    });
    events.push({
      type: 'VIRAL_TWEET',
      description: `🐦 A viral tweet brought ${viralCount} organic customers!`,
      impact: 'positive',
    });
  } else if (eventRoll < 0.08) {
    // 3 % — Cloud outage
    newQuality = Math.max(1, newQuality - 15);
    events.push({
      type: 'CLOUD_OUTAGE',
      description: '⚡ A major cloud outage degraded product quality by 15 points.',
      impact: 'negative',
    });
  } else if (eventRoll < 0.12 && newQuality > 60) {
    // 4 % (quality-gated) — Enterprise contract
    const contractValue = 1000000; // $10,000 / month
    newCohorts.push({
      acquiredMonth: newMonth,
      initialCount: 1,
      currentCount: 1,
      monthlyPriceCents: contractValue,
    });
    events.push({
      type: 'ENTERPRISE_CONTRACT',
      description: '🏢 An enterprise client signed a $10,000/month contract!',
      impact: 'positive',
    });
  } else if (eventRoll < 0.15) {
    // 3 % — Key hire
    newQuality = Math.min(100, newQuality + 5);
    events.push({
      type: 'KEY_HIRE',
      description: '⭐ A talented engineer joined your team! Quality +5.',
      impact: 'positive',
    });
  } else if (eventRoll < 0.18) {
    // 3 % — Competitor price war
    const lostCount = Math.floor(totalActiveCustomers * 0.05);
    if (lostCount > 0) {
      let remaining = lostCount;
      for (const cohort of newCohorts) {
        if (remaining <= 0) break;
        const loss = Math.min(cohort.currentCount, remaining);
        cohort.currentCount -= loss;
        remaining -= loss;
      }
    }
    events.push({
      type: 'COMPETITOR_PRICE_WAR',
      description: `⚔️ A competitor slashed prices — you lost ~${lostCount} customers.`,
      impact: 'negative',
    });
  } else if (eventRoll < 0.20) {
    // 2 % — Press coverage
    const pressCustomers = Math.floor(rng() * 8) + 3;
    newCohorts.push({
      acquiredMonth: newMonth,
      initialCount: pressCustomers,
      currentCount: pressCustomers,
      monthlyPriceCents: newPrice,
    });
    events.push({
      type: 'PRESS_COVERAGE',
      description: `📰 A tech blog featured your product — ${pressCustomers} new signups!`,
      impact: 'positive',
    });
  }

  // ════════════════════════════════════════════════════════════════
  // Step 8 — Bankruptcy Check
  // ════════════════════════════════════════════════════════════════

  let newStatus = 'ACTIVE';
  if (endingCashCents < 0) {
    newStatus = 'BANKRUPT';
    events.push({
      type: 'BANKRUPT',
      description: '💀 Your startup has run out of cash. Game Over.',
      impact: 'negative',
    });
  }

  // ════════════════════════════════════════════════════════════════
  // Build output
  // ════════════════════════════════════════════════════════════════

  const newState = {
    month: newMonth,
    cashCents: endingCashCents,
    mrrCents,
    arrCents,
    qualityScore: newQuality,
    productPriceCents: newPrice,
    founderEquityBps: newEquity,
    employees: newEmployees,
    cohorts: newCohorts,
    status: newStatus,
    raisedSeed: newRaisedSeed,
    raisedSeriesA: newRaisedA,
    seed,
    metrics: {
      totalActiveCustomers,
      cogsCents,
      payrollCents,
      totalMarketingCents,
      fixedOpExCents: FIXED_OPEX_CENTS,
      totalRevenueCents,
      totalExpensesCents,
      netBurnCents,
      cacCents,
      grossMarginBps,
      runwayMonths,
      totalChurned,
      newCustomers,
      totalLeads,
      effectiveChurnBps,
      totalInflows,
      totalOutflows,
      fundingCents,
    },
  };

  return {
    newState,
    events,
    ledger,
    availableTermSheet:
      availableTermSheet && !decisions.acceptTermSheet ? availableTermSheet : null,
  };
}
