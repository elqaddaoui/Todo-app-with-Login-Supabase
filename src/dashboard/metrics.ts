/* ============================================================
   Progress Dashboard — metric calculation layer
   ------------------------------------------------------------
   Every number rendered by the Progress Dashboard is produced here, from
   the app's REAL task/project data. No synthetic values, no unexplained
   "productivity scores". Each exported function documents its formula so
   the UI can surface the same explanation in a tooltip.

   Core ideas
   ----------
   * Projects ARE the user's goals — there is no separate goal entity.
   * Project progress is DURATION-WEIGHTED:
         completed estimated workload / total estimated workload
     Tasks without an estimate fall back to DEFAULT_TASK_WEIGHT (the same
     default the app applies when creating a task).
   * Parent tasks and their subtasks are never double-counted: only LEAF
     tasks carry weight. A parent's own estimate is treated as the sum of
     its children.
   * History is reconstructed from `createdAt` / `completedAt`, so progress
     at any past instant is derivable without a separate snapshot table.
     Caveat (surfaced in the UI): estimates are read at their CURRENT value
     because the app does not version them.
   ============================================================ */

import type { Project, Task } from '../data/types'

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

/** Default weight (minutes) for a task with no estimate. Mirrors the
 *  `estimatedMinutes ?? 60` default used when a task is created. */
export const DEFAULT_TASK_WEIGHT = 60

/** Periods offered by the dashboard's period selector. */
export const PERIODS = [3, 7, 15, 30] as const
export type PeriodDays = (typeof PERIODS)[number]

/** Which series the progress-trend chart plots. */
export type TrendMetric = 'progress' | 'completed' | 'workload'

export const TREND_METRICS: { key: TrendMetric; label: string; unit: string }[] = [
  { key: 'progress', label: 'Progress change', unit: 'pp' },
  { key: 'completed', label: 'Tasks completed', unit: 'tasks' },
  { key: 'workload', label: 'Estimated workload', unit: 'min' },
]

/** Maximum number of individual project lines drawn on the trend chart
 *  before the remainder is folded into a single "Other" series. */
export const MAX_TREND_SERIES = 5

/** Health verdicts a project can receive. Never communicated by colour
 *  alone — every badge renders an icon + text label too. */
export type HealthState =
  | 'completed'
  | 'on_track'
  | 'at_risk'
  | 'behind'
  | 'inactive'
  | 'no_deadline'

export const HEALTH_META: Record<HealthState, { label: string; tone: 'good' | 'warn' | 'bad' | 'neutral'; rank: number }> = {
  behind: { label: 'Behind', tone: 'bad', rank: 0 },
  at_risk: { label: 'At risk', tone: 'warn', rank: 1 },
  inactive: { label: 'Inactive', tone: 'warn', rank: 2 },
  no_deadline: { label: 'No deadline', tone: 'neutral', rank: 3 },
  on_track: { label: 'On track', tone: 'good', rank: 4 },
  completed: { label: 'Completed', tone: 'good', rank: 5 },
}

/* ------------------------------------------------------------------ */
/* Small date helpers (local-time, no external deps)                    */
/* ------------------------------------------------------------------ */

const pad = (n: number) => (n < 10 ? `0${n}` : String(n))

/** `yyyy-MM-dd` in LOCAL time (task.dueDate uses the same convention). */
export const dayKey = (d: Date): string =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

export const startOfDay = (d: Date): Date =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0)

/** Exclusive end of day — i.e. 00:00 of the following day. */
export const endOfDay = (d: Date): Date =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0, 0)

export const addDays = (d: Date, n: number): Date =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, 0, 0, 0, 0)

/** Parse an ISO timestamp to epoch ms; `null` when absent/invalid. */
const ms = (iso?: string | null): number | null => {
  if (!iso) return null
  const t = Date.parse(iso)
  return Number.isFinite(t) ? t : null
}

/** Parse a `yyyy-MM-dd` date string as LOCAL midnight. */
export const parseDayKey = (key: string): Date => {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1, 0, 0, 0, 0)
}

/* ------------------------------------------------------------------ */
/* Period window                                                       */
/* ------------------------------------------------------------------ */

export type PeriodWindow = {
  days: PeriodDays
  /** Inclusive list of local calendar days covered by the period. */
  dayKeys: string[]
  /** Local midnight at the first day of the period (epoch ms). */
  startMs: number
  /** Exclusive upper bound — now, so "today so far" is included. */
  endMs: number
  /** Same-length window immediately preceding this one. */
  prev: { startMs: number; endMs: number; dayKeys: string[] }
}

/**
 * Build the analysis window for a period length.
 *
 * A period of N days ends TODAY (inclusive) and starts at local midnight
 * N-1 days ago, so "7D" always means "this day plus the six before it".
 * The previous period is the immediately preceding window of equal length,
 * which is what the "Compare to previous period" toggle measures against.
 */
export function buildPeriod(days: PeriodDays, now: Date = new Date()): PeriodWindow {
  const today = startOfDay(now)
  const start = addDays(today, -(days - 1))
  const dayKeys: string[] = []
  for (let i = 0; i < days; i++) dayKeys.push(dayKey(addDays(start, i)))

  const prevStart = addDays(start, -days)
  const prevDayKeys: string[] = []
  for (let i = 0; i < days; i++) prevDayKeys.push(dayKey(addDays(prevStart, i)))

  return {
    days,
    dayKeys,
    startMs: start.getTime(),
    endMs: now.getTime(),
    prev: { startMs: prevStart.getTime(), endMs: start.getTime(), dayKeys: prevDayKeys },
  }
}

/* ------------------------------------------------------------------ */
/* Weighting: leaf tasks only                                          */
/* ------------------------------------------------------------------ */

export type WeightedTask = {
  id: string
  projectId?: string
  /** Effective weight in minutes used by every progress formula. */
  weight: number
  createdMs: number
  completedMs: number | null
  /** Current status is `done` (authoritative "is complete right now"). */
  done: boolean
  cancelled: boolean
  task: Task
}

/** A task counts toward progress only if it is not archived and not
 *  cancelled — cancelled work is out of scope, not outstanding. */
const countsForProgress = (t: Task) => !t.archived && t.status !== 'cancelled'

/**
 * Reduce the task tree to the set of weight-bearing LEAF tasks.
 *
 * Why leaves only: a parent task's estimate conceptually covers the work of
 * its subtasks. Counting both would double-count the same effort and make a
 * project look larger (and its progress smaller) than it really is.
 */
export function buildWeightedTasks(tasks: Task[]): WeightedTask[] {
  const hasChild = new Set<string>()
  for (const t of tasks) {
    if (t.parentId && countsForProgress(t)) hasChild.add(t.parentId)
  }
  const out: WeightedTask[] = []
  for (const t of tasks) {
    if (!countsForProgress(t)) continue
    if (hasChild.has(t.id)) continue // parent — its children carry the weight
    const created = ms(t.createdAt) ?? 0
    const completed = t.status === 'done' ? (ms(t.completedAt) ?? created) : null
    out.push({
      id: t.id,
      projectId: t.projectId,
      weight: t.estimatedMinutes && t.estimatedMinutes > 0 ? t.estimatedMinutes : DEFAULT_TASK_WEIGHT,
      createdMs: created,
      completedMs: completed,
      done: t.status === 'done',
      cancelled: t.status === 'cancelled',
      task: t,
    })
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Progress                                                            */
/* ------------------------------------------------------------------ */

/**
 * Duration-weighted completion of a task set at a point in time.
 *
 *      progress = completed estimated workload / total estimated workload
 *
 * `atMs` reconstructs the past: only tasks created at/before that instant
 * are in scope, and only completions recorded at/before it count. Returns a
 * 0–100 percentage, or `null` when the set was empty (no scope = no
 * meaningful percentage, which the UI renders as "—" instead of 0%).
 */
export function weightedProgressAt(items: WeightedTask[], atMs: number): number | null {
  let total = 0
  let done = 0
  for (const it of items) {
    if (it.createdMs > atMs) continue
    total += it.weight
    if (it.completedMs != null && it.completedMs <= atMs) done += it.weight
  }
  if (total <= 0) return null
  return (done / total) * 100
}

/** Convenience: progress right now (equivalent to `weightedProgressAt(…, Date.now())`). */
export const weightedProgressNow = (items: WeightedTask[]) => weightedProgressAt(items, Date.now())

/**
 * Progress gain across a window, expressed in PERCENTAGE POINTS (pp).
 *
 *      gain = progress(end) - progress(start)
 *
 * pp — not "%" — because it is the difference between two percentages.
 * Gain can be negative: adding new work to a project genuinely lowers its
 * completion ratio, and hiding that would misrepresent progress.
 */
export function progressGain(items: WeightedTask[], startMs: number, endMs: number): number | null {
  const before = weightedProgressAt(items, startMs)
  const after = weightedProgressAt(items, endMs)
  if (after == null) return null
  return after - (before ?? 0)
}

/* ------------------------------------------------------------------ */
/* Per-day series                                                      */
/* ------------------------------------------------------------------ */

export type DayPoint = {
  dayKey: string
  /** Progress delta (pp) attributable to that calendar day. */
  progress: number
  /** Cumulative project progress (%) at the end of that day. */
  progressAbs: number | null
  /** Tasks (leaves) completed that day. */
  completed: number
  /** Estimated workload (minutes) of the tasks completed that day. */
  workload: number
  /** Tasks created that day. */
  added: number
  /** True when the day qualifies as an "active day" (see `isActiveDay`). */
  active: boolean
}

/**
 * Build the daily series for a task set over the period's calendar days.
 *
 * `progress` is the day-over-day change in duration-weighted completion, so
 * summing the series reproduces the headline progress gain exactly.
 */
export function buildDaySeries(items: WeightedTask[], dayKeys: string[], nowMs = Date.now()): DayPoint[] {
  const points: DayPoint[] = []
  let prevProgress: number | null = null

  for (let i = 0; i < dayKeys.length; i++) {
    const key = dayKeys[i]
    const dayStart = parseDayKey(key).getTime()
    const dayEnd = Math.min(endOfDay(parseDayKey(key)).getTime(), nowMs)

    if (i === 0) prevProgress = weightedProgressAt(items, dayStart)

    const progressAbs: number | null = dayEnd <= dayStart ? prevProgress : weightedProgressAt(items, dayEnd)

    let completed = 0
    let workload = 0
    let added = 0
    for (const it of items) {
      if (it.completedMs != null && it.completedMs >= dayStart && it.completedMs < dayEnd) {
        completed += 1
        workload += it.weight
      }
      if (it.createdMs >= dayStart && it.createdMs < dayEnd) added += 1
    }

    const delta = progressAbs != null && prevProgress != null ? progressAbs - prevProgress : 0
    points.push({
      dayKey: key,
      progress: delta,
      progressAbs,
      completed,
      workload,
      added,
      // An "active day" requires real forward motion — see isActiveDay().
      active: isActiveDay({ completed, progressDelta: delta }),
    })
    prevProgress = progressAbs ?? prevProgress
  }

  return points
}

/**
 * Active-day rule.
 *
 * A day is active when the user actually MOVED WORK FORWARD on it:
 *   * completed at least one task / subtask / milestone, or
 *   * meaningfully increased project progress (≥ 0.5 pp).
 *
 * Passive interactions — opening a task, renaming it, dragging it, changing
 * a filter — deliberately do NOT count, so the streak reflects output rather
 * than app usage.
 */
export const ACTIVE_DAY_MIN_PP = 0.5
export function isActiveDay(day: { completed: number; progressDelta: number }): boolean {
  return day.completed > 0 || day.progressDelta >= ACTIVE_DAY_MIN_PP
}

/* ------------------------------------------------------------------ */
/* Task-level predicates                                               */
/* ------------------------------------------------------------------ */

/** Open task whose due date is strictly before today. Mirrors the app's
 *  existing `overdue()` predicate so both views always agree. */
export function isOverdue(t: Task, todayKey: string = dayKey(new Date())): boolean {
  if (!t.dueDate) return false
  if (t.status === 'done' || t.status === 'cancelled') return false
  if (t.archived) return false
  return t.dueDate < todayKey
}

/** Open task with neither a date nor an explicit estimate — invisible work
 *  that cannot be scheduled or forecast. */
export function isUnplanned(t: Task): boolean {
  if (t.status === 'done' || t.status === 'cancelled' || t.archived) return false
  return !t.dueDate && !t.startDate && !t.estimatedMinutes
}

/* ------------------------------------------------------------------ */
/* Project-level metrics                                               */
/* ------------------------------------------------------------------ */

export type ProjectMetrics = {
  project: Project
  /** Weight-bearing leaf tasks belonging to the project. */
  items: WeightedTask[]
  /** Duration-weighted completion right now (%), `null` when no scope. */
  progress: number | null
  /** Completion (%) at the start of the selected period. */
  progressStart: number | null
  /** Progress gain over the period, in percentage points. */
  gain: number | null
  /** Progress gain over the immediately preceding period. */
  prevGain: number | null
  /** Tasks completed / created during the period. */
  completed: number
  added: number
  /** Estimated workload completed during the period (minutes). */
  workloadCompleted: number
  /** Estimated workload still outstanding (minutes). */
  workloadRemaining: number
  /** Active days within the period, and the period length. */
  activeDays: number
  totalDays: number
  /** Whole days since the last active day; `null` when never active. */
  daysSinceActivity: number | null
  /** Currently overdue tasks and their outstanding workload. */
  overdue: Task[]
  overdueWorkload: number
  /** Open tasks with no date and no estimate. */
  unplanned: Task[]
  /** Derived target date: the latest due date among still-open tasks. */
  deadline: string | null
  /** Whole days until `deadline` (negative when it has passed). */
  daysToDeadline: number | null
  health: HealthState
  /** Human-readable reasons behind the health verdict (for the tooltip). */
  healthReasons: string[]
  /** Daily series over the selected period. */
  series: DayPoint[]
  /** Tasks completed during the period, most recent first. */
  completedTasks: Task[]
  /** Tasks created during the period, most recent first. */
  addedTasks: Task[]
  /** Next upcoming due task (soonest due date, still open). */
  nextDue: Task | null
}

/**
 * Project health.
 *
 * Deliberately rule-based (not a black-box score) so the UI can explain
 * exactly why a project landed in a state. Rules are evaluated in order of
 * severity and every triggered rule contributes a reason string:
 *
 *   completed  — progress is 100%
 *   behind     — a deadline has passed with work outstanding, OR the period
 *                produced no progress at all while overdue work exists
 *   at_risk    — overdue workload is significant, scope grew faster than it
 *                was completed, or the deadline is close relative to the
 *                remaining workload
 *   inactive   — no active day for at least half the period (min 3 days)
 *   no_deadline— healthy movement but nothing to be measured against
 *   on_track   — progressing, nothing overdue, no scope blow-out
 */
export function computeHealth(m: Omit<ProjectMetrics, 'health' | 'healthReasons'>): { health: HealthState; reasons: string[] } {
  const reasons: string[] = []
  const gain = m.gain ?? 0
  const inactiveStretch = m.daysSinceActivity

  if (m.items.length === 0) {
    return { health: 'no_deadline', reasons: ['No tasks yet — add work to start tracking progress.'] }
  }
  if (m.progress != null && m.progress >= 99.999) {
    return { health: 'completed', reasons: ['All estimated workload is complete.'] }
  }

  // --- Signals -----------------------------------------------------
  const overdueShare = m.workloadRemaining > 0 ? m.overdueWorkload / m.workloadRemaining : 0
  const deadlinePassed = m.daysToDeadline != null && m.daysToDeadline < 0
  const scopeGrew = m.added > m.completed && m.added - m.completed >= 2
  const noMovement = gain <= 0.001 && m.completed === 0
  const longInactive = inactiveStretch != null && inactiveStretch >= Math.max(3, Math.ceil(m.totalDays / 2))

  if (m.overdue.length > 0) {
    reasons.push(`${m.overdue.length} overdue ${m.overdue.length === 1 ? 'task' : 'tasks'} (${formatMinutes(m.overdueWorkload)} of work).`)
  }
  if (deadlinePassed) reasons.push(`Latest scheduled date passed ${Math.abs(m.daysToDeadline!)}d ago with work still open.`)
  if (scopeGrew) reasons.push(`Scope grew: ${m.added} added vs ${m.completed} completed.`)
  if (noMovement) reasons.push(`No progress recorded in the last ${m.totalDays} days.`)
  else reasons.push(`${gain >= 0 ? '+' : ''}${gain.toFixed(1)} pp progress in the last ${m.totalDays} days.`)
  if (inactiveStretch != null && inactiveStretch > 0) reasons.push(`Last activity ${inactiveStretch}d ago.`)
  if (inactiveStretch == null) reasons.push('No completed work recorded yet.')

  // --- Verdict, most severe first ---------------------------------
  if (deadlinePassed && m.progress != null && m.progress < 100) return { health: 'behind', reasons }
  if (noMovement && m.overdue.length > 0) return { health: 'behind', reasons }
  if (overdueShare >= 0.25 || m.overdue.length >= 3) return { health: 'at_risk', reasons }
  if (scopeGrew && gain < 1) return { health: 'at_risk', reasons }
  if (m.daysToDeadline != null && m.daysToDeadline <= 3 && (m.progress ?? 0) < 80) return { health: 'at_risk', reasons }
  if (longInactive) return { health: 'inactive', reasons }
  if (m.deadline == null) return { health: 'no_deadline', reasons }
  return { health: 'on_track', reasons }
}

/**
 * Compute every per-project metric for one project over a period window.
 */
export function computeProjectMetrics(
  project: Project,
  allTasks: Task[],
  weighted: WeightedTask[],
  period: PeriodWindow,
  nowMs = Date.now(),
): ProjectMetrics {
  const todayKey = dayKey(new Date(nowMs))
  const items = weighted.filter(w => w.projectId === project.id)
  const projectTasks = allTasks.filter(t => t.projectId === project.id && !t.archived)

  const progress = weightedProgressAt(items, nowMs)
  const progressStart = weightedProgressAt(items, period.startMs)
  const gain = progress == null ? null : progress - (progressStart ?? 0)
  const prevGain = progressGain(items, period.prev.startMs, period.prev.endMs)

  let completed = 0
  let added = 0
  let workloadCompleted = 0
  let workloadRemaining = 0
  for (const it of items) {
    if (it.completedMs != null && it.completedMs >= period.startMs && it.completedMs <= period.endMs) {
      completed += 1
      workloadCompleted += it.weight
    }
    if (it.createdMs >= period.startMs && it.createdMs <= period.endMs) added += 1
    if (!it.done) workloadRemaining += it.weight
  }

  const series = buildDaySeries(items, period.dayKeys, nowMs)
  const activeDays = series.filter(d => d.active).length

  // Days since the most recent *completion* (or progress increase) anywhere
  // in the project's history — not limited to the selected period, so a long
  // dormant project is still flagged on a short window.
  let lastActiveMs: number | null = null
  for (const it of items) {
    if (it.completedMs != null && (lastActiveMs == null || it.completedMs > lastActiveMs)) lastActiveMs = it.completedMs
  }
  const daysSinceActivity = lastActiveMs == null
    ? null
    : Math.max(0, Math.floor((startOfDay(new Date(nowMs)).getTime() - startOfDay(new Date(lastActiveMs)).getTime()) / 86_400_000))

  const overdueTasks = projectTasks.filter(t => isOverdue(t, todayKey))
  const overdueIds = new Set(overdueTasks.map(t => t.id))
  const overdueWorkload = items
    .filter(it => overdueIds.has(it.id))
    .reduce((s, it) => s + it.weight, 0)

  const unplanned = projectTasks.filter(isUnplanned)

  // Derived target date: the LAST scheduled due date among open tasks. The
  // app has no explicit project deadline field, so we infer the date the
  // project is currently planned to finish and label it transparently.
  const openDue = projectTasks
    .filter(t => t.status !== 'done' && t.status !== 'cancelled' && t.dueDate)
    .map(t => t.dueDate!)
    .sort()
  const deadline = openDue.length ? openDue[openDue.length - 1] : null
  const daysToDeadline = deadline
    ? Math.round((parseDayKey(deadline).getTime() - startOfDay(new Date(nowMs)).getTime()) / 86_400_000)
    : null

  const completedTasks = items
    .filter(it => it.completedMs != null && it.completedMs >= period.startMs && it.completedMs <= period.endMs)
    .sort((a, b) => (b.completedMs ?? 0) - (a.completedMs ?? 0))
    .map(it => it.task)
  const addedTasks = items
    .filter(it => it.createdMs >= period.startMs && it.createdMs <= period.endMs)
    .sort((a, b) => b.createdMs - a.createdMs)
    .map(it => it.task)

  const nextDue = projectTasks
    .filter(t => t.status !== 'done' && t.status !== 'cancelled' && t.dueDate && t.dueDate >= todayKey)
    .sort((a, b) => (a.dueDate! < b.dueDate! ? -1 : 1))[0] ?? null

  const base = {
    project, items, progress, progressStart, gain, prevGain,
    completed, added, workloadCompleted, workloadRemaining,
    activeDays, totalDays: period.days, daysSinceActivity,
    overdue: overdueTasks, overdueWorkload, unplanned,
    deadline, daysToDeadline, series, completedTasks, addedTasks, nextDue,
  }
  const { health, reasons } = computeHealth(base)
  return { ...base, health, healthReasons: reasons }
}

/* ------------------------------------------------------------------ */
/* Workspace-level summary                                             */
/* ------------------------------------------------------------------ */

export type SummaryMetrics = {
  /** Weighted progress gain across the selected projects (pp). */
  gain: number | null
  prevGain: number | null
  gainSeries: number[]
  /** Absolute weighted progress now / at period start. */
  progressNow: number | null
  progressStart: number | null
  /** Tasks completed and their estimated workload. */
  completed: number
  prevCompleted: number
  workload: number
  prevWorkload: number
  /** Active-day counts for the period and the one before it. */
  activeDays: number
  prevActiveDays: number
  /** Per-day active flags for the compact activity strip. */
  activityStrip: { dayKey: string; active: boolean; completed: number }[]
  /** Overdue tasks now, and how many were overdue at the previous period end. */
  overdue: number
  prevOverdue: number
  /** Scope: tasks added during the period. */
  added: number
  prevAdded: number
  /** Whole-workspace daily series (all selected projects combined). */
  series: DayPoint[]
}

/**
 * Aggregate summary across a set of projects.
 *
 * The workspace gain is computed over the COMBINED task set rather than by
 * averaging per-project percentages: a 2-task project shouldn't swing the
 * headline number as hard as a 200-task one.
 */
export function computeSummary(
  scoped: WeightedTask[],
  allScopedTasks: Task[],
  period: PeriodWindow,
  nowMs = Date.now(),
): SummaryMetrics {
  const todayKey = dayKey(new Date(nowMs))

  const progressNow = weightedProgressAt(scoped, nowMs)
  const progressStart = weightedProgressAt(scoped, period.startMs)
  const gain = progressNow == null ? null : progressNow - (progressStart ?? 0)
  const prevGain = progressGain(scoped, period.prev.startMs, period.prev.endMs)

  const series = buildDaySeries(scoped, period.dayKeys, nowMs)
  const prevSeries = buildDaySeries(scoped, period.prev.dayKeys, nowMs)

  const countIn = (from: number, to: number) => {
    let completed = 0, workload = 0, added = 0
    for (const it of scoped) {
      if (it.completedMs != null && it.completedMs >= from && it.completedMs <= to) { completed++; workload += it.weight }
      if (it.createdMs >= from && it.createdMs <= to) added++
    }
    return { completed, workload, added }
  }
  const cur = countIn(period.startMs, period.endMs)
  const prev = countIn(period.prev.startMs, period.prev.endMs)

  // Overdue "then": tasks whose due date had passed at the previous period's
  // end and which had not been completed by that moment.
  const prevEndKey = dayKey(new Date(period.prev.endMs))
  let prevOverdue = 0
  for (const t of allScopedTasks) {
    if (!t.dueDate || t.archived || t.status === 'cancelled') continue
    if (t.dueDate >= prevEndKey) continue
    const doneMs = t.status === 'done' ? ms(t.completedAt) : null
    if (doneMs != null && doneMs <= period.prev.endMs) continue
    const createdMs = ms(t.createdAt) ?? 0
    if (createdMs > period.prev.endMs) continue
    prevOverdue++
  }

  return {
    gain, prevGain,
    gainSeries: series.map(d => d.progress),
    progressNow, progressStart,
    completed: cur.completed, prevCompleted: prev.completed,
    workload: cur.workload, prevWorkload: prev.workload,
    activeDays: series.filter(d => d.active).length,
    prevActiveDays: prevSeries.filter(d => d.active).length,
    activityStrip: series.map(d => ({ dayKey: d.dayKey, active: d.active, completed: d.completed })),
    overdue: allScopedTasks.filter(t => isOverdue(t, todayKey)).length,
    prevOverdue,
    added: cur.added, prevAdded: prev.added,
    series,
  }
}

/* ------------------------------------------------------------------ */
/* Trend series for the chart                                          */
/* ------------------------------------------------------------------ */

export type TrendSeries = {
  id: string
  name: string
  color: string
  /** One value per period day, in the metric's own unit. */
  values: number[]
  /** True for the synthetic "Other" bucket. */
  aggregate?: boolean
  /** Per-day detail used by the hover tooltip. */
  points: DayPoint[]
}

/**
 * Build one chart series per project for the chosen metric.
 *
 * When more than `MAX_TREND_SERIES` projects are selected we keep the most
 * ACTIVE ones (by completed workload, then progress gain, then task count)
 * and fold the rest into a single "Other" series, so the chart never turns
 * into unreadable spaghetti.
 */
export function buildTrendSeries(
  projectMetrics: ProjectMetrics[],
  metric: TrendMetric,
  otherColor = '#71717a',
): { series: TrendSeries[]; groupedCount: number } {
  const valueOf = (d: DayPoint) =>
    metric === 'progress' ? d.progress : metric === 'completed' ? d.completed : d.workload

  const activity = (m: ProjectMetrics) => [
    m.workloadCompleted,
    Math.max(0, m.gain ?? 0),
    m.completed + m.added,
  ]
  const ranked = [...projectMetrics].sort((a, b) => {
    const [aw, ag, ac] = activity(a)
    const [bw, bg, bc] = activity(b)
    return bw - aw || bg - ag || bc - ac || a.project.name.localeCompare(b.project.name)
  })

  const keep = ranked.slice(0, MAX_TREND_SERIES)
  const rest = ranked.slice(MAX_TREND_SERIES)

  const series: TrendSeries[] = keep.map(m => ({
    id: m.project.id,
    name: m.project.name,
    color: m.project.color,
    values: m.series.map(valueOf),
    points: m.series,
  }))

  if (rest.length > 0) {
    const len = keep[0]?.series.length ?? rest[0].series.length
    const merged: DayPoint[] = []
    for (let i = 0; i < len; i++) {
      const dk = rest[0].series[i]?.dayKey ?? ''
      let progress = 0, completed = 0, workload = 0, added = 0
      for (const m of rest) {
        const d = m.series[i]
        if (!d) continue
        progress += d.progress; completed += d.completed; workload += d.workload; added += d.added
      }
      // "Other" averages progress (pp are not additive across projects) but
      // sums the count-based metrics, which are.
      const avgProgress = progress / rest.length
      merged.push({
        dayKey: dk,
        progress: avgProgress,
        progressAbs: null,
        completed, workload, added,
        active: isActiveDay({ completed, progressDelta: avgProgress }),
      })
    }
    series.push({
      id: '__other__',
      name: `Other (${rest.length})`,
      color: otherColor,
      values: merged.map(valueOf),
      aggregate: true,
      points: merged,
    })
  }

  return { series, groupedCount: rest.length }
}

/* ------------------------------------------------------------------ */
/* Insights ("Needs attention")                                        */
/* ------------------------------------------------------------------ */

export type InsightSeverity = 'critical' | 'warning' | 'info'
export type InsightAction =
  | { kind: 'view_project'; projectId: string; label: string }
  | { kind: 'review_overdue'; projectId?: string; label: string }
  | { kind: 'schedule_tasks'; projectId?: string; label: string }
  | { kind: 'add_estimate'; projectId?: string; label: string }

export type Insight = {
  id: string
  severity: InsightSeverity
  /** Short, human sentence — always states the concrete number. */
  text: string
  /** Extra context shown on the second line. */
  detail?: string
  action: InsightAction
  /** Used to order the list; higher = more urgent. */
  weight: number
  projectId?: string
}

/**
 * Derive the actionable insight list.
 *
 * Every insight is a FACT with a number attached plus exactly one next step.
 * They are sorted by urgency; the panel shows the top few and offers
 * "View all" for the remainder.
 */
export function buildInsights(
  projectMetrics: ProjectMetrics[],
  summary: SummaryMetrics,
  period: PeriodWindow,
): Insight[] {
  const out: Insight[] = []

  // 1. Overdue work — the single most actionable signal.
  if (summary.overdue > 0) {
    out.push({
      id: 'overdue-all',
      severity: 'critical',
      text: `${summary.overdue} ${summary.overdue === 1 ? 'task is' : 'tasks are'} overdue`,
      detail: summary.prevOverdue !== summary.overdue
        ? `${summary.prevOverdue > summary.overdue ? 'Down' : 'Up'} from ${summary.prevOverdue} a period ago`
        : undefined,
      action: { kind: 'review_overdue', label: 'Review overdue' },
      weight: 1000 + summary.overdue,
    })
  }

  for (const m of projectMetrics) {
    // 2. Stalled project — real work exists but progress barely moved.
    if (m.items.length > 0 && (m.progress ?? 0) < 100 && (m.gain ?? 0) < 3 && m.completed <= 1) {
      const g = m.gain ?? 0
      out.push({
        id: `stalled-${m.project.id}`,
        severity: g <= 0 ? 'critical' : 'warning',
        text: `${m.project.name} has made only ${g >= 0 ? '+' : ''}${g.toFixed(0)} pp progress in ${period.days} days`,
        detail: `${formatMinutes(m.workloadRemaining)} of estimated work still open`,
        action: { kind: 'view_project', projectId: m.project.id, label: 'View project' },
        weight: 600 - g * 10,
        projectId: m.project.id,
      })
    }

    // 3. Dormant project.
    if (m.daysSinceActivity != null && m.daysSinceActivity >= 3 && (m.progress ?? 0) < 100) {
      out.push({
        id: `inactive-${m.project.id}`,
        severity: m.daysSinceActivity >= 7 ? 'warning' : 'info',
        text: `${m.project.name} has had no activity for ${m.daysSinceActivity} days`,
        detail: m.deadline ? `Latest scheduled date ${m.deadline}` : 'Nothing scheduled either',
        action: { kind: 'schedule_tasks', projectId: m.project.id, label: 'Schedule tasks' },
        weight: 400 + m.daysSinceActivity,
        projectId: m.project.id,
      })
    }

    // 4. Per-project overdue concentration.
    if (m.overdue.length >= 2) {
      out.push({
        id: `overdue-${m.project.id}`,
        severity: 'critical',
        text: `${m.project.name} has ${m.overdue.length} overdue tasks`,
        detail: `${formatMinutes(m.overdueWorkload)} of overdue workload`,
        action: { kind: 'review_overdue', projectId: m.project.id, label: 'Review overdue' },
        weight: 800 + m.overdue.length,
        projectId: m.project.id,
      })
    }
  }

  // 5. Scope growth — why completion can look flat despite real work.
  if (summary.added > summary.completed && summary.added - summary.completed >= 2) {
    out.push({
      id: 'scope-growth',
      severity: 'warning',
      text: `${summary.added} tasks were added while only ${summary.completed} ${summary.completed === 1 ? 'was' : 'were'} completed`,
      detail: 'Growing scope holds completion percentages down',
      action: { kind: 'schedule_tasks', label: 'Schedule tasks' },
      weight: 500 + (summary.added - summary.completed),
    })
  }

  // 6. Unplanned work — cannot be forecast or scheduled.
  const unplanned = projectMetrics.reduce((s, m) => s + m.unplanned.length, 0)
  if (unplanned >= 3) {
    out.push({
      id: 'unplanned',
      severity: 'info',
      text: `${unplanned} tasks have no date or estimate`,
      detail: 'Estimates make progress and workload accurate',
      action: { kind: 'add_estimate', label: 'Add estimate' },
      weight: 200 + unplanned,
    })
  }

  // 7. Deadline pressure.
  for (const m of projectMetrics) {
    if (m.daysToDeadline != null && m.daysToDeadline >= 0 && m.daysToDeadline <= 3 && (m.progress ?? 0) < 90) {
      out.push({
        id: `deadline-${m.project.id}`,
        severity: 'warning',
        text: `${m.project.name} is due in ${m.daysToDeadline === 0 ? 'today' : `${m.daysToDeadline}d`} at ${Math.round(m.progress ?? 0)}%`,
        detail: `${formatMinutes(m.workloadRemaining)} of work remaining`,
        action: { kind: 'view_project', projectId: m.project.id, label: 'View project' },
        weight: 700 - m.daysToDeadline,
        projectId: m.project.id,
      })
    }
  }

  return out.sort((a, b) => b.weight - a.weight)
}

/* ------------------------------------------------------------------ */
/* Activity feed                                                       */
/* ------------------------------------------------------------------ */

export type FeedKind = 'completed' | 'subtask' | 'added' | 'progress' | 'overdue_resolved'
export type FeedEvent = {
  id: string
  kind: FeedKind
  atMs: number
  title: string
  /** Grouped siblings ("+3 more in Marketing"). */
  extra?: number
  projectId?: string
  projectName?: string
  projectColor?: string
  detail?: string
}

/**
 * Build the "Recent progress" feed.
 *
 * Related events are GROUPED (per project, per day, per kind) so a burst of
 * ten completions reads as one line instead of flooding the panel. Minor
 * edits (renames, drags, filter changes) are never surfaced.
 */
export function buildFeed(
  allTasks: Task[],
  projects: Project[],
  period: PeriodWindow,
  limit = 8,
): FeedEvent[] {
  const byProject = new Map(projects.map(p => [p.id, p]))
  const parentIds = new Set(allTasks.filter(t => t.parentId).map(t => t.parentId!))
  type Bucket = { kind: FeedKind; day: string; projectId?: string; items: { title: string; atMs: number }[] }
  const buckets = new Map<string, Bucket>()

  const push = (kind: FeedKind, atMs: number, title: string, projectId?: string) => {
    const day = dayKey(new Date(atMs))
    const key = `${kind}|${day}|${projectId ?? '-'}`
    const b = buckets.get(key) ?? { kind, day, projectId, items: [] }
    b.items.push({ title, atMs })
    buckets.set(key, b)
  }

  for (const t of allTasks) {
    if (t.archived) continue
    const done = t.status === 'done' ? ms(t.completedAt) : null
    if (done != null && done >= period.startMs && done <= period.endMs) {
      const wasOverdue = !!t.dueDate && parseDayKey(t.dueDate).getTime() < done
      push(wasOverdue ? 'overdue_resolved' : t.parentId ? 'subtask' : 'completed', done, t.title, t.projectId)
    }
    const created = ms(t.createdAt)
    if (created != null && created >= period.startMs && created <= period.endMs && !parentIds.has(t.id)) {
      push('added', created, t.title, t.projectId)
    }
  }

  const events: FeedEvent[] = []
  for (const b of buckets.values()) {
    const sorted = b.items.sort((x, y) => y.atMs - x.atMs)
    const head = sorted[0]
    const p = b.projectId ? byProject.get(b.projectId) : undefined
    events.push({
      id: `${b.kind}-${b.day}-${b.projectId ?? 'none'}`,
      kind: b.kind,
      atMs: head.atMs,
      title: head.title,
      extra: sorted.length - 1,
      projectId: b.projectId,
      projectName: p?.name,
      projectColor: p?.color,
    })
  }

  return events.sort((a, b) => b.atMs - a.atMs).slice(0, limit)
}

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

/** `11h 20m` / `45m` / `—`. Always ESTIMATED workload, never tracked time. */
export function formatMinutes(min: number | null | undefined): string {
  if (min == null || !Number.isFinite(min) || min <= 0) return '0m'
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}

/** Signed percentage points, e.g. `+12 pp`, `-3 pp`, `0 pp`. */
export function formatPP(pp: number | null | undefined, digits = 0): string {
  if (pp == null || !Number.isFinite(pp)) return '—'
  const v = Number(pp.toFixed(digits))
  const sign = v > 0 ? '+' : ''
  return `${sign}${v.toFixed(digits)} pp`
}

/** Percentage change between two counts, e.g. `↑ 22%`. Returns null when
 *  the baseline is 0 (a jump from nothing is not a percentage). */
export function percentChange(cur: number, prev: number): number | null {
  if (prev === 0) return null
  return ((cur - prev) / prev) * 100
}

/**
 * Human comparison sentence against the previous period.
 * Kept in one place so every card phrases it identically.
 */
export function comparisonText(
  cur: number,
  prev: number,
  opts: { unit?: 'pp' | 'percent' | 'count'; noun?: string } = {},
): { text: string; direction: 'up' | 'down' | 'flat' } {
  const unit = opts.unit ?? 'count'
  const delta = cur - prev
  if (Math.abs(delta) < (unit === 'pp' ? 0.5 : 0.001)) {
    return { text: 'Same as previous period', direction: 'flat' }
  }
  const dir: 'up' | 'down' = delta > 0 ? 'up' : 'down'
  if (unit === 'pp') return { text: `${Math.abs(delta).toFixed(0)} pp vs previous period`, direction: dir }
  if (unit === 'percent') {
    const pc = percentChange(cur, prev)
    if (pc == null) return { text: `${cur} vs none previously`, direction: dir }
    return { text: `${Math.abs(pc).toFixed(0)}% vs previous period`, direction: dir }
  }
  return { text: `${dir === 'down' ? 'Down' : 'Up'} from ${prev}`, direction: dir }
}

/* ------------------------------------------------------------------ */
/* History sufficiency                                                 */
/* ------------------------------------------------------------------ */

/**
 * Is there enough real history to draw analytics?
 *
 * We refuse to render fabricated trends. Analytics need at least one task
 * plus one recorded event (a completion, or a task created before today) —
 * otherwise the dashboard shows an honest "insights will appear as you
 * complete and update tasks" state instead of a flat zero chart.
 */
export function hasEnoughHistory(tasks: Task[], nowMs = Date.now()): boolean {
  if (tasks.length === 0) return false
  const todayStart = startOfDay(new Date(nowMs)).getTime()
  let completions = 0
  let older = 0
  for (const t of tasks) {
    if (t.status === 'done' && t.completedAt) completions++
    const c = ms(t.createdAt)
    if (c != null && c < todayStart) older++
  }
  return completions > 0 || older > 0
}

/* ------------------------------------------------------------------ */
/* Top-level entry point                                               */
/* ------------------------------------------------------------------ */

export type DashboardModel = {
  period: PeriodWindow
  summary: SummaryMetrics
  projects: ProjectMetrics[]
  insights: Insight[]
  feed: FeedEvent[]
  /** Tasks in scope (non-archived, belonging to selected projects). */
  scopedTasks: Task[]
  hasHistory: boolean
}

/**
 * Compute the whole dashboard in one pass.
 *
 * @param tasks         every task in the workspace
 * @param projects      every project in the workspace
 * @param selectedIds   project filter; empty = all projects
 * @param days          period length
 */
export function computeDashboard(
  tasks: Task[],
  projects: Project[],
  selectedIds: string[],
  days: PeriodDays,
  now: Date = new Date(),
): DashboardModel {
  const nowMs = now.getTime()
  const period = buildPeriod(days, now)
  const activeProjects = selectedIds.length
    ? projects.filter(p => selectedIds.includes(p.id))
    : projects

  const weighted = buildWeightedTasks(tasks)
  const allowed = new Set(activeProjects.map(p => p.id))
  const inScope = (pid?: string) => (selectedIds.length ? !!pid && allowed.has(pid) : true)

  const scopedWeighted = weighted.filter(w => inScope(w.projectId))
  const scopedTasks = tasks.filter(t => !t.archived && inScope(t.projectId))

  const summary = computeSummary(scopedWeighted, scopedTasks, period, nowMs)
  const projectMetrics = activeProjects
    .map(p => computeProjectMetrics(p, tasks, weighted, period, nowMs))
    .sort((a, b) => HEALTH_META[a.health].rank - HEALTH_META[b.health].rank || (b.gain ?? 0) - (a.gain ?? 0))

  return {
    period,
    summary,
    projects: projectMetrics,
    insights: buildInsights(projectMetrics, summary, period),
    feed: buildFeed(scopedTasks, projects, period),
    scopedTasks,
    hasHistory: hasEnoughHistory(scopedTasks, nowMs),
  }
}

/* ------------------------------------------------------------------ */
/* Sorting for the project performance table                           */
/* ------------------------------------------------------------------ */

export type ProjectSortKey =
  | 'name' | 'progress' | 'gain' | 'completed' | 'added' | 'active' | 'overdue' | 'health' | 'deadline'

export function sortProjectMetrics(rows: ProjectMetrics[], key: ProjectSortKey, dir: 'asc' | 'desc'): ProjectMetrics[] {
  const sign = dir === 'asc' ? 1 : -1
  const val = (m: ProjectMetrics): number | string => {
    switch (key) {
      case 'name': return m.project.name.toLowerCase()
      case 'progress': return m.progress ?? -1
      case 'gain': return m.gain ?? -Infinity
      case 'completed': return m.completed
      case 'added': return m.added
      case 'active': return m.activeDays
      case 'overdue': return m.overdue.length
      case 'health': return HEALTH_META[m.health].rank
      case 'deadline': return m.deadline ? parseDayKey(m.deadline).getTime() : Infinity
    }
  }
  return [...rows].sort((a, b) => {
    const av = val(a), bv = val(b)
    if (typeof av === 'string' || typeof bv === 'string') {
      return String(av).localeCompare(String(bv)) * sign
    }
    return (av - bv) * sign
  })
}
