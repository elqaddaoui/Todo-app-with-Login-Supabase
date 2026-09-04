/* ============================================================
   Progress Overview — the Progress Dashboard page
   ------------------------------------------------------------
   A calm project-progress command center. Projects ARE the user's goals,
   so this page answers four questions and nothing else:

     1. Am I making progress?              → top stat cards
     2. Which projects are improving or
        falling behind?                    → progress trend + project table
     3. What work is affecting progress?   → completed vs added, activity feed
     4. What should I focus on next?       → needs attention + today's focus

   This component is deliberately DECOUPLED from the app's stores: the host
   passes data and action callbacks in. That keeps the analytics testable and
   avoids touching unrelated pages or navigation.
   ============================================================ */

import React, { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { Filter, Plus, SlidersHorizontal } from 'lucide-react'
import type { Project, Task } from '../data/types'
import './dashboard.css'
import { useDashboard } from './store'
import {
  DashboardSkeleton, EmptyState, Popover, ProjectMultiSelect, Section,
  Segmented, ToggleSwitch, cn,
} from './primitives'
import { TrendChart } from './charts'
import {
  ActivityFeed, InsightsPanel, NoHistoryState, ProjectPerformance, ScopePanel,
  StatCards, TodayFocus, TrendSection,
} from './sections'
import {
  PERIODS, TREND_METRICS, buildTrendSeries, computeDashboard, dayKey,
  sortProjectMetrics, type InsightAction, type PeriodDays,
} from './metrics'

/** Actions the dashboard delegates back to the host application. */
export type DashboardActions = {
  /** Navigate to a route (uses the app's existing router). */
  navigate: (to: string) => void
  /** Open a task in the app's details panel. */
  openTask: (id: string) => void
  /** Toggle a task's done state through the app's own store action. */
  toggleTask: (id: string) => void
  /** Open the app's existing "New task" panel. */
  newTask: () => void
}

export type ProgressDashboardProps = {
  tasks: Task[]
  projects: Project[]
  /** True while the workspace is still hydrating. */
  loading?: boolean
  actions: DashboardActions
  /** Renders the header's period/project/compare controls in a bottom sheet. */
  isMobile?: boolean
}

const PERIOD_OPTIONS = PERIODS.map(p => ({
  value: p,
  label: `${p}D`,
  title: `Last ${p} days`,
}))

/** Priority order used to pick "the three most important tasks" for today. */
const PRIORITY_RANK: Record<string, number> = { urgent: 4, high: 3, medium: 2, low: 1 }

export default function ProgressDashboard({
  tasks, projects, loading = false, actions, isMobile = false,
}: ProgressDashboardProps) {
  const {
    period, projectIds, compare, trendMetric, sortKey, sortDir, focusOpen,
    setPeriod, toggleProject, clearProjects, setProjectIds, setCompare,
    setTrendMetric, sortBy, setFocusOpen,
  } = useDashboard()

  /* Prune project ids that no longer exist (deleted project) so the filter
     can never silently exclude everything. */
  useEffect(() => {
    if (projectIds.length === 0) return
    const live = new Set(projects.map(p => p.id))
    const next = projectIds.filter(id => live.has(id))
    if (next.length !== projectIds.length) setProjectIds(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects, projectIds.join('|')])

  /* Heavy analytics recompute is deferred so switching period / projects keeps
     the controls responsive on large workspaces. */
  const inputs = useMemo(
    () => ({ tasks, projects, projectIds, period }),
    [tasks, projects, projectIds, period],
  )
  const deferred = useDeferredValue(inputs)
  const stale = deferred !== inputs

  const model = useMemo(
    () => computeDashboard(deferred.tasks, deferred.projects, deferred.projectIds, deferred.period),
    [deferred],
  )

  const rows = useMemo(
    () => sortProjectMetrics(model.projects, sortKey, sortDir),
    [model.projects, sortKey, sortDir],
  )

  const trend = useMemo(
    () => buildTrendSeries(model.projects, trendMetric),
    [model.projects, trendMetric],
  )

  /* ---- Today's focus: the three most important tasks due today ---- */
  const todayKey = dayKey(new Date())
  const todayTasks = useMemo(() => {
    const open = model.scopedTasks.filter(t =>
      t.dueDate === todayKey && t.status !== 'done' && t.status !== 'cancelled')
    return open.sort((a, b) => {
      const pr = (PRIORITY_RANK[b.priority] ?? 0) - (PRIORITY_RANK[a.priority] ?? 0)
      if (pr !== 0) return pr
      if (a.time && b.time) return a.time < b.time ? -1 : 1
      if (a.time) return -1
      if (b.time) return 1
      return (b.estimatedMinutes ?? 0) - (a.estimatedMinutes ?? 0)
    })
  }, [model.scopedTasks, todayKey])

  const projectLookup = useMemo(() => {
    const map = new Map(projects.map(p => [p.id, { name: p.name, color: p.color }]))
    return (id?: string) => (id ? map.get(id) ?? null : null)
  }, [projects])

  /* ---- Insight actions map onto the app's existing routes ---- */
  const runAction = (a: InsightAction) => {
    switch (a.kind) {
      case 'view_project':
        actions.navigate(`/projects/${a.projectId}`)
        break
      case 'review_overdue':
        // /today already groups overdue work at the top of the page.
        actions.navigate(a.projectId ? `/projects/${a.projectId}` : '/today')
        break
      case 'schedule_tasks':
        actions.navigate(a.projectId ? `/projects/${a.projectId}` : '/upcoming')
        break
      case 'add_estimate':
        actions.navigate(a.projectId ? `/projects/${a.projectId}` : '/all-tasks')
        break
    }
  }

  /* ---- Mobile: filters live in a bottom sheet ---- */
  const [sheet, setSheet] = useState(false)
  const sheetBtn = useRef<HTMLButtonElement | null>(null)

  if (loading) return <DashboardSkeleton />

  const controls = (
    <>
      <Segmented
        options={PERIOD_OPTIONS}
        value={period}
        onChange={(v) => setPeriod(v as PeriodDays)}
        ariaLabel='Analysis period'
      />
      <ProjectMultiSelect
        projects={projects.map(p => ({ id: p.id, name: p.name, color: p.color }))}
        selected={projectIds}
        onToggle={toggleProject}
        onClear={clearProjects}
        onSetAll={setProjectIds}
      />
      <ToggleSwitch
        checked={compare}
        onChange={setCompare}
        label='Compare'
        hint='Compare to previous period'
      />
    </>
  )

  return (
    <div className={cn('dash-root scrollbar-thin', stale && 'is-stale')}>
      {/* ---------------- Header ---------------- */}
      <header className='dash-header'>
        <div className='dash-header-title'>
          <h1>Progress Overview</h1>
          <p>
            Last {period} days
            {projectIds.length > 0 && <> · {projectIds.length} of {projects.length} projects</>}
            {stale && <span className='dash-updating' role='status'> · updating…</span>}
          </p>
        </div>

        <div className='dash-header-controls'>
          {/* Desktop / tablet: inline controls. Mobile: bottom sheet. */}
          <div className='dash-header-inline'>{controls}</div>
          <button
            ref={sheetBtn}
            type='button'
            className='dash-control dash-header-sheetbtn'
            onClick={() => setSheet(true)}
            aria-haspopup='dialog'
            aria-expanded={sheet}
          >
            <SlidersHorizontal className='h-3.5 w-3.5' aria-hidden='true' />
            <span>{period}D</span>
          </button>
          <button type='button' className='btn btn-primary dash-newtask' onClick={actions.newTask}>
            <Plus className='h-4 w-4' aria-hidden='true' />
            <span className='hidden sm:inline'>New task</span>
          </button>
        </div>
      </header>

      <Popover open={sheet} onClose={() => setSheet(false)} anchor={sheetBtn} sheetOnMobile title='Analytics filters'>
        <div className='dash-sheet-body'>
          <div className='dash-sheet-field'>
            <span className='dash-sheet-label'>Period</span>
            <Segmented
              options={PERIOD_OPTIONS}
              value={period}
              onChange={(v) => setPeriod(v as PeriodDays)}
              ariaLabel='Analysis period'
            />
          </div>
          <div className='dash-sheet-field'>
            <span className='dash-sheet-label'>Projects</span>
            <ProjectMultiSelect
              projects={projects.map(p => ({ id: p.id, name: p.name, color: p.color }))}
              selected={projectIds}
              onToggle={toggleProject}
              onClear={clearProjects}
              onSetAll={setProjectIds}
            />
          </div>
          <div className='dash-sheet-field'>
            <span className='dash-sheet-label'>Comparison</span>
            <ToggleSwitch checked={compare} onChange={setCompare} label='Compare to previous period' />
          </div>
        </div>
      </Popover>

      {/* ---------------- No projects at all ---------------- */}
      {projects.length === 0 ? (
        <Section title='Projects act as your goals' className='dash-onboard'>
          <EmptyState
            icon={Filter}
            title='Create a project to start tracking progress'
            desc='Projects are the goals this dashboard measures. Group your tasks into one and progress, health and trends appear here automatically.'
            action={
              <button type='button' className='btn btn-primary' onClick={() => actions.navigate('/projects')}>
                Go to projects
              </button>
            }
          />
        </Section>
      ) : !model.hasHistory ? (
        /* ---------------- Not enough history ---------------- */
        <NoHistoryState onNewTask={actions.newTask} />
      ) : (
        <>
          {/* ---------------- Stat cards ---------------- */}
          <StatCards summary={model.summary} compare={compare} periodDays={period} />

          {/* ---------------- Trend + attention ---------------- */}
          <div className='dash-main'>
            <TrendSection
              subtitle={
                trend.groupedCount > 0
                  ? `${trend.series.length - 1} most active projects · ${trend.groupedCount} grouped as “Other”`
                  : `${trend.series.length} ${trend.series.length === 1 ? 'project' : 'projects'}`
              }
              note={trend.groupedCount > 0
                ? 'With more than five projects selected, the five most active are drawn individually and the rest are averaged into “Other”.'
                : undefined}
              controls={
                <Segmented
                  size='sm'
                  options={TREND_METRICS.map(m => ({ value: m.key, label: m.label }))}
                  value={trendMetric}
                  onChange={setTrendMetric}
                  ariaLabel='Chart metric'
                />
              }
            >
              {trend.series.length === 0 ? (
                <EmptyState
                  icon={Filter}
                  title='No projects selected'
                  desc='Pick at least one project to plot its progress over time.'
                  compact
                />
              ) : (
                <TrendChart
                  series={trend.series}
                  dayKeys={model.period.dayKeys}
                  metric={trendMetric}
                  groupedCount={trend.groupedCount}
                />
              )}
            </TrendSection>

            <InsightsPanel insights={model.insights} onAction={runAction} />
          </div>

          {/* ---------------- Project performance ---------------- */}
          <ProjectPerformance
            rows={rows}
            sortKey={sortKey}
            sortDir={sortDir}
            onSort={sortBy}
            periodDays={period}
            onOpenProject={(id) => actions.navigate(`/projects/${id}`)}
            onOpenTask={actions.openTask}
            onToggleTask={actions.toggleTask}
          />

          {/* ---------------- Today's focus ---------------- */}
          <TodayFocus
            tasks={todayTasks.slice(0, 3)}
            totalToday={todayTasks.length}
            open={focusOpen}
            onToggleOpen={() => setFocusOpen(!focusOpen)}
            onOpenTask={actions.openTask}
            onToggleTask={actions.toggleTask}
            onViewAll={() => actions.navigate('/today')}
            projectName={projectLookup}
          />

          {/* ---------------- Bottom analytics ---------------- */}
          <div className='dash-bottom'>
            <ScopePanel summary={model.summary} />
            <ActivityFeed events={model.feed} onOpenProject={(id) => actions.navigate(`/projects/${id}`)} />
          </div>
        </>
      )}
    </div>
  )
}
