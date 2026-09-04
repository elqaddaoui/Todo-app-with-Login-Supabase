/* ============================================================
   Progress Dashboard — reusable primitives
   ------------------------------------------------------------
   Small, composable building blocks shared by every dashboard section:
   tooltips, segmented controls, the project multi-select, health badges,
   loading skeletons and empty states.

   Accessibility notes that apply throughout this file:
   * Every icon-only control carries an `aria-label` (and a visible title).
   * Status is never conveyed by colour alone — badges pair a tone with an
     icon AND a text label.
   * Focus is always visible: controls rely on the app's `:focus-visible`
     ring conventions defined in index.css.
   ============================================================ */

import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  AlertTriangle, Check, CheckCircle2, ChevronDown, CircleSlash, Clock3,
  Info, Minus, MoonStar, TrendingDown, TrendingUp, X,
} from 'lucide-react'
import { HEALTH_META, type HealthState } from './metrics'

export const cn = (...x: (string | false | undefined | null)[]) => x.filter(Boolean).join(' ')

/* ============================================================
   Tooltip — portal-based so it is never clipped by a card's
   overflow, and reachable by keyboard (focus shows it too).
   ============================================================ */

type TipPlacement = 'top' | 'bottom'

export function Tooltip({
  content,
  children,
  placement = 'top',
  className,
  maxWidth = 260,
}: {
  content: React.ReactNode
  children: React.ReactElement
  placement?: TipPlacement
  className?: string
  maxWidth?: number
}) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ x: number; y: number; place: TipPlacement }>({ x: 0, y: 0, place: placement })
  const anchorRef = useRef<HTMLSpanElement | null>(null)
  const tipRef = useRef<HTMLDivElement | null>(null)
  const id = useId()

  // Position after paint so we can measure the tooltip and flip it when
  // there isn't room above (common for cards near the top of the page).
  useLayoutEffect(() => {
    if (!open || !anchorRef.current) return
    const a = anchorRef.current.getBoundingClientRect()
    const t = tipRef.current?.getBoundingClientRect()
    const h = t?.height ?? 40
    const w = t?.width ?? maxWidth
    let place: TipPlacement = placement
    if (place === 'top' && a.top - h - 10 < 8) place = 'bottom'
    if (place === 'bottom' && a.bottom + h + 10 > window.innerHeight - 8) place = 'top'
    const x = Math.min(Math.max(a.left + a.width / 2, w / 2 + 8), window.innerWidth - w / 2 - 8)
    const y = place === 'top' ? a.top - 8 : a.bottom + 8
    setPos({ x, y, place })
  }, [open, placement, maxWidth])

  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <>
      <span
        ref={anchorRef}
        className={cn('dash-tip-anchor', className)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        aria-describedby={open ? id : undefined}
      >
        {children}
      </span>
      {open && createPortal(
        <div
          ref={tipRef}
          id={id}
          role='tooltip'
          className={cn('dash-tooltip', pos.place === 'top' ? 'is-top' : 'is-bottom')}
          style={{ left: pos.x, top: pos.y, maxWidth }}
        >
          {content}
        </div>,
        document.body,
      )}
    </>
  )
}

/** Small "?" affordance that opens a metric definition. Has a text label for
 *  screen readers so the definition is never mouse-only. */
export function MetricInfo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Tooltip content={children}>
      <button type='button' className='dash-info' aria-label={`How ${label} is calculated`}>
        <Info aria-hidden='true' />
      </button>
    </Tooltip>
  )
}

/* ============================================================
   Segmented control — period selector & chart metric switcher.
   Implemented as a radiogroup so arrow keys work natively.
   ============================================================ */

export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  ariaLabel,
  size = 'md',
}: {
  options: { value: T; label: string; title?: string }[]
  value: T
  onChange: (v: T) => void
  ariaLabel: string
  size?: 'sm' | 'md'
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const move = (from: number, dir: 1 | -1) => {
    const next = (from + dir + options.length) % options.length
    onChange(options[next].value)
    refs.current[next]?.focus()
  }
  return (
    <div className={cn('dash-segmented', size === 'sm' && 'is-sm')} role='radiogroup' aria-label={ariaLabel}>
      {options.map((o, i) => {
        const active = o.value === value
        return (
          <button
            key={String(o.value)}
            ref={el => { refs.current[i] = el }}
            type='button'
            role='radio'
            aria-checked={active}
            title={o.title ?? o.label}
            tabIndex={active ? 0 : -1}
            className={cn('dash-segmented-btn', active && 'is-active')}
            onClick={() => onChange(o.value)}
            onKeyDown={e => {
              if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); move(i, 1) }
              if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); move(i, -1) }
            }}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

/* ============================================================
   Toggle switch — "Compare to previous period".
   ============================================================ */

export function ToggleSwitch({
  checked, onChange, label, hint,
}: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <button
      type='button'
      role='switch'
      aria-checked={checked}
      className={cn('dash-switch', checked && 'is-on')}
      onClick={() => onChange(!checked)}
      title={hint ?? label}
    >
      <span className='dash-switch-track' aria-hidden='true'><span className='dash-switch-thumb' /></span>
      <span className='dash-switch-label'>{label}</span>
    </button>
  )
}

/* ============================================================
   Popover — anchored panel used by the project multi-select and
   the mobile filter bottom sheet.
   ============================================================ */

export function Popover({
  open, onClose, anchor, children, align = 'end', sheetOnMobile = false, title,
}: {
  open: boolean
  onClose: () => void
  anchor: React.RefObject<HTMLElement | null>
  children: React.ReactNode
  align?: 'start' | 'end'
  /** On small screens render as a bottom sheet instead of a popover. */
  sheetOnMobile?: boolean
  title?: string
}) {
  const [box, setBox] = useState<{ x: number; y: number } | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const isMobile = typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches
  const asSheet = sheetOnMobile && isMobile

  useLayoutEffect(() => {
    if (!open || asSheet || !anchor.current) return
    const r = anchor.current.getBoundingClientRect()
    const w = panelRef.current?.offsetWidth ?? 280
    const x = align === 'end' ? Math.max(8, r.right - w) : Math.min(r.left, window.innerWidth - w - 8)
    setBox({ x, y: r.bottom + 6 })
  }, [open, align, asSheet, anchor])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <>
      <div className='dash-popover-overlay' onClick={onClose} />
      <div
        ref={panelRef}
        className={cn('dash-popover', asSheet && 'is-sheet')}
        style={asSheet ? undefined : { left: box?.x ?? -9999, top: box?.y ?? -9999 }}
        role='dialog'
        aria-label={title}
      >
        {asSheet && (
          <div className='dash-sheet-head'>
            <span>{title}</span>
            <button type='button' className='btn btn-ghost !p-1.5' onClick={onClose} aria-label='Close filters'>
              <X className='h-4 w-4' />
            </button>
          </div>
        )}
        {children}
      </div>
    </>,
    document.body,
  )
}

/* ============================================================
   Project multi-select
   ============================================================ */

export type ProjectOption = { id: string; name: string; color: string }

export function ProjectMultiSelect({
  projects, selected, onToggle, onClear, onSetAll,
}: {
  projects: ProjectOption[]
  /** Empty array means "All projects". */
  selected: string[]
  onToggle: (id: string) => void
  onClear: () => void
  onSetAll: (ids: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const btnRef = useRef<HTMLButtonElement | null>(null)
  const all = selected.length === 0
  const filtered = projects.filter(p => p.name.toLowerCase().includes(q.trim().toLowerCase()))

  const label = all
    ? 'All projects'
    : selected.length === 1
      ? projects.find(p => p.id === selected[0])?.name ?? '1 project'
      : `${selected.length} projects`

  return (
    <>
      <button
        ref={btnRef}
        type='button'
        className={cn('dash-control', !all && 'is-active')}
        onClick={() => setOpen(v => !v)}
        aria-haspopup='dialog'
        aria-expanded={open}
        title='Filter analytics by project'
      >
        {!all && (
          <span className='dash-control-dots' aria-hidden='true'>
            {selected.slice(0, 3).map(id => {
              const p = projects.find(x => x.id === id)
              return <span key={id} style={{ background: p?.color ?? '#71717a' }} />
            })}
          </span>
        )}
        <span className='truncate'>{label}</span>
        <ChevronDown className='h-3.5 w-3.5 opacity-60 shrink-0' aria-hidden='true' />
      </button>

      <Popover open={open} onClose={() => setOpen(false)} anchor={btnRef} sheetOnMobile title='Filter by project'>
        <div className='dash-select'>
          {projects.length > 6 && (
            <input
              className='dash-select-search'
              placeholder='Search projects…'
              value={q}
              onChange={e => setQ(e.target.value)}
              aria-label='Search projects'
              autoFocus
            />
          )}
          <div className='dash-select-actions'>
            <button type='button' className='dash-linkbtn' onClick={() => { onClear(); }}>All projects</button>
            <button
              type='button'
              className='dash-linkbtn'
              onClick={() => onSetAll(projects.map(p => p.id))}
              disabled={projects.length === 0}
            >
              Select every
            </button>
          </div>
          <div className='dash-select-list scrollbar-thin' role='group' aria-label='Projects'>
            {filtered.length === 0 && <div className='dash-select-empty'>No projects match “{q}”.</div>}
            {filtered.map(p => {
              const on = all || selected.includes(p.id)
              return (
                <button
                  key={p.id}
                  type='button'
                  role='checkbox'
                  aria-checked={selected.includes(p.id)}
                  className={cn('dash-select-row', selected.includes(p.id) && 'is-on')}
                  onClick={() => onToggle(p.id)}
                >
                  <span className={cn('dash-check', selected.includes(p.id) && 'is-on')} aria-hidden='true'>
                    {selected.includes(p.id) && <Check className='h-3 w-3' />}
                  </span>
                  <span className='dash-dot' style={{ background: p.color }} aria-hidden='true' />
                  <span className='truncate'>{p.name}</span>
                  {all && <span className='dash-select-hint'>included</span>}
                  {!all && on && !selected.includes(p.id) && <span className='dash-select-hint'>included</span>}
                </button>
              )
            })}
          </div>
        </div>
      </Popover>
    </>
  )
}

/* ============================================================
   Delta / comparison chip
   ============================================================ */

export function DeltaChip({
  direction, text, tone = 'auto', className,
}: {
  direction: 'up' | 'down' | 'flat'
  text: string
  /** `auto` = up is good. `inverse` = up is bad (e.g. overdue count). */
  tone?: 'auto' | 'inverse' | 'neutral'
  className?: string
}) {
  const good = tone === 'neutral' ? null : tone === 'inverse' ? direction === 'down' : direction === 'up'
  const Icon = direction === 'up' ? TrendingUp : direction === 'down' ? TrendingDown : Minus
  return (
    <span
      className={cn(
        'dash-delta',
        direction === 'flat' || good === null ? 'is-flat' : good ? 'is-good' : 'is-bad',
        className,
      )}
    >
      <Icon aria-hidden='true' />
      <span>{text}</span>
    </span>
  )
}

/* ============================================================
   Health badge — icon + text + tone (never colour alone).
   ============================================================ */

const HEALTH_ICON: Record<HealthState, React.ComponentType<{ className?: string }>> = {
  completed: CheckCircle2,
  on_track: TrendingUp,
  at_risk: AlertTriangle,
  behind: Clock3,
  inactive: MoonStar,
  no_deadline: CircleSlash,
}

export function HealthBadge({
  health, reasons, compact = false,
}: { health: HealthState; reasons?: string[]; compact?: boolean }) {
  const meta = HEALTH_META[health]
  const Icon = HEALTH_ICON[health]
  const badge = (
    <span className={cn('dash-health', `tone-${meta.tone}`, compact && 'is-compact')}>
      <Icon className='h-3.5 w-3.5' aria-hidden='true' />
      <span>{meta.label}</span>
    </span>
  )
  if (!reasons?.length) return badge
  return (
    <Tooltip
      content={
        <div>
          <div className='dash-tooltip-title'>Why “{meta.label}”?</div>
          <ul className='dash-tooltip-list'>
            {reasons.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
        </div>
      }
    >
      <button type='button' className='dash-health-btn' aria-label={`Health: ${meta.label}. Show why.`}>
        {badge}
      </button>
    </Tooltip>
  )
}

/* ============================================================
   Progress bar — thin, project-coloured.
   ============================================================ */

export function ProgressBar({
  value, color, height = 6, label, showTrack = true,
}: { value: number | null; color: string; height?: number; label?: string; showTrack?: boolean }) {
  const pct = value == null ? 0 : Math.max(0, Math.min(100, value))
  return (
    <div
      className={cn('dash-bar', !showTrack && 'is-bare')}
      style={{ height }}
      role='progressbar'
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label ?? 'Progress'}
    >
      <span className='dash-bar-fill' style={{ width: `${pct}%`, background: color }} />
    </div>
  )
}

/* ============================================================
   Section shell — consistent panel + header for every section.
   ============================================================ */

export function Section({
  title, subtitle, actions, children, className, info, bodyClassName, id,
}: {
  title: string
  subtitle?: React.ReactNode
  actions?: React.ReactNode
  children: React.ReactNode
  className?: string
  info?: React.ReactNode
  bodyClassName?: string
  id?: string
}) {
  const headingId = useId()
  return (
    <section className={cn('dash-panel', className)} aria-labelledby={headingId} id={id}>
      <header className='dash-panel-head'>
        <div className='min-w-0'>
          <h2 id={headingId} className='dash-panel-title'>
            {title}
            {info && <MetricInfo label={title}>{info}</MetricInfo>}
          </h2>
          {subtitle && <div className='dash-panel-sub'>{subtitle}</div>}
        </div>
        {actions && <div className='dash-panel-actions'>{actions}</div>}
      </header>
      <div className={cn('dash-panel-body', bodyClassName)}>{children}</div>
    </section>
  )
}

/* ============================================================
   Loading skeletons
   ============================================================ */

export function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <span className={cn('dash-skel', className)} style={style} aria-hidden='true' />
}

export function DashboardSkeleton() {
  return (
    <div className='dash-root' aria-busy='true' aria-live='polite'>
      <span className='sr-only'>Loading progress analytics…</span>
      <div className='dash-header'>
        <Skeleton className='h-7 w-52' />
        <div className='dash-header-controls'>
          <Skeleton className='h-9 w-40' />
          <Skeleton className='h-9 w-32' />
          <Skeleton className='h-9 w-24' />
        </div>
      </div>
      <div className='dash-stats'>
        {[0, 1, 2, 3].map(i => (
          <div key={i} className='dash-panel dash-stat'>
            <Skeleton className='h-4 w-24' />
            <Skeleton className='mt-3 h-8 w-20' />
            <Skeleton className='mt-3 h-3 w-32' />
            <Skeleton className='mt-4 h-8 w-full' />
          </div>
        ))}
      </div>
      <div className='dash-main'>
        <div className='dash-panel p-4'>
          <Skeleton className='h-4 w-36' />
          <Skeleton className='mt-4 h-[240px] w-full' />
        </div>
        <div className='dash-panel p-4'>
          <Skeleton className='h-4 w-32' />
          {[0, 1, 2, 3].map(i => <Skeleton key={i} className='mt-3 h-12 w-full' />)}
        </div>
      </div>
      <div className='dash-panel p-4'>
        <Skeleton className='h-4 w-40' />
        {[0, 1, 2].map(i => <Skeleton key={i} className='mt-3 h-11 w-full' />)}
      </div>
    </div>
  )
}

/* ============================================================
   Empty states
   ============================================================ */

export function EmptyState({
  icon: Icon = Info, title, desc, action, compact = false,
}: {
  icon?: React.ComponentType<{ className?: string }>
  title: string
  desc?: string
  action?: React.ReactNode
  compact?: boolean
}) {
  return (
    <div className={cn('dash-empty', compact && 'is-compact')}>
      <span className='dash-empty-icon' aria-hidden='true'><Icon className='h-4 w-4' /></span>
      <div className='dash-empty-title'>{title}</div>
      {desc && <div className='dash-empty-desc'>{desc}</div>}
      {action && <div className='mt-3'>{action}</div>}
    </div>
  )
}

/** Screen-reader-only text summary attached to every chart, so the data is
 *  available without seeing the graphic. */
export function ChartSummary({ children }: { children: React.ReactNode }) {
  return <p className='sr-only'>{children}</p>
}
