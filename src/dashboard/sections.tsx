/* ============================================================
   Progress Dashboard — section components
   ------------------------------------------------------------
   Composable pieces assembled by ProgressDashboard:

     StatCard              generic metric card (icon, value, comparison, micro-chart)
     StatCards             the four progress cards
     InsightItem / Panel   "Needs attention"
     ProjectRow / Table    "Project performance" (+ inline expansion)
     ScopePanel            "Completed vs added"
     ActivityFeed          "Recent progress"
     TodayFocus            compact "Today's focus"

   These components are presentational: all numbers arrive pre-computed from
   metrics.ts, and all actions are passed in as callbacks so this file never
   reaches into the app's stores directly.
   ============================================================ */

import React, { useMemo, useState } from 'react'
import {
  AlertTriangle, ArrowRight, CalendarClock, CalendarPlus, Check, CheckCircle2,
  ChevronDown, ChevronRight, Circle, Clock3, Flame, Gauge, Info, ListChecks,
  PlusCircle, Sparkles, Sun, Timer, TrendingUp,
} from 'lucide-react'
import {
  ChartSummary, DeltaChip, EmptyState, HealthBadge, MetricInfo, ProgressBar,
  Section, Tooltip, cn,
} from './primitives'
import { ActivityStrip, GroupedBars, MiniDayChart, Sparkline } from './charts'
import {
  DEFAULT_TASK_WEIGHT, formatMinutes, formatPP, parseDayKey,
  type FeedEvent, type Insight, type InsightAction, type ProjectMetrics,
  type ProjectSortKey, type SummaryMetrics,
} from './metrics'
import type { Priority, Task } from '../data/types'

/* ============================================================
   Stat card
   ============================================================ */

export function StatCard({
  icon: Icon, label, value, secondary, comparison, chart, tone = 'neutral', info, ariaValue,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: React.ReactNode
  secondary?: React.ReactNode
  comparison?: React.ReactNode
  chart?: React.ReactNode
  /** `alert` switches the card to its red state (overdue only). */
  tone?: 'neutral' | 'good' | 'alert'
  info: React.ReactNode
  ariaValue?: string
}) {
  return (
    <article className={cn('dash-panel dash-stat', tone === 'alert' && 'is-alert', tone === 'good' && 'is-good')}>
      <header className='dash-stat-head'>
        <span className='dash-stat-icon' aria-hidden='true'><Icon className='h-3.5 w-3.5' /></span>
        <h3 className='dash-stat-label'>{label}</h3>
        <MetricInfo label={label}>{info}</MetricInfo>
      </header>
      <div className='dash-stat-value' aria-label={ariaValue}>{value}</div>
      {secondary && <div className='dash-stat-secondary'>{secondary}</div>}
      <div className='dash-stat-foot'>
        {comparison}
        {chart && <div className='dash-stat-chart'>{chart}</div>}
      </div>
    </article>
  )
}

/* ============================================================
   The four progress cards
   ============================================================ */

export function StatCards({
  summary, compare, periodDays,
}: { summary: SummaryMetrics; compare: boolean; periodDays: number }) {
  const gain = summary.gain
  const prevGain = summary.prevGain ?? 0
  const gainDelta = (gain ?? 0) - prevGain
  const gainDir = Math.abs(gainDelta) < 0.5 ? 'flat' : gainDelta > 0 ? 'up' : 'down'

  const workDelta = summary.completed - summary.prevCompleted
  const workPct = summary.prevCompleted > 0
    ? Math.round((workDelta / summary.prevCompleted) * 100)
    : null
  const workDir = workDelta === 0 ? 'flat' : workDelta > 0 ? 'up' : 'down'

  const activeDelta = summary.activeDays - summary.prevActiveDays
  const activeDir = activeDelta === 0 ? 'flat' : activeDelta > 0 ? 'up' : 'down'

  const overdueDelta = summary.overdue - summary.prevOverdue
  const overdueDir = overdueDelta === 0 ? 'flat' : overdueDelta > 0 ? 'up' : 'down'

  return (
    <div className='dash-stats'>
      {/* 1 — PROGRESS GAIN */}
      <StatCard
        icon={TrendingUp}
        label='Project progress'
        value={gain == null ? '—' : formatPP(gain)}
        ariaValue={gain == null ? 'No progress data' : `${formatPP(gain)} progress gain`}
        secondary={
          summary.progressNow != null
            ? <>Now at <b>{Math.round(summary.progressNow)}%</b> complete</>
            : 'No tasks in scope yet'
        }
        comparison={compare
          ? <DeltaChip direction={gainDir} text={gainDir === 'flat' ? 'Same as previous period' : `${Math.abs(gainDelta).toFixed(0)} pp vs previous period`} />
          : <span className='dash-stat-note'>Last {periodDays} days</span>}
        chart={<Sparkline values={summary.gainSeries} color='hsl(218 100% 66%)' ariaLabel='Daily progress change' />}
        tone={gain != null && gain > 0 ? 'good' : 'neutral'}
        info={
          <>
            <div className='dash-tooltip-title'>Progress gain</div>
            <p>Duration-weighted completion now, minus completion at the start of the period.</p>
            <p className='dash-tooltip-formula'>completed estimated workload ÷ total estimated workload</p>
            <p>Shown in percentage points (pp) because it is the difference between two percentages. Tasks without an estimate count as {DEFAULT_TASK_WEIGHT} minutes.</p>
          </>
        }
      />

      {/* 2 — WORK COMPLETED */}
      <StatCard
        icon={CheckCircle2}
        label='Work completed'
        value={<>{summary.completed} <span className='dash-stat-unit'>{summary.completed === 1 ? 'task' : 'tasks'}</span></>}
        ariaValue={`${summary.completed} tasks completed`}
        secondary={<><b>{formatMinutes(summary.workload)}</b> estimated workload</>}
        comparison={compare
          ? <DeltaChip
              direction={workDir}
              text={workDir === 'flat'
                ? 'Same as previous period'
                : workPct != null ? `${Math.abs(workPct)}% vs previous period` : `${summary.completed} vs none previously`}
            />
          : <span className='dash-stat-note'>Last {periodDays} days</span>}
        chart={<Sparkline values={summary.series.map(d => d.completed)} color='hsl(152 62% 48%)' ariaLabel='Tasks completed per day' />}
        info={
          <>
            <div className='dash-tooltip-title'>Work completed</div>
            <p>Leaf tasks marked done within the period. Parent tasks are excluded so their subtasks are not counted twice.</p>
            <p><b>Estimated workload</b> is the sum of those tasks’ estimates — it is a plan, not tracked time.</p>
          </>
        }
      />

      {/* 3 — ACTIVE DAYS */}
      <StatCard
        icon={Flame}
        label='Active days'
        value={<>{summary.activeDays} <span className='dash-stat-unit'>of {periodDays} days</span></>}
        ariaValue={`${summary.activeDays} active days out of ${periodDays}`}
        secondary={<ActivityStrip days={summary.activityStrip} max={periodDays <= 15 ? periodDays : 15} />}
        comparison={compare
          ? <DeltaChip
              direction={activeDir}
              text={activeDir === 'flat' ? 'Same as previous period' : `${activeDir === 'up' ? 'Up' : 'Down'} from ${summary.prevActiveDays}`}
            />
          : <span className='dash-stat-note'>Last {periodDays} days</span>}
        info={
          <>
            <div className='dash-tooltip-title'>Active days</div>
            <p>A day counts as active when you completed a task, subtask or milestone, or meaningfully increased project progress (≥ 0.5 pp).</p>
            <p>Opening, renaming or re-ordering a task does not count.</p>
          </>
        }
      />

      {/* 4 — OVERDUE */}
      <StatCard
        icon={AlertTriangle}
        label='Overdue'
        value={<>{summary.overdue} <span className='dash-stat-unit'>{summary.overdue === 1 ? 'task' : 'tasks'}</span></>}
        ariaValue={`${summary.overdue} overdue tasks`}
        secondary={summary.overdue === 0 ? 'Nothing past its due date' : 'Past due and still open'}
        comparison={compare
          ? <DeltaChip
              direction={overdueDir}
              tone='inverse'
              text={overdueDir === 'flat' ? 'Same as previous period' : `${overdueDir === 'down' ? 'Down' : 'Up'} from ${summary.prevOverdue}`}
            />
          : <span className='dash-stat-note'>Right now</span>}
        tone={summary.overdue > 0 ? 'alert' : 'neutral'}
        info={
          <>
            <div className='dash-tooltip-title'>Overdue</div>
            <p>Open tasks whose due date is before today. Done, cancelled and archived tasks are excluded.</p>
            <p>The comparison counts what was overdue at the end of the previous period.</p>
          </>
        }
      />
    </div>
  )
}

/* ============================================================
   Needs attention
   ============================================================ */

const SEVERITY_ICON = {
  critical: AlertTriangle,
  warning: Clock3,
  info: Info,
} as const

export function InsightItem({
  insight, onAction,
}: { insight: Insight; onAction: (a: InsightAction) => void }) {
  const Icon = SEVERITY_ICON[insight.severity]
  return (
    <li className={cn('dash-insight', `sev-${insight.severity}`)}>
      <span className='dash-insight-icon' aria-hidden='true'><Icon className='h-3.5 w-3.5' /></span>
      <div className='dash-insight-body'>
        <p className='dash-insight-text'>{insight.text}</p>
        {insight.detail && <p className='dash-insight-detail'>{insight.detail}</p>}
      </div>
      <button type='button' className='dash-insight-action' onClick={() => onAction(insight.action)}>
        {insight.action.label}
        <ArrowRight className='h-3 w-3' aria-hidden='true' />
      </button>
    </li>
  )
}

export function InsightsPanel({
  insights, onAction, max = 4,
}: { insights: Insight[]; onAction: (a: InsightAction) => void; max?: number }) {
  const [expanded, setExpanded] = useState(false)
  const shown = expanded ? insights : insights.slice(0, max)
  const hidden = insights.length - shown.length

  return (
    <Section
      title='Needs attention'
      subtitle={insights.length > 0 ? `${insights.length} ${insights.length === 1 ? 'signal' : 'signals'} found` : undefined}
      className='dash-attention'
      info={
        <>
          <div className='dash-tooltip-title'>Needs attention</div>
          <p>Facts derived from your tasks — overdue work, stalled or dormant projects, scope growth and unplanned tasks — each with one next step.</p>
        </>
      }
    >
      {insights.length === 0 ? (
        <EmptyState
          icon={Sparkles}
          title='Nothing needs attention'
          desc='No overdue work, no stalled projects, and scope is under control.'
          compact
        />
      ) : (
        <>
          <ul className='dash-insight-list'>
            {shown.map(i => <InsightItem key={i.id} insight={i} onAction={onAction} />)}
          </ul>
          {(hidden > 0 || expanded) && (
            <button type='button' className='dash-viewall' onClick={() => setExpanded(v => !v)}>
              {expanded ? 'Show less' : `View all ${insights.length}`}
              <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', expanded && 'rotate-180')} aria-hidden='true' />
            </button>
          )}
        </>
      )}
    </Section>
  )
}

/* ============================================================
   Project performance
   ============================================================ */

const COLUMNS: { key: ProjectSortKey; label: string; className?: string; title?: string }[] = [
  { key: 'name', label: 'Project', className: 'col-project' },
  { key: 'progress', label: 'Progress', className: 'col-progress' },
  { key: 'gain', label: 'Change', className: 'col-change', title: 'Progress gained during the selected period' },
  { key: 'completed', label: 'Done', className: 'col-done col-mid', title: 'Tasks completed in the period' },
  { key: 'added', label: 'Added', className: 'col-added col-mid', title: 'Tasks created in the period' },
  { key: 'active', label: 'Active', className: 'col-active col-wide', title: 'Days with completed work or real progress' },
  { key: 'overdue', label: 'Overdue', className: 'col-overdue col-mid' },
  { key: 'health', label: 'Health', className: 'col-health' },
  { key: 'deadline', label: 'Deadline', className: 'col-deadline col-wide', title: 'Latest scheduled date among open tasks' },
]

function ProjectIconDot({ color }: { color: string }) {
  return <span className='dash-project-dot' style={{ background: color }} aria-hidden='true' />
}

export function ProjectRow({
  m, expanded, onToggle, onOpenProject, onOpenTask, onToggleTask,
}: {
  m: ProjectMetrics
  expanded: boolean
  onToggle: () => void
  onOpenProject: (id: string) => void
  onOpenTask: (id: string) => void
  onToggleTask: (id: string) => void
}) {
  const gain = m.gain
  const pct = m.progress
  const deadlineLabel = m.deadline
    ? parseDayKey(m.deadline).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    : '—'
  const deadlineTone = m.daysToDeadline == null
    ? 'neutral'
    : m.daysToDeadline < 0 ? 'bad' : m.daysToDeadline <= 3 ? 'warn' : 'neutral'

  return (
    <div className={cn('dash-prow-wrap', expanded && 'is-expanded')}>
      <div className='dash-prow' role='row'>
        <button
          type='button'
          className='dash-prow-expand'
          onClick={onToggle}
          aria-expanded={expanded}
          aria-label={`${expanded ? 'Collapse' : 'Expand'} details for ${m.project.name}`}
        >
          <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', expanded && 'rotate-90')} aria-hidden='true' />
        </button>

        {/* Project */}
        <div className='dash-prow-cell col-project'>
          <ProjectIconDot color={m.project.color} />
          <button type='button' className='dash-prow-name' onClick={() => onOpenProject(m.project.id)} title={`Open ${m.project.name}`}>
            {m.project.name}
          </button>
        </div>

        {/* Current progress */}
        <div className='dash-prow-cell col-progress'>
          <div className='dash-prow-progress'>
            <ProgressBar value={pct} color={m.project.color} height={5} label={`${m.project.name} progress`} />
            <span className='dash-prow-pct'>{pct == null ? '—' : `${Math.round(pct)}%`}</span>
          </div>
          <span className='dash-prow-sub'>{m.items.length} {m.items.length === 1 ? 'task' : 'tasks'} · {formatMinutes(m.workloadRemaining)} left</span>
        </div>

        {/* Change */}
        <div className='dash-prow-cell col-change'>
          <span className={cn('dash-prow-gain', (gain ?? 0) > 0.5 && 'is-up', (gain ?? 0) < -0.5 && 'is-down')}>
            {gain == null ? '—' : formatPP(gain)}
          </span>
        </div>

        {/* Completed / Added */}
        <div className='dash-prow-cell col-done col-mid'>
          <span className='dash-prow-num'>{m.completed}</span>
        </div>
        <div className='dash-prow-cell col-added col-mid'>
          <span className={cn('dash-prow-num', m.added > m.completed && 'is-warn')}>{m.added}</span>
        </div>

        {/* Active days */}
        <div className='dash-prow-cell col-active col-wide'>
          <span className='dash-prow-active'>
            <span className='dash-prow-num'>{m.activeDays}<span className='dash-prow-of'>/{m.totalDays}</span></span>
            <ActivityStrip days={m.series.map(d => ({ dayKey: d.dayKey, active: d.active, completed: d.completed }))} max={7} />
          </span>
        </div>

        {/* Overdue */}
        <div className='dash-prow-cell col-overdue col-mid'>
          {m.overdue.length > 0
            ? <span className='dash-prow-overdue'>{m.overdue.length}</span>
            : <span className='dash-prow-num is-muted'>0</span>}
        </div>

        {/* Health */}
        <div className='dash-prow-cell col-health'>
          <HealthBadge health={m.health} reasons={m.healthReasons} compact />
        </div>

        {/* Deadline */}
        <div className='dash-prow-cell col-deadline col-wide'>
          <span className={cn('dash-prow-deadline', `tone-${deadlineTone}`)}>
            {deadlineLabel}
            {m.daysToDeadline != null && (
              <span className='dash-prow-sub'>
                {m.daysToDeadline < 0 ? `${Math.abs(m.daysToDeadline)}d ago` : m.daysToDeadline === 0 ? 'today' : `in ${m.daysToDeadline}d`}
              </span>
            )}
          </span>
        </div>
      </div>

      {expanded && (
        <div className='dash-prow-detail'>
          <div className='dash-prow-detail-grid'>
            {/* Daily chart + workload */}
            <div className='dash-detail-block'>
              <h4 className='dash-detail-title'>Daily progress</h4>
              <MiniDayChart points={m.series} color={m.project.color} />
              <dl className='dash-detail-stats'>
                <div>
                  <dt>Remaining workload</dt>
                  <dd>{formatMinutes(m.workloadRemaining)}</dd>
                </div>
                <div>
                  <dt>Completed workload</dt>
                  <dd>{formatMinutes(m.workloadCompleted)}</dd>
                </div>
                <div>
                  <dt>Upcoming deadline</dt>
                  <dd>
                    {m.nextDue?.dueDate
                      ? `${parseDayKey(m.nextDue.dueDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · ${m.nextDue.title}`
                      : 'Nothing scheduled'}
                  </dd>
                </div>
              </dl>
            </div>

            {/* Completed tasks */}
            <div className='dash-detail-block'>
              <h4 className='dash-detail-title'>Completed this period <span>{m.completedTasks.length}</span></h4>
              {m.completedTasks.length === 0 ? (
                <p className='dash-detail-empty'>No tasks completed in this period.</p>
              ) : (
                <ul className='dash-detail-list'>
                  {m.completedTasks.slice(0, 5).map(t => (
                    <li key={t.id}>
                      <CheckCircle2 className='h-3.5 w-3.5 dash-ico-good' aria-hidden='true' />
                      <button type='button' className='dash-detail-link is-done' onClick={() => onOpenTask(t.id)}>{t.title}</button>
                      <span className='dash-detail-meta'>{formatMinutes(t.estimatedMinutes ?? DEFAULT_TASK_WEIGHT)}</span>
                    </li>
                  ))}
                  {m.completedTasks.length > 5 && <li className='dash-detail-more'>+{m.completedTasks.length - 5} more</li>}
                </ul>
              )}
            </div>

            {/* Overdue + recently added */}
            <div className='dash-detail-block'>
              {m.overdue.length > 0 && (
                <>
                  <h4 className='dash-detail-title'>Overdue <span className='is-bad'>{m.overdue.length}</span></h4>
                  <ul className='dash-detail-list'>
                    {m.overdue.slice(0, 3).map(t => (
                      <li key={t.id}>
                        <button
                          type='button'
                          className='dash-detail-check'
                          onClick={() => onToggleTask(t.id)}
                          aria-label={`Mark ${t.title} complete`}
                        >
                          <Circle className='h-3.5 w-3.5' aria-hidden='true' />
                        </button>
                        <button type='button' className='dash-detail-link' onClick={() => onOpenTask(t.id)}>{t.title}</button>
                        <span className='dash-detail-meta is-bad'>{t.dueDate}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <h4 className='dash-detail-title'>Recently added <span>{m.addedTasks.length}</span></h4>
              {m.addedTasks.length === 0 ? (
                <p className='dash-detail-empty'>No new tasks added in this period.</p>
              ) : (
                <ul className='dash-detail-list'>
                  {m.addedTasks.slice(0, 3).map(t => (
                    <li key={t.id}>
                      <PlusCircle className='h-3.5 w-3.5 dash-ico-muted' aria-hidden='true' />
                      <button type='button' className='dash-detail-link' onClick={() => onOpenTask(t.id)}>{t.title}</button>
                      <span className='dash-detail-meta'>{formatMinutes(t.estimatedMinutes ?? DEFAULT_TASK_WEIGHT)}</span>
                    </li>
                  ))}
                </ul>
              )}
              <button type='button' className='dash-detail-open' onClick={() => onOpenProject(m.project.id)}>
                Open project <ArrowRight className='h-3.5 w-3.5' aria-hidden='true' />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export function ProjectPerformance({
  rows, sortKey, sortDir, onSort, onOpenProject, onOpenTask, onToggleTask, periodDays,
}: {
  rows: ProjectMetrics[]
  sortKey: ProjectSortKey
  sortDir: 'asc' | 'desc'
  onSort: (k: ProjectSortKey) => void
  onOpenProject: (id: string) => void
  onOpenTask: (id: string) => void
  onToggleTask: (id: string) => void
  periodDays: number
}) {
  const [open, setOpen] = useState<Set<string>>(new Set())
  const toggle = (id: string) => setOpen(s => {
    const next = new Set(s)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  return (
    <Section
      title='Project performance'
      subtitle={`${rows.length} ${rows.length === 1 ? 'project' : 'projects'} · last ${periodDays} days`}
      className='dash-performance'
      bodyClassName='!p-0'
      info={
        <>
          <div className='dash-tooltip-title'>Project performance</div>
          <p>Projects are your goals. Progress is duration-weighted: completed estimated workload ÷ total estimated workload.</p>
          <p>Change is measured in percentage points against the start of the period. Expand a row for daily detail.</p>
        </>
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={Gauge}
          title='No projects in scope'
          desc='Adjust the project filter, or create a project to start tracking progress.'
        />
      ) : (
        <div className='dash-table' role='table' aria-label='Project performance'>
          <div className='dash-thead' role='row'>
            <span className='dash-prow-expand' aria-hidden='true' />
            {COLUMNS.map(c => (
              <button
                key={c.key}
                type='button'
                role='columnheader'
                aria-sort={sortKey === c.key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                className={cn('dash-th', c.className, sortKey === c.key && 'is-sorted')}
                onClick={() => onSort(c.key)}
                title={c.title ? `${c.title} — click to sort` : `Sort by ${c.label}`}
              >
                <span className='truncate'>{c.label}</span>
                <ChevronDown
                  className={cn('dash-th-arrow', sortKey === c.key && 'is-on', sortKey === c.key && sortDir === 'asc' && 'rotate-180')}
                  aria-hidden='true'
                />
              </button>
            ))}
          </div>
          <div className='dash-tbody'>
            {rows.map(m => (
              <ProjectRow
                key={m.project.id}
                m={m}
                expanded={open.has(m.project.id)}
                onToggle={() => toggle(m.project.id)}
                onOpenProject={onOpenProject}
                onOpenTask={onOpenTask}
                onToggleTask={onToggleTask}
              />
            ))}
          </div>
        </div>
      )}
    </Section>
  )
}

/* ============================================================
   Completed vs added
   ============================================================ */

export function ScopePanel({ summary }: { summary: SummaryMetrics }) {
  const net = summary.completed - summary.added
  return (
    <Section
      title='Completed vs added'
      className='dash-scope'
      info={
        <>
          <div className='dash-tooltip-title'>Scope change</div>
          <p>Adding tasks grows the denominator, so completion can look flat even when you finished real work.</p>
          <p>Net change = completed − added.</p>
        </>
      }
    >
      <div className='dash-scope-body'>
        <GroupedBars
          groups={[{
            label: `Last ${summary.series.length} days`,
            bars: [
              { key: 'done', label: 'Completed', value: summary.completed, color: 'hsl(152 62% 48%)' },
              { key: 'added', label: 'Added', value: summary.added, color: 'hsl(258 90% 66%)' },
            ],
          }]}
        />
        <dl className='dash-scope-stats'>
          <div>
            <dt><span className='dash-dot' style={{ background: 'hsl(152 62% 48%)' }} aria-hidden='true' />Completed tasks</dt>
            <dd>{summary.completed}</dd>
          </div>
          <div>
            <dt><span className='dash-dot' style={{ background: 'hsl(258 90% 66%)' }} aria-hidden='true' />Added tasks</dt>
            <dd>{summary.added}</dd>
          </div>
          <div className='dash-scope-net'>
            <dt>Net task {net >= 0 ? 'reduction' : 'growth'}</dt>
            <dd className={cn(net > 0 && 'is-good', net < 0 && 'is-warn')}>{net >= 0 ? net : Math.abs(net)}</dd>
          </div>
        </dl>
      </div>
    </Section>
  )
}

/* ============================================================
   Recent progress feed
   ============================================================ */

const FEED_META = {
  completed: { icon: CheckCircle2, label: 'Task completed', tone: 'good' },
  subtask: { icon: ListChecks, label: 'Subtask completed', tone: 'good' },
  progress: { icon: TrendingUp, label: 'Progress changed', tone: 'info' },
  overdue_resolved: { icon: Timer, label: 'Overdue task resolved', tone: 'good' },
  added: { icon: PlusCircle, label: 'Task added', tone: 'muted' },
} as const

const relTime = (ms: number): string => {
  const diff = Date.now() - ms
  const m = Math.round(diff / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  return d === 1 ? 'yesterday' : `${d}d ago`
}

export function ActivityFeed({ events, onOpenProject }: { events: FeedEvent[]; onOpenProject: (id: string) => void }) {
  return (
    <Section
      title='Recent progress'
      className='dash-feed'
      info={
        <>
          <div className='dash-tooltip-title'>Recent progress</div>
          <p>Completions, resolved overdue work and newly added tasks. Related events from the same project and day are grouped; minor edits are not shown.</p>
        </>
      }
    >
      {events.length === 0 ? (
        <EmptyState icon={Clock3} title='No activity yet' desc='Completed and newly added tasks will appear here.' compact />
      ) : (
        <ul className='dash-feed-list'>
          {events.map(e => {
            const meta = FEED_META[e.kind]
            const Icon = meta.icon
            return (
              <li key={e.id} className={cn('dash-feed-item', `tone-${meta.tone}`)}>
                <span className='dash-feed-icon' aria-hidden='true'><Icon className='h-3.5 w-3.5' /></span>
                <div className='dash-feed-body'>
                  <p className='dash-feed-title'>
                    <span className='dash-feed-kind'>{meta.label}</span>
                    {e.extra ? <span className='dash-feed-extra'>+{e.extra} more</span> : null}
                  </p>
                  <p className='dash-feed-text'>{e.title}</p>
                  <p className='dash-feed-meta'>
                    {e.projectName && (
                      <button type='button' className='dash-feed-project' onClick={() => e.projectId && onOpenProject(e.projectId)}>
                        <span className='dash-dot' style={{ background: e.projectColor }} aria-hidden='true' />
                        {e.projectName}
                      </button>
                    )}
                    <span>{relTime(e.atMs)}</span>
                  </p>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </Section>
  )
}

/* ============================================================
   Today's focus
   ============================================================ */

const PRIORITY_LABEL: Record<Priority, string> = { urgent: 'Urgent', high: 'High', medium: 'Medium', low: 'Low' }

export function TodayFocus({
  tasks, totalToday, open, onToggleOpen, onOpenTask, onToggleTask, onViewAll, projectName,
}: {
  tasks: Task[]
  totalToday: number
  open: boolean
  onToggleOpen: () => void
  onOpenTask: (id: string) => void
  onToggleTask: (id: string) => void
  onViewAll: () => void
  projectName: (id?: string) => { name: string; color: string } | null
}) {
  return (
    <section className={cn('dash-panel dash-focus', !open && 'is-collapsed')} aria-labelledby='dash-focus-title'>
      <header className='dash-panel-head'>
        <button
          type='button'
          className='dash-focus-toggle'
          onClick={onToggleOpen}
          aria-expanded={open}
          aria-controls='dash-focus-body'
        >
          <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-90')} aria-hidden='true' />
          <Sun className='h-4 w-4 dash-ico-warn' aria-hidden='true' />
          <h2 id='dash-focus-title' className='dash-panel-title'>Today’s focus</h2>
          <span className='dash-focus-count'>{totalToday}</span>
        </button>
        <div className='dash-panel-actions'>
          <button type='button' className='dash-linkbtn' onClick={onViewAll}>
            View all today <ArrowRight className='h-3 w-3' aria-hidden='true' />
          </button>
        </div>
      </header>
      {open && (
        <div className='dash-panel-body' id='dash-focus-body'>
          {tasks.length === 0 ? (
            <EmptyState icon={Sun} title='Nothing due today' desc='Enjoy the quieter day, or pull work forward from Upcoming.' compact />
          ) : (
            <ul className='dash-focus-list'>
              {tasks.map(t => {
                const proj = projectName(t.projectId)
                return (
                  <li key={t.id} className='dash-focus-item'>
                    <button
                      type='button'
                      className='dash-focus-check'
                      onClick={() => onToggleTask(t.id)}
                      aria-label={`Mark “${t.title}” complete`}
                    >
                      <span className='dash-focus-box' aria-hidden='true'><Check className='h-3 w-3' /></span>
                    </button>
                    <div className='dash-focus-main'>
                      <button type='button' className='dash-focus-title-btn' onClick={() => onOpenTask(t.id)}>{t.title}</button>
                      <div className='dash-focus-meta'>
                        {proj && (
                          <span className='dash-focus-chip'>
                            <span className='dash-dot' style={{ background: proj.color }} aria-hidden='true' />
                            {proj.name}
                          </span>
                        )}
                        <span className={cn('dash-focus-prio', `prio-${t.priority}`)}>{PRIORITY_LABEL[t.priority]}</span>
                        {t.time && (
                          <span className='dash-focus-chip'>
                            <CalendarClock className='h-3 w-3' aria-hidden='true' />{t.time}
                          </span>
                        )}
                        <span className='dash-focus-chip'>
                          <Timer className='h-3 w-3' aria-hidden='true' />{formatMinutes(t.estimatedMinutes ?? DEFAULT_TASK_WEIGHT)}
                        </span>
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}

/* ============================================================
   Not-enough-history state
   ============================================================ */

export function NoHistoryState({ onNewTask }: { onNewTask: () => void }) {
  return (
    <div className='dash-panel dash-nohistory'>
      <span className='dash-nohistory-icon' aria-hidden='true'><Gauge className='h-5 w-5' /></span>
      <h2 className='dash-nohistory-title'>Progress insights will appear as you complete and update tasks.</h2>
      <p className='dash-nohistory-desc'>
        Projects act as your goals. Once tasks are created, estimated and completed, this dashboard
        shows progress gained, which projects are improving or falling behind, and what to focus on next.
      </p>
      <button type='button' className='btn btn-primary' onClick={onNewTask}>
        <PlusCircle className='h-4 w-4' aria-hidden='true' /> Create your first task
      </button>
      <ChartSummary>No analytics are shown because there is not enough task history yet.</ChartSummary>
    </div>
  )
}

/* ============================================================
   Trend chart section wrapper — keeps the chart controls tidy.
   ============================================================ */

export function TrendSection({
  children, controls, subtitle, note,
}: { children: React.ReactNode; controls: React.ReactNode; subtitle?: string; note?: string }) {
  return (
    <Section
      title='Progress over time'
      subtitle={subtitle}
      actions={controls}
      className='dash-trend'
      info={
        <>
          <div className='dash-tooltip-title'>Progress over time</div>
          <p>One line per project, using the project’s own colour.</p>
          <p><b>Progress change</b> is the daily change in duration-weighted completion (pp). <b>Tasks completed</b> counts leaf tasks finished that day. <b>Estimated workload</b> sums their estimates.</p>
          {note && <p>{note}</p>}
        </>
      }
    >
      {children}
    </Section>
  )
}
