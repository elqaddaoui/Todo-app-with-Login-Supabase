/* ============================================================
   Progress Dashboard — charts
   ------------------------------------------------------------
   All charts are hand-drawn SVG: no charting dependency, full control over
   the dark-theme palette, and every element can carry an accessible label.

   Shared conventions
   ------------------
   * A responsive <svg> with a fixed viewBox scales crisply at any size.
   * Grid lines stay very low contrast; the DATA is the brightest thing.
   * Gradients are used only as soft area fills — never as decoration.
   * Every chart renders a screen-reader summary alongside the graphic.
   ============================================================ */

import React, { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ChartSummary, cn } from './primitives'
import {
  formatMinutes, parseDayKey, type DayPoint, type TrendMetric, type TrendSeries,
} from './metrics'

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const fmtDay = (key: string, opts: { weekday?: boolean } = {}) => {
  const d = parseDayKey(key)
  const md = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  if (!opts.weekday) return md
  return `${d.toLocaleDateString(undefined, { weekday: 'short' })} ${md}`
}

const niceCeil = (v: number): number => {
  if (v <= 0) return 1
  const mag = Math.pow(10, Math.floor(Math.log10(v)))
  const n = v / mag
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10
  return step * mag
}

/** Measure a container's live width so a chart can draw its viewBox 1:1.
 *
 *  Charts that contain TEXT must never be stretched with
 *  `preserveAspectRatio='none'` — a fixed viewBox scaled to an arbitrary
 *  container width squashes or smears the glyphs (and the bar corner radii)
 *  by whatever the width ratio happens to be. Drawing at the real pixel width
 *  keeps type crisp and geometry honest at every breakpoint. */
function useWidth<T extends HTMLElement>(fallback: number) {
  const ref = useRef<T | null>(null)
  const [w, setW] = useState(fallback)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const read = () => setW(prev => {
      const next = el.getBoundingClientRect().width
      return next > 0 && Math.abs(next - prev) > 0.5 ? next : prev
    })
    read()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w] as const
}

/** Catmull-Rom → cubic Bézier, for a smooth line that still passes through
 *  every real data point (no invented peaks). */
function smoothPath(pts: { x: number; y: number }[]): string {
  if (pts.length === 0) return ''
  if (pts.length === 1) return `M ${pts[0].x} ${pts[0].y}`
  let d = `M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[i + 2] ?? p2
    const t = 0.2
    const c1x = p1.x + (p2.x - p0.x) * t
    const c1y = p1.y + (p2.y - p0.y) * t
    const c2x = p2.x - (p3.x - p1.x) * t
    const c2y = p2.y - (p3.y - p1.y) * t
    d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)} ${c2x.toFixed(2)} ${c2y.toFixed(2)} ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`
  }
  return d
}

/* ============================================================
   Sparkline — micro chart inside a stat card.
   ============================================================ */

export function Sparkline({
  values, color = 'hsl(var(--focus))', height = 34, ariaLabel, showBaseline = true,
}: {
  values: number[]
  color?: string
  height?: number
  ariaLabel?: string
  /** Draw a zero line when the series contains negative values. */
  showBaseline?: boolean
}) {
  const W = 120
  const H = 40
  const pad = 4
  const n = values.length
  if (n === 0) return <div className='dash-spark is-empty' aria-hidden='true' />

  const min = Math.min(0, ...values)
  const max = Math.max(0, ...values)
  const span = max - min || 1
  const step = n > 1 ? (W - pad * 2) / (n - 1) : 0
  const yFor = (v: number) => pad + (H - pad * 2) * (1 - (v - min) / span)
  const pts = values.map((v, i) => ({ x: pad + i * step, y: yFor(v) }))
  const line = smoothPath(pts)
  const zeroY = yFor(0)
  const area = `${line} L ${pts[pts.length - 1].x.toFixed(2)} ${zeroY.toFixed(2)} L ${pts[0].x.toFixed(2)} ${zeroY.toFixed(2)} Z`
  const gid = `spark-${Math.abs(values.reduce((s, v, i) => s + v * (i + 1), 0)).toFixed(0)}-${n}`
  const last = pts[pts.length - 1]

  return (
    <svg
      className='dash-spark'
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio='none'
      style={{ height }}
      role='img'
      aria-label={ariaLabel ?? 'Trend sparkline'}
    >
      <defs>
        <linearGradient id={gid} x1='0' y1='0' x2='0' y2='1'>
          <stop offset='0%' stopColor={color} stopOpacity='0.28' />
          <stop offset='100%' stopColor={color} stopOpacity='0' />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gid})`} />
      {showBaseline && min < 0 && (
        <line x1={pad} x2={W - pad} y1={zeroY} y2={zeroY} className='dash-spark-zero' />
      )}
      <path d={line} fill='none' stroke={color} strokeWidth='1.75' strokeLinecap='round' strokeLinejoin='round' />
      <circle cx={last.x} cy={last.y} r='2.4' fill={color} />
    </svg>
  )
}

/* ============================================================
   Activity strip — one cell per day in the period.
   ============================================================ */

export function ActivityStrip({
  days, max = 7,
}: {
  days: { dayKey: string; active: boolean; completed: number }[]
  /** Show at most this many cells (keeps 30D readable inside a card). */
  max?: number
}) {
  const shown = days.slice(-max)
  return (
    <div className='dash-strip' role='list' aria-label='Daily activity'>
      {shown.map(d => (
        <span
          key={d.dayKey}
          role='listitem'
          className={cn('dash-strip-cell', d.active && 'is-active')}
          title={`${fmtDay(d.dayKey, { weekday: true })} — ${d.active ? `${d.completed} completed` : 'no activity'}`}
          aria-label={`${fmtDay(d.dayKey, { weekday: true })}: ${d.active ? `active, ${d.completed} completed` : 'inactive'}`}
        >
          <span className='dash-strip-letter' aria-hidden='true'>
            {parseDayKey(d.dayKey).toLocaleDateString(undefined, { weekday: 'narrow' })}
          </span>
        </span>
      ))}
    </div>
  )
}

/* ============================================================
   Progress trend — multi-series line / area chart.
   ============================================================ */

export function TrendChart({
  series, dayKeys, metric, height = 260, groupedCount = 0,
}: {
  series: TrendSeries[]
  dayKeys: string[]
  metric: TrendMetric
  height?: number
  groupedCount?: number
}) {
  const [hover, setHover] = useState<number | null>(null)
  const [wrapRef, measured] = useWidth<HTMLDivElement>(720)

  const W = Math.max(320, measured)
  const H = height
  const PAD = { top: 16, right: 14, bottom: 26, left: 40 }
  const innerW = W - PAD.left - PAD.right
  const innerH = H - PAD.top - PAD.bottom
  const n = dayKeys.length

  const unit = metric === 'progress' ? 'pp' : metric === 'completed' ? 'tasks' : 'min'

  const { min, max, ticks } = useMemo(() => {
    const all = series.flatMap(s => s.values)
    const lo = Math.min(0, ...all)
    const hi = Math.max(...all, metric === 'progress' ? 1 : 1)
    const top = niceCeil(hi || 1)
    const bottom = lo < 0 ? -niceCeil(Math.abs(lo)) : 0
    const count = 4
    const t: number[] = []
    for (let i = 0; i <= count; i++) t.push(bottom + ((top - bottom) * i) / count)
    return { min: bottom, max: top, ticks: t }
  }, [series, metric])

  const span = max - min || 1
  const step = n > 1 ? innerW / (n - 1) : 0
  const xFor = (i: number) => PAD.left + i * step
  const yFor = (v: number) => PAD.top + innerH * (1 - (v - min) / span)

  const fmtTick = (v: number) => {
    if (metric === 'workload') return v >= 60 ? `${Math.round(v / 60)}h` : `${Math.round(v)}m`
    return metric === 'progress' ? `${v.toFixed(0)}` : `${Math.round(v)}`
  }
  const fmtValue = (v: number) =>
    metric === 'progress'
      ? `${v >= 0 ? '+' : ''}${v.toFixed(1)} pp`
      : metric === 'workload'
        ? formatMinutes(v)
        : `${Math.round(v)} ${Math.round(v) === 1 ? 'task' : 'tasks'}`

  // Fewer x labels on dense periods so they never collide. The budget is
  // driven by the MEASURED width (~62px per "Aug 25" label), so narrow
  // screens automatically thin the axis out instead of overlapping.
  const labelBudget = Math.max(2, Math.floor(innerW / 62))
  const labelEvery = Math.max(1, Math.ceil(n / labelBudget))

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const rel = ((e.clientX - rect.left) / rect.width) * W
    const i = Math.round((rel - PAD.left) / (step || 1))
    setHover(Math.max(0, Math.min(n - 1, i)))
  }

  const single = series.length === 1

  const summary = useMemo(() => {
    const parts = series.map(s => {
      const total = s.values.reduce((a, b) => a + b, 0)
      const label = metric === 'progress'
        ? `${total >= 0 ? '+' : ''}${total.toFixed(1)} pp`
        : metric === 'workload' ? formatMinutes(total) : `${Math.round(total)} tasks`
      return `${s.name}: ${label}`
    })
    return `${metric === 'progress' ? 'Progress change' : metric === 'completed' ? 'Tasks completed' : 'Estimated workload'} across ${n} days. ${parts.join('. ')}.`
  }, [series, metric, n])

  return (
    <div className='dash-chart' ref={wrapRef}>
      <ChartSummary>{summary}</ChartSummary>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width={W}
        height={H}
        style={{ height }}
        className='dash-chart-svg'
        role='img'
        aria-label={summary}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        <defs>
          {series.map(s => (
            <linearGradient key={s.id} id={`trend-${s.id}`} x1='0' y1='0' x2='0' y2='1'>
              <stop offset='0%' stopColor={s.color} stopOpacity={single ? 0.3 : 0.16} />
              <stop offset='100%' stopColor={s.color} stopOpacity='0' />
            </linearGradient>
          ))}
        </defs>

        {/* Horizontal grid + y labels */}
        <g className='dash-grid'>
          {ticks.map((t, i) => (
            <g key={i}>
              <line x1={PAD.left} x2={W - PAD.right} y1={yFor(t)} y2={yFor(t)} className={cn(t === 0 && min < 0 && 'is-zero')} />
              <text x={PAD.left - 8} y={yFor(t) + 3.5} textAnchor='end' className='dash-axis'>{fmtTick(t)}</text>
            </g>
          ))}
        </g>

        {/* Hover guide */}
        {hover != null && (
          <line x1={xFor(hover)} x2={xFor(hover)} y1={PAD.top} y2={PAD.top + innerH} className='dash-chart-guide' />
        )}

        {/* Series */}
        {series.map(s => {
          const pts = s.values.map((v, i) => ({ x: xFor(i), y: yFor(v) }))
          const line = smoothPath(pts)
          const base = yFor(Math.max(min, 0))
          const area = pts.length > 1
            ? `${line} L ${pts[pts.length - 1].x.toFixed(2)} ${base.toFixed(2)} L ${pts[0].x.toFixed(2)} ${base.toFixed(2)} Z`
            : ''
          return (
            <g key={s.id} className={cn('dash-series', s.aggregate && 'is-aggregate')}>
              {area && <path d={area} fill={`url(#trend-${s.id})`} />}
              <path
                d={line}
                fill='none'
                stroke={s.color}
                strokeWidth={single ? 2.4 : 2}
                strokeLinecap='round'
                strokeLinejoin='round'
                strokeDasharray={s.aggregate ? '5 4' : undefined}
              />
              {hover != null && pts[hover] && (
                <circle cx={pts[hover].x} cy={pts[hover].y} r='3.6' fill={s.color} className='dash-chart-dot' />
              )}
            </g>
          )
        })}

        {/* X labels */}
        <g>
          {dayKeys.map((k, i) => (
            i % labelEvery === 0 || i === n - 1 ? (
              <text key={k} x={xFor(i)} y={H - 8} textAnchor='middle' className='dash-axis'>
                {fmtDay(k)}
              </text>
            ) : null
          ))}
        </g>
      </svg>

      {/* Tooltip: date + per-project progress / completed / workload */}
      {hover != null && (
        <div
          className='dash-chart-tip'
          style={{ left: `${((xFor(hover) / W) * 100).toFixed(2)}%` }}
          role='status'
        >
          <div className='dash-chart-tip-date'>{fmtDay(dayKeys[hover], { weekday: true })}</div>
          <div className='dash-chart-tip-rows'>
            {series.map(s => {
              const p: DayPoint | undefined = s.points[hover]
              return (
                <div key={s.id} className='dash-chart-tip-row'>
                  <span className='dash-dot' style={{ background: s.color }} aria-hidden='true' />
                  <span className='dash-chart-tip-name'>{s.name}</span>
                  <span className='dash-chart-tip-val'>{fmtValue(s.values[hover] ?? 0)}</span>
                  {p && (
                    <span className='dash-chart-tip-meta'>
                      {p.completed} done · {formatMinutes(p.workload)}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
          <div className='dash-chart-tip-foot'>Estimated workload · {unit}</div>
        </div>
      )}

      {/* Legend */}
      <div className='dash-legend'>
        {series.map(s => (
          <span key={s.id} className='dash-legend-item'>
            <span className={cn('dash-dot', s.aggregate && 'is-hollow')} style={{ background: s.color }} aria-hidden='true' />
            {s.name}
          </span>
        ))}
        {groupedCount > 0 && (
          <span className='dash-legend-note'>Showing the 5 most active projects</span>
        )}
      </div>
    </div>
  )
}

/* ============================================================
   Mini day chart — used inside an expanded project row.
   ============================================================ */

export function MiniDayChart({
  points, color, height = 76,
}: { points: DayPoint[]; color: string; height?: number }) {
  const [wrapRef, measured] = useWidth<HTMLDivElement>(300)
  const W = Math.max(200, measured)
  const H = height
  const pad = { t: 8, b: 14, l: 2, r: 2 }
  const n = points.length
  if (n === 0) return null
  const max = Math.max(1, ...points.map(p => p.completed))
  const bw = Math.min(16, ((W - pad.l - pad.r) / n) * 0.6)
  const step = (W - pad.l - pad.r) / n
  const innerH = H - pad.t - pad.b

  const gainPts = points.map((p, i) => ({
    x: pad.l + step * i + step / 2,
    y: pad.t + innerH * (1 - Math.max(0, Math.min(1, p.progress / Math.max(1, Math.max(...points.map(q => Math.abs(q.progress)))))) ),
  }))

  return (
    <div className='dash-mini' ref={wrapRef}>
      <ChartSummary>
        Daily detail: {points.map(p => `${fmtDay(p.dayKey)} ${p.completed} completed, ${p.progress >= 0 ? '+' : ''}${p.progress.toFixed(1)} pp`).join('; ')}.
      </ChartSummary>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} style={{ height }} role='img' aria-label='Daily progress detail'>
        <line x1={pad.l} x2={W - pad.r} y1={pad.t + innerH} y2={pad.t + innerH} className='dash-mini-base' />
        {points.map((p, i) => {
          const h = (p.completed / max) * innerH
          return (
            <rect
              key={p.dayKey}
              x={pad.l + step * i + (step - bw) / 2}
              y={pad.t + innerH - h}
              width={bw}
              height={Math.max(p.completed > 0 ? 2 : 0, h)}
              rx={2.5}
              fill={color}
              opacity={p.active ? 0.85 : 0.3}
            >
              <title>{`${fmtDay(p.dayKey, { weekday: true })} — ${p.completed} completed, ${formatMinutes(p.workload)}`}</title>
            </rect>
          )
        })}
        <path d={smoothPath(gainPts)} fill='none' stroke={color} strokeWidth='1.4' opacity='0.55' strokeLinecap='round' />
        {points.map((p, i) => (
          i % Math.max(1, Math.ceil(n / 6)) === 0 ? (
            <text key={`l-${p.dayKey}`} x={pad.l + step * i + step / 2} y={H - 3} textAnchor='middle' className='dash-axis is-xs'>
              {parseDayKey(p.dayKey).getDate()}
            </text>
          ) : null
        ))}
      </svg>
    </div>
  )
}

/* ============================================================
   Grouped bars — Completed vs Added.
   ============================================================ */

export function GroupedBars({
  groups, height = 150,
}: {
  groups: { label: string; bars: { key: string; label: string; value: number; color: string }[] }[]
  height?: number
}) {
  const [wrapRef, measured] = useWidth<HTMLDivElement>(340)
  const W = Math.max(180, measured)
  const H = height
  const pad = { t: 14, b: 26, l: 4, r: 4 }
  const innerH = H - pad.t - pad.b
  const all = groups.flatMap(g => g.bars.map(b => b.value))
  const max = niceCeil(Math.max(1, ...all))
  /* Bars are drawn inside a centred band rather than across the full width:
     with a single group a full-width slot leaves two narrow bars marooned in
     a sea of empty panel. The band keeps the group visually anchored. */
  const bandW = Math.min(W - pad.l - pad.r, 130 * Math.max(1, groups.length))
  const bandX = pad.l + (W - pad.l - pad.r - bandW) / 2
  const gw = bandW / Math.max(1, groups.length)

  return (
    <div className='dash-bars' ref={wrapRef}>
      <ChartSummary>
        {groups.map(g => `${g.label}: ${g.bars.map(b => `${b.label} ${b.value}`).join(', ')}`).join('. ')}.
      </ChartSummary>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} style={{ height }} role='img' aria-label='Completed versus added tasks'>
        {[0, 0.5, 1].map(t => (
          <line key={t} x1={pad.l} x2={W - pad.r} y1={pad.t + innerH * t} y2={pad.t + innerH * t} className='dash-grid-line' />
        ))}
        {groups.map((g, gi) => {
          const bars = g.bars
          const bw = Math.min(30, (gw * 0.62) / bars.length)
          const gap = 6
          const totalW = bars.length * bw + (bars.length - 1) * gap
          const x0 = bandX + gw * gi + (gw - totalW) / 2
          return (
            <g key={g.label}>
              {bars.map((b, bi) => {
                const h = (b.value / max) * innerH
                const x = x0 + bi * (bw + gap)
                return (
                  <g key={b.key}>
                    <rect
                      x={x} y={pad.t + innerH - Math.max(b.value > 0 ? 3 : 0, h)}
                      width={bw} height={Math.max(b.value > 0 ? 3 : 0, h)}
                      rx={4} fill={b.color}
                    >
                      <title>{`${b.label}: ${b.value}`}</title>
                    </rect>
                    <text x={x + bw / 2} y={pad.t + innerH - Math.max(b.value > 0 ? 3 : 0, h) - 5} textAnchor='middle' className='dash-bar-value'>
                      {b.value}
                    </text>
                  </g>
                )
              })}
              <text x={bandX + gw * gi + gw / 2} y={H - 8} textAnchor='middle' className='dash-axis'>{g.label}</text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
