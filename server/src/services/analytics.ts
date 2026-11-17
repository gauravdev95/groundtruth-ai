import { pool } from "../config/db";
import { getOrCreateRecruiterForUser } from "./recruiter";

/**
 * Recruiter analytics service — Phase 6.
 *
 * Every number is a straight aggregate over the recruiter's OWN company's
 * jobs / applications / matches (same ownership rule as the dashboard in
 * services/recruiter.ts). Empty tables produce 0s, nulls and empty lists —
 * never invented statistics. The old repo's analytics
 * (apps/backend/src/domains/pipeline/analytics.py) is the spec this
 * follows: funnel counts, per-stage conversion, time-to-first-response
 * from the audit trail, and a daily activity series with zero-filled
 * days.
 *
 * Honesty rules, all deliberate:
 * - Conversion is null when its base is 0 (a dash in the UI), not 0%.
 *   A stage nobody reached is "no data yet", not a 0% conversion.
 * - The funnel is cumulative over CURRENT statuses of non-rejected,
 *   non-withdrawn applications ("reached at least this stage"). An
 *   application rejected after reaching interview is NOT counted as
 *   having reached interview — its earlier stages are not recoverable
 *   from current status alone. Same documented limitation as the old
 *   repo; the history table only exists from Phase 6, so replaying it
 *   would still undercount pre-Phase-6 moves.
 * - Time to first response comes from `application_status_history`
 *   (written by updateApplicationStatus since Phase 6): the first
 *   applied → * move minus the application's created_at. Applications
 *   moved before Phase 6 have no history row and are excluded; when no
 *   application has a recorded first move the value is null.
 * - The activity series covers the last 30 days with zero-filled days,
 *   so a quiet week reads as a quiet week, not a flat busy line.
 */

export const ANALYTICS_WINDOW_DAYS = 30;

export type AnalyticsStatus =
  | "applied"
  | "reviewing"
  | "interview"
  | "offer"
  | "rejected"
  | "withdrawn";

export const ANALYTICS_STATUSES: AnalyticsStatus[] = [
  "applied",
  "reviewing",
  "interview",
  "offer",
  "rejected",
  "withdrawn",
];

/** Funnel stages in forward order (rejected/withdrawn are side-exits). */
export const FUNNEL_STAGES = [
  "applied",
  "reviewing",
  "interview",
  "offer",
] as const;

export type FunnelStage = (typeof FUNNEL_STAGES)[number];

/**
 * Conversion between two funnel stages, or null when nobody reached the
 * base stage yet. Pure — unit-tested in tests/analytics.test.ts.
 */
export function conversionRate(reachedNext: number, reachedBase: number): number | null {
  if (reachedBase <= 0) return null;
  return Math.round((reachedNext / reachedBase) * 10000) / 10000;
}

/**
 * Cumulative "reached at least this stage" counts from current-status
 * counts, over non-rejected / non-withdrawn applications. Pure —
 * unit-tested. E.g. { applied: 2, reviewing: 5, interview: 1, offer: 1 }
 * means 9 applications reached at least applied, 7 at least reviewing,
 * 2 at least interview, 1 at least offer.
 */
export function funnelReached(
  byStatus: Record<string, number>,
): Record<FunnelStage, number> {
  let running = 0;
  for (const stage of FUNNEL_STAGES) running += byStatus[stage] ?? 0;
  const reached = {} as Record<FunnelStage, number>;
  for (const stage of FUNNEL_STAGES) {
    reached[stage] = running;
    running -= byStatus[stage] ?? 0;
  }
  return reached;
}

export interface AnalyticsJobRow {
  id: string;
  title: string;
  status: string;
  created_at: string;
  applications: number;
  by_status: Record<AnalyticsStatus, number>;
}

export interface ActivityPoint {
  date: string;
  applications: number;
  matches: number;
}

export interface RecruiterAnalytics {
  company: { id: string; name: string } | null;
  counts: {
    jobs_total: number;
    jobs_open: number;
    jobs_closed: number;
    jobs_draft: number;
    applications: number;
    matches: number;
    interviews: number;
    applicants: number;
  };
  by_status: Record<AnalyticsStatus, number>;
  funnel: {
    reached: Record<FunnelStage, number>;
    conversion: {
      applied_to_reviewing: number | null;
      reviewing_to_interview: number | null;
      interview_to_offer: number | null;
    };
  };
  /** Average hours from application to the recruiter's first pipeline
   * move, or null when no application has a recorded first move yet. */
  avg_time_to_first_response_hours: number | null;
  /** How many applications the average above is based on. */
  first_response_sample: number;
  by_job: AnalyticsJobRow[];
  activity: { window_days: number; series: ActivityPoint[] };
  verification: {
    applicants: number;
    github_checked: number;
    coding_profiles: number;
    coding_verified: number;
  };
}

function emptyByStatus(): Record<AnalyticsStatus, number> {
  return {
    applied: 0,
    reviewing: 0,
    interview: 0,
    offer: 0,
    rejected: 0,
    withdrawn: 0,
  };
}

function emptyAnalytics(): RecruiterAnalytics {
  return {
    company: null,
    counts: {
      jobs_total: 0,
      jobs_open: 0,
      jobs_closed: 0,
      jobs_draft: 0,
      applications: 0,
      matches: 0,
      interviews: 0,
      applicants: 0,
    },
    by_status: emptyByStatus(),
    funnel: {
      reached: { applied: 0, reviewing: 0, interview: 0, offer: 0 },
      conversion: {
        applied_to_reviewing: null,
        reviewing_to_interview: null,
        interview_to_offer: null,
      },
    },
    avg_time_to_first_response_hours: null,
    first_response_sample: 0,
    by_job: [],
    activity: {
      window_days: ANALYTICS_WINDOW_DAYS,
      series: activitySeries([], [], ANALYTICS_WINDOW_DAYS),
    },
    verification: {
      applicants: 0,
      github_checked: 0,
      coding_profiles: 0,
      coding_verified: 0,
    },
  };
}

/**
 * Zero-filled daily series for the last `windowDays` days (today
 * included). Pure — unit-tested. `applications` / `matches` are
 * `{ date: 'YYYY-MM-DD', count }` rows from the DB; days with no rows
 * read as 0, never omitted.
 */
export function activitySeries(
  applicationDays: { date: string; count: string | number }[],
  matchDays: { date: string; count: string | number }[],
  windowDays: number,
  today: Date = new Date(),
): ActivityPoint[] {
  const appByDate = new Map(
    applicationDays.map((r) => [r.date.slice(0, 10), Number(r.count)]),
  );
  const matchByDate = new Map(
    matchDays.map((r) => [r.date.slice(0, 10), Number(r.count)]),
  );
  const series: ActivityPoint[] = [];
  const day = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
  );
  day.setUTCDate(day.getUTCDate() - (windowDays - 1));
  for (let i = 0; i < windowDays; i += 1) {
    const iso = day.toISOString().slice(0, 10);
    series.push({
      date: iso,
      applications: appByDate.get(iso) ?? 0,
      matches: matchByDate.get(iso) ?? 0,
    });
    day.setUTCDate(day.getUTCDate() + 1);
  }
  return series;
}

export async function loadRecruiterAnalytics(
  userId: string,
): Promise<RecruiterAnalytics> {
  const { company } = await getOrCreateRecruiterForUser(userId);
  if (!company) return emptyAnalytics();

  const [countsRes, statusRes, jobsRes, jobStatusRes, appDaysRes, matchDaysRes, responseRes, verificationRes] =
    await Promise.all([
      pool.query<{
        jobs_total: string;
        jobs_open: string;
        jobs_closed: string;
        jobs_draft: string;
        applications: string;
        matches: string;
        interviews: string;
        applicants: string;
      }>(
        `SELECT
           (SELECT count(*) FROM jobs WHERE company_id = $1) AS jobs_total,
           (SELECT count(*) FROM jobs WHERE company_id = $1 AND status = 'open') AS jobs_open,
           (SELECT count(*) FROM jobs WHERE company_id = $1 AND status = 'closed') AS jobs_closed,
           (SELECT count(*) FROM jobs WHERE company_id = $1 AND status = 'draft') AS jobs_draft,
           (SELECT count(*) FROM applications a JOIN jobs j ON j.id = a.job_id WHERE j.company_id = $1) AS applications,
           (SELECT count(*) FROM matches m JOIN jobs j ON j.id = m.job_id WHERE j.company_id = $1) AS matches,
           (SELECT count(*) FROM interviews i JOIN jobs j ON j.id = i.job_id WHERE j.company_id = $1) AS interviews,
           (SELECT count(DISTINCT a.candidate_id) FROM applications a JOIN jobs j ON j.id = a.job_id WHERE j.company_id = $1) AS applicants`,
        [company.id],
      ),
      pool.query<{ status: string; count: string }>(
        `SELECT a.status, count(*) AS count
         FROM applications a JOIN jobs j ON j.id = a.job_id
         WHERE j.company_id = $1 GROUP BY a.status`,
        [company.id],
      ),
      pool.query<{ id: string; title: string; status: string; created_at: string }>(
        `SELECT id, title, status, created_at FROM jobs
         WHERE company_id = $1 ORDER BY created_at DESC`,
        [company.id],
      ),
      pool.query<{ job_id: string; status: string; count: string }>(
        `SELECT a.job_id, a.status, count(*) AS count
         FROM applications a JOIN jobs j ON j.id = a.job_id
         WHERE j.company_id = $1 GROUP BY a.job_id, a.status`,
        [company.id],
      ),
      pool.query<{ date: string; count: string }>(
        `SELECT to_char(a.created_at, 'YYYY-MM-DD') AS date, count(*) AS count
         FROM applications a JOIN jobs j ON j.id = a.job_id
         WHERE j.company_id = $1 AND a.created_at >= now() - ($2 || ' days')::interval
         GROUP BY date ORDER BY date`,
        [company.id, String(ANALYTICS_WINDOW_DAYS)],
      ),
      pool.query<{ date: string; count: string }>(
        `SELECT to_char(m.created_at, 'YYYY-MM-DD') AS date, count(*) AS count
         FROM matches m JOIN jobs j ON j.id = m.job_id
         WHERE j.company_id = $1 AND m.created_at >= now() - ($2 || ' days')::interval
         GROUP BY date ORDER BY date`,
        [company.id, String(ANALYTICS_WINDOW_DAYS)],
      ),
      pool.query<{ sample: string; avg_hours: string | null }>(
        `SELECT count(*) AS sample,
                avg(extract(epoch FROM (f.first_move - a.created_at)) / 3600) AS avg_hours
         FROM (
           SELECT DISTINCT ON (h.application_id) h.application_id, h.created_at AS first_move
           FROM application_status_history h
           JOIN applications a ON a.id = h.application_id
           JOIN jobs j ON j.id = a.job_id
           WHERE j.company_id = $1 AND h.from_status = 'applied'
           ORDER BY h.application_id, h.created_at
         ) f JOIN applications a ON a.id = f.application_id`,
        [company.id],
      ),
      pool.query<{
        applicants: string;
        github_checked: string;
        coding_profiles: string;
        coding_verified: string;
      }>(
        `SELECT
           (SELECT count(DISTINCT a.candidate_id) FROM applications a JOIN jobs j ON j.id = a.job_id WHERE j.company_id = $1) AS applicants,
           (SELECT count(DISTINCT a.candidate_id) FROM applications a JOIN jobs j ON j.id = a.job_id JOIN verification_results v ON v.candidate_id = a.candidate_id AND v.source = 'github' WHERE j.company_id = $1) AS github_checked,
           (SELECT count(*) FROM candidate_coding_profiles cp WHERE cp.candidate_id IN (SELECT DISTINCT a.candidate_id FROM applications a JOIN jobs j ON j.id = a.job_id WHERE j.company_id = $1)) AS coding_profiles,
           (SELECT count(*) FROM candidate_coding_profiles cp WHERE cp.verification_status = 'verified' AND cp.candidate_id IN (SELECT DISTINCT a.candidate_id FROM applications a JOIN jobs j ON j.id = a.job_id WHERE j.company_id = $1)) AS coding_verified`,
        [company.id],
      ),
    ]);

  const c = countsRes.rows[0] as {
    jobs_total: string;
    jobs_open: string;
    jobs_closed: string;
    jobs_draft: string;
    applications: string;
    matches: string;
    interviews: string;
    applicants: string;
  };
  const byStatus = emptyByStatus();
  for (const row of statusRes.rows) {
    if ((ANALYTICS_STATUSES as string[]).includes(row.status)) {
      byStatus[row.status as AnalyticsStatus] = Number(row.count);
    }
  }

  const reached = funnelReached(byStatus);
  const byJob: AnalyticsJobRow[] = jobsRes.rows.map((job) => {
    const rowByStatus = emptyByStatus();
    let total = 0;
    for (const r of jobStatusRes.rows) {
      if (r.job_id === job.id) {
        rowByStatus[r.status as AnalyticsStatus] = Number(r.count);
        total += Number(r.count);
      }
    }
    return {
      id: job.id,
      title: job.title,
      status: job.status,
      created_at: job.created_at,
      applications: total,
      by_status: rowByStatus,
    };
  });

  const responseRow = responseRes.rows[0] as {
    sample: string;
    avg_hours: string | null;
  };
  const v = verificationRes.rows[0] as {
    applicants: string;
    github_checked: string;
    coding_profiles: string;
    coding_verified: string;
  };

  return {
    company: { id: company.id, name: company.name },
    counts: {
      jobs_total: Number(c.jobs_total),
      jobs_open: Number(c.jobs_open),
      jobs_closed: Number(c.jobs_closed),
      jobs_draft: Number(c.jobs_draft),
      applications: Number(c.applications),
      matches: Number(c.matches),
      interviews: Number(c.interviews),
      applicants: Number(c.applicants),
    },
    by_status: byStatus,
    funnel: {
      reached,
      conversion: {
        applied_to_reviewing: conversionRate(reached.reviewing, reached.applied),
        reviewing_to_interview: conversionRate(reached.interview, reached.reviewing),
        interview_to_offer: conversionRate(reached.offer, reached.interview),
      },
    },
    avg_time_to_first_response_hours:
      responseRow.avg_hours === null
        ? null
        : Math.round(Number(responseRow.avg_hours) * 100) / 100,
    first_response_sample: Number(responseRow.sample),
    by_job: byJob,
    activity: {
      window_days: ANALYTICS_WINDOW_DAYS,
      series: activitySeries(appDaysRes.rows, matchDaysRes.rows, ANALYTICS_WINDOW_DAYS),
    },
    verification: {
      applicants: Number(v.applicants),
      github_checked: Number(v.github_checked),
      coding_profiles: Number(v.coding_profiles),
      coding_verified: Number(v.coding_verified),
    },
  };
}
