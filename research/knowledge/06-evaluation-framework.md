# Evaluation Framework — How Do We Know the Brain Works?
*New document, second pass only | Opus 4.7*

---

## 1. The Problem

Without measurement, no improvement. Every architectural change, new feature, and roadmap item is an assertion: "This will make the Brain better." But better at what, measurable how?

The first-pass analysis had no evaluation framework. This document provides one.

**Core claim:** The Brain is working if, for returning users, **session quality improves over time**. If this doesn't happen, nothing else matters.

---

## 2. The Session Quality Score (SQS)

A single metric that aggregates per-session outcomes into a comparable number.

### Components

```typescript
interface SessionQualityScore {
  value: number;  // 0-100
  components: {
    buildSuccess: number;           // 0 or 1, did build succeed on first attempt
    fileAcceptanceRate: number;     // 0-1, files accepted / files generated
    buildFixIterations: number;     // 0 = perfect, higher = worse (inverted)
    userFeedback: number;           // -1, 0, 1 (thumbs-down, none, thumbs-up)
    clarificationRounds: number;    // lower = better for returning users
    sessionDurationNormalized: number; // actual / expected given task complexity
    tokensUsedNormalized: number;   // actual / expected
  };
}
```

### Formula

```
SQS = 100 × (
    0.30 × buildSuccess +
    0.20 × fileAcceptanceRate +
    0.15 × min(1, 1 - (buildFixIterations / 5)) +  // 5+ iterations = 0
    0.15 × max(0, (userFeedback + 1) / 2) +         // -1 → 0, 0 → 0.5, 1 → 1
    0.10 × max(0, 1 - (clarificationRounds / 5)) +  // 0 = best, 5+ = 0
    0.05 × max(0, 1 - sessionDurationNormalized) +  // faster than expected is good
    0.05 × max(0, 1 - tokensUsedNormalized)         // cheaper than expected is good
)
```

### Why This Formula
- **Build success is weighted highest** — it's the fundamental outcome
- **File acceptance next** — measures code quality from user's perspective
- **Build fixes next** — measures first-try accuracy
- **User feedback next** — explicit signal, but sparse (most sessions have none)
- **Clarification, duration, tokens** — efficiency signals, weighted lower

### Normalization
"Expected" duration and tokens are calibrated per user per task type:
- Start with global averages as priors
- Update per-user after 20+ sessions
- Task type detected by `taskAnalyzer` in orchestrator

---

## 3. The Core Evaluation Hypothesis

**H1:** For a given user, mean SQS in month N+1 > mean SQS in month N.

If H1 holds consistently across the user base, the Brain is improving session quality over time. If H1 fails, the Brain is either not working, actively harmful, or neutral.

### Measurement Method

Track **rolling 30-day mean SQS per user**. Plot trajectory.

Aggregate across users:
- **% of users with positive 30-day trajectory** — should be > 60% if Brain is working
- **Median improvement per user per month** — should be > 2 points if Brain is working

---

## 4. A/B Testing Infrastructure

For every non-trivial change to the Brain (new extraction prompt, new retrieval ranking, new injection format), A/B test against control.

### The Harness

```typescript
interface BrainVariant {
  name: string;         // e.g., 'kea-v1-keywords', 'kea-v2-llm'
  config: {
    extractionMode: 'keyword' | 'llm';
    retrievalMode: 'jaccard' | 'semantic' | 'hybrid';
    injectionFormat: 'unstructured' | 'sectioned';
    confidenceFeedback: boolean;
    // ...
  };
}

interface ExperimentAssignment {
  userId: string;
  experimentId: string;
  variant: 'control' | 'treatment';
  assignedAt: Date;
}
```

On signup (or on experiment launch for existing users), each user is randomly assigned to control or treatment.

### Assignment Rules
- Assignments persist for the duration of the experiment (never switch mid-experiment)
- 50/50 split by default
- Power analysis: to detect a 3-point SQS difference at 80% power, need ~800 users per arm
- Experiments run minimum 4 weeks

### Measurements Per Experiment
- Per-user SQS (mean, median)
- Per-user SQS trajectory (slope over time)
- Task completion rate
- Session duration
- Token usage
- User retention (return rate week-over-week)
- User satisfaction (explicit feedback + NPS if available)

### Multiple Testing Correction
If running N simultaneous experiments, apply Bonferroni correction on significance thresholds.

---

## 5. Knowledge-Level Evaluation

Beyond per-session, evaluate individual knowledge items.

### Knowledge Health Metrics

For each pattern/skill:

```typescript
interface KnowledgeHealth {
  retrievalFrequency: number;          // How often is this retrieved
  retrievalPrecision: number;          // When retrieved, used in output?
  outcomeCorrelation: number;          // Sessions with this injected: SQS avg
  decayScore: number;                  // Current decay factor
  age: number;                         // Days since creation
  lastRetrieved: Date | null;
}
```

### Knowledge Quality Scoreboard
Top-20 highest-quality patterns (by outcome correlation) and bottom-20 lowest-quality (candidates for purge).

### Auto-Purge Candidates
Patterns meeting all of:
- Age > 90 days
- Retrieval frequency < 1/month
- Outcome correlation < mean SQS

---

## 6. Extraction Quality Evaluation

Evaluate the KEA itself:

### Precision
Of the findings KEA extracts, what fraction are:
- **Useful** (retrieved and led to positive outcomes in future sessions)
- **Correct but unused** (never retrieved)
- **Incorrect** (retrieved but led to negative outcomes)
- **Noise** (generic, duplicates, non-actionable)

Target: Useful + Correct > 80%, Incorrect + Noise < 20%

### Recall
For a given session, how many relevant findings could have been extracted but weren't?

Measurement method: manual inspection of 50 random sessions. Score KEA output against human-extracted ground truth. Compute precision/recall.

### Per-Type Precision
Different KEA finding types (reflex, recipe, heuristic, principle, anti-principle) may have different quality profiles. Evaluate separately.

---

## 7. Retrieval Quality Evaluation

Evaluate the KRA:

### NDCG@5 (Normalized Discounted Cumulative Gain at top 5)
Standard IR metric. For a set of test queries with known relevance, compute how well the KRA ranks truly-relevant items in the top 5.

### Construction of the Test Set
- Sample 100 session prompts from the past
- For each, human-label top-10 knowledge items by relevance (using gold standard)
- Compute NDCG@5 of the current retrieval

### Latency
- p50 latency < 100ms
- p99 latency < 500ms
- If latency degrades, investigate before shipping

---

## 8. Injection Effectiveness Evaluation

The AI gets knowledge injected; does it actually *use* it?

### Measurement: Use Rate Per Injection
After a session where X was injected:
- Does the AI's output reflect X?
- Use simple check: keyword/phrase match from X to AI output
- More sophisticated: LLM-judge scoring of whether the output follows X

Target: Use rate > 60% of injections

### Injection Format A/B Test
Test two or more injection formats (unstructured blob vs. structured sections) to see which has higher use rate.

---

## 9. Minimum Viable Evaluation Loop

Before building everything in sections 4-8, ship this:

### Week 1: SQS Implementation
- Compute SQS for every session
- Store in `SessionQualityScore` table
- Display on dashboard as "Session Quality Trend"

### Week 2: User Trajectory Tracking
- Rolling 30-day mean per user
- Trajectory slope
- Dashboard: per-user SQS chart

### Week 3: Manual A/B Test
- Flip feature flag for 50 users: new extraction prompt for them, old for everyone else
- After 2 weeks, compare SQS
- Go/no-go decision based on results

### Week 4: Instrument Knowledge Health
- For each pattern/skill, compute retrieval frequency, outcome correlation
- Surface to admin dashboard: "top quality", "bottom quality"
- Manual curation of bottom-20

This minimum loop provides enough signal to direct all further investment.

---

## 10. Evaluation Dashboard

New admin dashboard section at `/admin/brain-evaluation`:

```
┌─ Brain Health Overview ──────────────────────────────────┐
│                                                          │
│ Active users: 1,247                                      │
│ Users with positive SQS trajectory: 68% ✅ (target: >60%)│
│ Median monthly SQS improvement: +3.2 ✅ (target: >+2)    │
│                                                          │
│ Knowledge base:                                          │
│   Total patterns: 12,450                                 │
│   High-quality (>mean SQS correlation): 2,890 (23%)      │
│   Purge candidates: 1,120 (9%)                           │
│                                                          │
│ KEA precision: 73% (last 30 days)                        │
│ KRA NDCG@5: 0.62 (last 100 queries)                      │
│ Injection use rate: 58%                                  │
│                                                          │
│ Active experiments:                                      │
│   [ex_2026_apr_kea_v2]: T=+2.1 SQS, p=0.03 (significant) │
│   [ex_2026_apr_retrieval_hybrid]: T=+4.8 SQS, p<0.001    │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

This is the dashboard that engineering and product use to know if the Brain is working.

---

## 11. What NOT to Optimize For

Measuring the wrong things leads to building the wrong things.

**Don't primarily optimize for:**
- **Number of patterns learned** — grows trivially; more can be worse
- **Number of skills created** — same problem
- **Time on platform** — optimizes engagement, not value
- **User feedback rate** — users rarely give feedback; absence isn't negative
- **Dashboard engagement** — using the dashboard is good but orthogonal to Brain quality

**Do optimize for:**
- **SQS trajectory** — the core claim
- **Retention** — users stay if the Brain helps them
- **Returning user first-session-of-month SQS** vs. cold-start SQS — this is the Brain's value proposition quantified

---

## 12. The Counterfactual Question

How do we know the Brain is *causing* the improvement (and not, say, users getting more skilled at prompting)?

### Approach 1: The "Brain Off" Control
Hold back a cohort of users who never get Brain features (or get them 6 months later). Compare SQS trajectories.
- Ethical issue: intentionally giving users worse experience
- Practical issue: users may notice and churn

### Approach 2: The Fresh User Cohort Analysis
Compare month-1 SQS of users joining today (full Brain from day 1) vs. users who joined a year ago (had no Brain month 1).
- Naturally occurring experiment, no ethical issue
- Confound: product has improved in other ways too

### Approach 3: Within-User Ablation
Periodically run sessions with "Brain bypass" mode (no injection). Compare SQS within user.
- Cleanest signal
- User annoyance: their session is artificially worse

**Recommendation:** Start with Approach 2 (free). Graduate to Approach 3 after 6 months, with explicit opt-in ("help improve the Brain by participating in 1 benchmark session per month").

---

## 13. Bottom Line

An evaluation framework is not a nice-to-have. Without it, every change to the Brain is a belief, not a measurement. With it:

- Good changes get shipped with confidence
- Bad changes get rolled back quickly
- The product story becomes quantitative: "Users' SQS improves 8% month-over-month on average"
- Priorities become evidence-based, not argument-based

**Ship the minimum viable evaluation loop first** (Section 9). Let it generate data for 4 weeks. Then make all further Brain investment decisions using SQS data.
