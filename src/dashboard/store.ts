/* ============================================================
   Progress Dashboard — view state
   ------------------------------------------------------------
   Period, project filter, comparison toggle, trend metric and table sort
   all live here and are PERSISTED to localStorage, so returning to the
   dashboard restores the exact analytical view the user left behind
   (an explicit requirement: "filters should persist when the page is
   revisited").

   This store is intentionally separate from the app's `useUI` settings
   store: these are analysis choices scoped to one page, not account-wide
   preferences that need to sync to Supabase.
   ============================================================ */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { PERIODS, type PeriodDays, type ProjectSortKey, type TrendMetric } from './metrics'

export type DashboardState = {
  /** Selected period length in days (3 / 7 / 15 / 30). */
  period: PeriodDays
  /** Selected project ids. EMPTY MEANS ALL — so newly created projects are
   *  included automatically instead of silently missing from analytics. */
  projectIds: string[]
  /** "Compare to previous period" toggle. */
  compare: boolean
  /** Which series the trend chart plots. */
  trendMetric: TrendMetric
  /** Project performance table sort. */
  sortKey: ProjectSortKey
  sortDir: 'asc' | 'desc'
  /** Collapsible "Today's focus" panel. */
  focusOpen: boolean

  setPeriod: (p: PeriodDays) => void
  setProjectIds: (ids: string[]) => void
  toggleProject: (id: string) => void
  clearProjects: () => void
  setCompare: (v: boolean) => void
  setTrendMetric: (m: TrendMetric) => void
  /** Clicking the same column flips direction; a new column starts sensibly. */
  sortBy: (key: ProjectSortKey) => void
  setFocusOpen: (v: boolean) => void
}

/** Columns where "biggest first" is the more useful default. */
const DESC_FIRST: ProjectSortKey[] = ['progress', 'gain', 'completed', 'added', 'active', 'overdue']

export const useDashboard = create<DashboardState>()(persist(
  (set, get) => ({
    period: 7,
    projectIds: [],
    compare: true,
    trendMetric: 'progress',
    sortKey: 'health',
    sortDir: 'asc',
    focusOpen: true,

    setPeriod: (period) => set({ period }),
    setProjectIds: (projectIds) => set({ projectIds }),
    toggleProject: (id) => set(s => ({
      projectIds: s.projectIds.includes(id)
        ? s.projectIds.filter(x => x !== id)
        : [...s.projectIds, id],
    })),
    clearProjects: () => set({ projectIds: [] }),
    setCompare: (compare) => set({ compare }),
    setTrendMetric: (trendMetric) => set({ trendMetric }),
    sortBy: (key) => {
      const s = get()
      if (s.sortKey === key) set({ sortDir: s.sortDir === 'asc' ? 'desc' : 'asc' })
      else set({ sortKey: key, sortDir: DESC_FIRST.includes(key) ? 'desc' : 'asc' })
    },
    setFocusOpen: (focusOpen) => set({ focusOpen }),
  }),
  {
    name: 'orbit-progress-dashboard',
    version: 1,
    partialize: (s) => ({
      period: s.period,
      projectIds: s.projectIds,
      compare: s.compare,
      trendMetric: s.trendMetric,
      sortKey: s.sortKey,
      sortDir: s.sortDir,
      focusOpen: s.focusOpen,
    }) as any,
    // Guard against stale/corrupt persisted values (e.g. a period that is no
    // longer offered) so the dashboard can never boot into an invalid view.
    merge: (persisted, current) => {
      const p = (persisted ?? {}) as Partial<DashboardState>
      const period = PERIODS.includes(p.period as PeriodDays) ? (p.period as PeriodDays) : current.period
      return {
        ...current,
        ...p,
        period,
        projectIds: Array.isArray(p.projectIds) ? p.projectIds.filter(x => typeof x === 'string') : [],
      }
    },
  },
))
