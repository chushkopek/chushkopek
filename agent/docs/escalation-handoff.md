# Escalation handoff — documentation standard (for L2)

**TL;DR — every escalation handoff to L2 MUST be documented.** The L1 agent does
not "close" incidents; it hands them up. A handoff is only useful if L2 can, in
under a minute, see *what broke*, *which of the three things it is*, *why we
think so*, and *what to do next*. Two sections are non-negotiable: the
**classification + reasoning** and the **external-events search verdict**.

This standard maps 1:1 onto the `escalate` tool's structured report
([src/tools/escalate.ts](../src/tools/escalate.ts)) and how it is rendered to the
handoff file, Slack, and PagerDuty.

---

## Required sections

| Section | Field(s) | Must contain |
|---|---|---|
| **Header** | `severity`, `summary`, `current_state` | One-line what/where/impact + sev1–4 + current state (ongoing/mitigated/degraded). |
| **Affected** | `affected_systems`, `suggested_owner`, `owner_source` | Impacted services/components + the owning team and **how** it was derived (e.g. `CODEOWNERS:/src/profile/`). |
| **Classification + reasoning** ⭐ | `incident_class`, `confidence`, `root_cause_hypothesis`, `suspected_change` | The 3-way verdict **and the evidence chain that justifies it** (see below). |
| **Search verdict** ⭐ | `external_factors`, `traffic_assessment` | The external-events search result and how it affected the classification (see below). |
| **Evidence** | `evidence_links` | Links to dashboards, logs, commits/PRs, and search citations backing the above. |
| **Actions taken** | `actions_taken[]` | Every L1 action + its result. Empty is fine (and expected for non-runbook incidents). |
| **Next steps** | `recommended_next_steps[]` | Concrete, ordered actions for the receiving L2/SRE/owner. |

⭐ = the two sections this standard exists to enforce.

---

## ⭐ Classification + reasoning (required)

State **one** `incident_class` and *show your work*. The class is one of:

- `attack` — malicious exploit/abuse,
- `bug_or_regression` — a single bad change/deploy,
- `external_or_organic` — a real-world event/trend (surge, launch, upstream
  outage, advisory), not an attack or a code bug,
- `inconclusive` — evidence does not support a single class.

The reasoning must make the verdict **falsifiable**, covering:

1. **What points to this class** — the specific evidence (metrics, the suspected
   change, traffic shape) with `confidence` (low/medium/high).
2. **What was ruled out** — name the *other* classes you considered and the
   evidence that excluded them. An escalation that only argues *for* its verdict
   is incomplete.
3. **The suspected change** (`suspected_change`) when relevant — the commit/PR/
   deploy, with a timeline tying it to onset.

> Rule: if the evidence is contradictory (e.g. an external event exists *and*
> internal signals point to a bug/attack), document **both** and explain which
> won and why. Do not hide the tension — L2 needs it.

---

## ⭐ Search verdict (required)

Every handoff records the **external-events search** result, even when it didn't
change the outcome. This is what stops L2 from re-litigating "but could it just
be Black Friday?" `external_factors` MUST state:

1. **The verdict** — `found` / `none` / `inconclusive` (from the
   `external_events` investigator).
2. **What was found** — the real-world event/trend, **with citations** (URLs).
   "none found" is a valid, required answer — say it explicitly.
3. **How it affected the classification** — did it support, weaken, or get ruled
   out as the cause? Tie it to `traffic_assessment`
   (`organic_surge` / `likely_attack` / `inconclusive`).

> Why required: the third hypothesis (organic/external) is invisible in internal
> telemetry. Recording the search verdict — found *or* none — is the only proof
> L2 has that it was checked at all.

---

## Worked example (storefront)

```
# INCIDENT ESCALATION [SEV1]
Summary: storefront fully down (0/3 targets), OOM CrashLoop since 14:02Z.
Current state: ongoing
Suggested owner: @acme/frontend-team (CODEOWNERS:/src/profile/)

Incident class: attack
Root-cause hypothesis: PR #482 (a1b2c3d) shipped unsanitized HTML bio rendering;
  crafted oversized payloads to POST /profile exhaust memory → OOMKill. [confidence: high]
Traffic assessment: likely_attack
External factors: Amazon Prime Day drove industry-wide e-commerce surges
  (TechCrunch: https://techcrunch.com/2025/07/14/prime-day-…) — RULED OUT here:
  traffic is at baseline (1,320 vs 1,250 RPM); the 6-IP/single-ASN crafted-payload
  pattern is exploitation, not organic load.
Suspected change: PR #482 / a1b2c3d, merged 13:56Z, deployed 14:01Z

Affected systems:
  - storefront (profile component, POST /profile)
Evidence:
  - https://grafana.acme.internal/d/storefront/overview
  - https://github.com/acme/storefront/pull/482
Actions taken by L1 agent:
  - (none — escalated without acting)
Recommended next steps:
  - Roll back / revert a1b2c3d on storefront
  - Add input sanitization + payload size limits to the bio field
  - Rate-limit / block the offending ASN at the edge
```

Note how the example documents the search verdict (`found` → Prime Day) **and**
explains it was ruled out — that is the standard, not an optional extra.

---

## Where it shows up

The same fields render across all three handoff surfaces, so the documentation
is consistent everywhere:

- **Handoff file** — `agent/escalations/escalation-*.md` (full report).
- **Slack** — class + suspected cause + external factors in the channel post.
- **PagerDuty** — `incident_class`, `root_cause_hypothesis`, `external_factors`
  in the alert details.
