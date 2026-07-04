import React, { useEffect, useMemo, useRef, useState } from 'react'
import { NavLink, Navigate, Route, Routes, useNavigate, useParams, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { useForm, Controller } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { motion, AnimatePresence } from 'framer-motion'
import { DndContext, DragOverlay, PointerSensor, TouchSensor, closestCenter, useSensor, useSensors, useDraggable, useDroppable, type DragEndEvent, type DragMoveEvent, type DragStartEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy, type SortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Calendar as BigCalendar, dateFnsLocalizer, Views, type View, type Event } from 'react-big-calendar'
import withDragAndDrop from 'react-big-calendar/lib/addons/dragAndDrop'
import { format, parse, startOfWeek, getDay, addDays, parseISO, isToday, isPast, endOfWeek, eachDayOfInterval, isWithinInterval, startOfMonth, endOfMonth, isSameMonth, isSameDay } from 'date-fns'
import { enUS } from 'date-fns/locale/en-US'
import {
  LayoutDashboard, Sun, CalendarDays, FolderKanban, Star, CheckCircle2, Archive, Hash, Settings,
  Search, Filter, Plus, Menu, PanelLeft, X, Clock3, Inbox, AlertCircle, ChevronLeft, ChevronRight,
  MoreHorizontal, Trash2, Pencil, Moon, Monitor, MessageSquare, Paperclip, ListChecks, GripVertical,
  Sparkles, Target, Rocket, BookOpen, Heart, Briefcase, Circle, PauseCircle, Ban, PlayCircle, CalendarClock,
  Copy, Link as LinkIcon, ExternalLink, FolderInput, Tag as TagIcon,
  Image as ImageIcon, MapPinned, ArrowUp, ArrowDown, Move, SlidersHorizontal,
  Undo2, Redo2, RotateCcw
} from 'lucide-react'
import { createPortal } from 'react-dom'

/* ============================================================
   Types
   ============================================================ */
type Status = 'not_started' | 'planned' | 'in_progress' | 'waiting' | 'blocked' | 'done' | 'cancelled'
type Priority = 'low' | 'medium' | 'high' | 'urgent'
type Category = 'work' | 'personal' | 'errands' | 'health' | 'learning' | 'finance' | 'social' | 'other'
type Tag = { id: string; name: string; color: string }
type Project = { id: string; name: string; icon: string; color: string; favorite?: boolean; parentId?: string; documentation: string; description?: string; order: number }
type TaskImage = { id: string; url: string; name?: string }
type Task = {
  id: string; title: string; description?: string; status: Status; priority: Priority; category: Category;
  projectId?: string; parentId?: string; tags: string[]; dueDate?: string; startDate?: string; time?: string;
  estimatedMinutes?: number; favorite?: boolean;
  checklist: { id: string; text: string; done: boolean }[];
  comments: { id: string; author: string; text: string; createdAt: string }[];
  images?: TaskImage[];
  attachments: { id: string; name: string; size: number }[];
  activity: { id: string; type: string; message: string; createdAt: string; by: string }[];
  archived?: boolean; createdAt: string; updatedAt: string; completedAt?: string; order: number
}
type Bootstrap = { tasks: Task[]; projects: Project[]; tags: Tag[] }

/* --------------------------------------------------------------
   Custom sorting strategy for task drag-and-drop.

   The default `verticalListSortingStrategy` from @dnd-kit animates every
   sibling item out of the way while dragging, which visually manifests as
   an "empty placeholder" the same height as the dragged card at the current
   hover position. We show our own thin drop-line indicator instead
   (see `.task-drop-line` in index.css), so we do NOT want dnd-kit to
   reserve any extra space. This no-op strategy tells @dnd-kit to keep
   every non-dragging item exactly where it is — no translate, no gap.

   The dragged item itself is already collapsed to height:0 in TaskRow
   (see `isDragging` branch), so removing the strategy-driven shift leaves
   the list layout completely stable during a drag.
   -------------------------------------------------------------- */
const noShiftSortingStrategy: SortingStrategy = () => null

/* ============================================================
   Constants / Seed
   ============================================================ */
const colors = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#f43f5e', '#8b5cf6', '#ec4899', '#14b8a6']
const statusMeta: Record<Status, { label: string; color: string; dot: string; hex: string; icon: React.ComponentType<{ className?: string }> }> = {
  not_started: { label: 'Not Started', color: 'text-zinc-500', dot: 'bg-zinc-400', hex: '#a1a1aa', icon: Circle },
  planned: { label: 'Planned', color: 'text-sky-600', dot: 'bg-sky-500', hex: '#0ea5e9', icon: CalendarClock },
  in_progress: { label: 'In Progress', color: 'text-amber-600', dot: 'bg-amber-500', hex: '#f59e0b', icon: PlayCircle },
  waiting: { label: 'Waiting', color: 'text-violet-600', dot: 'bg-violet-500', hex: '#8b5cf6', icon: PauseCircle },
  blocked: { label: 'Blocked', color: 'text-rose-600', dot: 'bg-rose-500', hex: '#f43f5e', icon: Ban },
  done: { label: 'Done', color: 'text-emerald-600', dot: 'bg-emerald-500', hex: '#10b981', icon: CheckCircle2 },
  cancelled: { label: 'Cancelled', color: 'text-zinc-500', dot: 'bg-zinc-400', hex: '#a1a1aa', icon: X },
}
const priorityMeta: Record<Priority, { label: string; color: string; hex: string; rank: number }> = {
  low: { label: 'Low', color: 'text-zinc-500', hex: '#71717a', rank: 1 },
  medium: { label: 'Medium', color: 'text-sky-600', hex: '#0ea5e9', rank: 2 },
  high: { label: 'High', color: 'text-amber-600', hex: '#f59e0b', rank: 3 },
  urgent: { label: 'Urgent', color: 'text-rose-600', hex: '#f43f5e', rank: 4 },
}
const iconMap: Record<string, React.ComponentType<{ className?: string; style?: React.CSSProperties }>> = { Rocket, Target, BookOpen, Heart, Briefcase, FolderKanban }
// NOTE: "All tasks" was duplicated — it lived both here in the nav list AND
// as the prominent "Show every task" link above. We removed it from this
// list so the sidebar only has ONE entry pointing to /all-tasks.
const navItems = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/today', label: 'Today', icon: Sun },
  { to: '/upcoming', label: 'Upcoming', icon: Inbox },
  { to: '/calendar', label: 'Calendar', icon: CalendarDays },
  { to: '/projects', label: 'Projects', icon: FolderKanban },
  { to: '/favorites', label: 'Favorites', icon: Star },
  { to: '/completed', label: 'Completed', icon: CheckCircle2 },
  { to: '/archive', label: 'Archive', icon: Archive },
  { to: '/tags', label: 'Tags', icon: Hash },
  { to: '/settings', label: 'Settings', icon: Settings },
]
const todayStr = format(new Date(), 'yyyy-MM-dd')
const d = (n: number) => format(addDays(new Date(), n), 'yyyy-MM-dd')
const nowIso = () => new Date().toISOString()

const boot: Bootstrap = {
  tags: [
    { id: 'design', name: 'design', color: '#8b5cf6' },
    { id: 'frontend', name: 'frontend', color: '#0ea5e9' },
    { id: 'bug', name: 'bug', color: '#ef4444' },
    { id: 'meeting', name: 'meeting', color: '#6366f1' },
    { id: 'review', name: 'review', color: '#ec4899' },
  ],
  projects: [
    { id: 'orbit', name: 'Orbit Redesign', icon: 'Rocket', color: '#6366f1', favorite: true, description: 'Q3 product refresh', documentation: '# Orbit Redesign\n\n## Goals\n- Calm\n- Fast\n- Readable\n\n## Notes\n- [x] Dashboard IA\n- [ ] Calendar interactions\n- [ ] Mobile polish\n\n> The app should feel like a calm command center.', order: 0 },
    { id: 'mobile', name: 'Mobile App', icon: 'Target', color: '#0ea5e9', parentId: 'orbit', documentation: '# Mobile\n\nNative shell and offline polish.', order: 1 },
    { id: 'learning', name: 'Learning', icon: 'BookOpen', color: '#f59e0b', documentation: '# Learning\n\nBooks, courses, experiments.', order: 2 },
    { id: 'personal', name: 'Personal', icon: 'Heart', color: '#f43f5e', favorite: true, documentation: '# Personal\n\nLife admin and side quests.', order: 3 },
  ],
  tasks: [
    { id: '1', title: 'Design new dashboard layout', description: 'Explore Linear and Vercel density patterns.', status: 'in_progress', priority: 'high', category: 'work', projectId: 'orbit', tags: ['design', 'frontend'], dueDate: todayStr, time: '14:00', estimatedMinutes: 120, favorite: true, checklist: [{ id: 'c1', text: 'Wireframes', done: true }, { id: 'c2', text: 'Spacing system', done: false }], comments: [{ id: 'cm1', author: 'Alex', text: 'Try a denser variant.', createdAt: nowIso() }], attachments: [{ id: 'a1', name: 'moodboard.fig', size: 324000 }], activity: [{ id: 'ac1', type: 'created', message: 'Task created', createdAt: nowIso(), by: 'You' }], createdAt: nowIso(), updatedAt: nowIso(), order: 0 },
    { id: '2', title: 'Weekly standup', status: 'planned', priority: 'medium', category: 'work', projectId: 'orbit', tags: ['meeting'], dueDate: todayStr, time: '10:00', estimatedMinutes: 30, favorite: false, checklist: [], comments: [], attachments: [], activity: [{ id: 'ac2', type: 'created', message: 'Task created', createdAt: nowIso(), by: 'You' }], createdAt: nowIso(), updatedAt: nowIso(), order: 1 },
    { id: '3', title: 'Review PR #482', status: 'not_started', priority: 'urgent', category: 'work', projectId: 'orbit', tags: ['review', 'frontend'], dueDate: todayStr, time: '16:30', estimatedMinutes: 45, favorite: true, checklist: [], comments: [], attachments: [], activity: [{ id: 'ac3', type: 'created', message: 'Task created', createdAt: nowIso(), by: 'You' }], createdAt: nowIso(), updatedAt: nowIso(), order: 2 },
    { id: '4', title: 'Refactor task store', status: 'in_progress', priority: 'medium', category: 'work', projectId: 'orbit', tags: ['frontend'], dueDate: d(1), estimatedMinutes: 180, favorite: false, checklist: [], comments: [], attachments: [], activity: [{ id: 'ac4', type: 'created', message: 'Task created', createdAt: nowIso(), by: 'You' }], createdAt: nowIso(), updatedAt: nowIso(), order: 3 },
    { id: '5', title: 'Fix calendar overflow bug', status: 'blocked', priority: 'high', category: 'work', projectId: 'orbit', tags: ['bug'], dueDate: d(-1), estimatedMinutes: 60, favorite: false, checklist: [], comments: [], attachments: [], activity: [{ id: 'ac5', type: 'created', message: 'Task created', createdAt: nowIso(), by: 'You' }], createdAt: nowIso(), updatedAt: nowIso(), order: 4 },
    { id: '6', title: 'Build mobile shell prototype', status: 'in_progress', priority: 'high', category: 'work', projectId: 'mobile', tags: ['frontend'], dueDate: d(4), estimatedMinutes: 480, favorite: false, checklist: [{ id: 'm1', text: 'Choose framework', done: true }, { id: 'm2', text: 'Offline cache', done: false }], comments: [], attachments: [], activity: [{ id: 'ac6', type: 'created', message: 'Task created', createdAt: nowIso(), by: 'You' }], createdAt: nowIso(), updatedAt: nowIso(), order: 5 },
    { id: '7', title: 'Navigation spec', status: 'planned', priority: 'medium', category: 'work', projectId: 'mobile', parentId: '6', tags: ['frontend'], dueDate: d(2), estimatedMinutes: 60, favorite: false, checklist: [], comments: [], attachments: [], activity: [{ id: 'ac7', type: 'created', message: 'Task created', createdAt: nowIso(), by: 'You' }], createdAt: nowIso(), updatedAt: nowIso(), order: 6 },
    { id: '8', title: 'Read A Philosophy of Software Design', status: 'in_progress', priority: 'low', category: 'learning', projectId: 'learning', tags: [], dueDate: d(5), estimatedMinutes: 240, favorite: false, checklist: [], comments: [], attachments: [], activity: [{ id: 'ac8', type: 'created', message: 'Task created', createdAt: nowIso(), by: 'You' }], createdAt: nowIso(), updatedAt: nowIso(), order: 7 },
    { id: '9', title: 'Buy groceries', status: 'not_started', priority: 'low', category: 'errands', projectId: 'personal', tags: [], dueDate: todayStr, time: '18:00', estimatedMinutes: 45, favorite: false, checklist: [{ id: 'g1', text: 'Oat milk', done: false }, { id: 'g2', text: 'Olive oil', done: false }], comments: [], attachments: [], activity: [{ id: 'ac9', type: 'created', message: 'Task created', createdAt: nowIso(), by: 'You' }], createdAt: nowIso(), updatedAt: nowIso(), order: 8 },
    { id: '10', title: 'Coffee with Maya', status: 'planned', priority: 'low', category: 'social', projectId: 'personal', tags: [], dueDate: d(1), time: '15:30', estimatedMinutes: 60, favorite: false, checklist: [], comments: [], attachments: [], activity: [{ id: 'ac10', type: 'created', message: 'Task created', createdAt: nowIso(), by: 'You' }], createdAt: nowIso(), updatedAt: nowIso(), order: 9 },
    { id: '11', title: 'Run 5K', status: 'done', priority: 'low', category: 'health', projectId: 'personal', tags: [], dueDate: d(-1), estimatedMinutes: 40, completedAt: nowIso(), favorite: false, checklist: [], comments: [], attachments: [], activity: [{ id: 'ac11', type: 'completed', message: 'Task completed', createdAt: nowIso(), by: 'You' }], createdAt: nowIso(), updatedAt: nowIso(), order: 10 },
  ],
}

const localizer = dateFnsLocalizer({ format, parse, startOfWeek: (dt: Date) => startOfWeek(dt, { weekStartsOn: 1 }), getDay, locales: { 'en-US': enUS } })
const DragAndDropCalendar = withDragAndDrop(BigCalendar as any) as any
const cn = (...x: (string | false | undefined | null)[]) => x.filter(Boolean).join(' ')

const useMedia = (q: string) => {
  const [m, set] = useState(typeof window !== 'undefined' ? window.matchMedia(q).matches : false)
  useEffect(() => {
    const mq = window.matchMedia(q)
    const h = (e: MediaQueryListEvent) => set(e.matches)
    mq.addEventListener('change', h)
    return () => mq.removeEventListener('change', h)
  }, [q])
  return m
}

const readFileAsDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve(String(reader.result || ''))
  reader.onerror = () => reject(reader.error)
  reader.readAsDataURL(file)
})

const parseNL = (txt: string) => {
  let title = txt.trim(), dueDate: string | undefined, time: string | undefined, priority: Priority | undefined
  if (/tomorrow/i.test(title)) { dueDate = d(1); title = title.replace(/tomorrow/i, '').trim() }
  if (/today/i.test(title)) { dueDate = todayStr; title = title.replace(/today/i, '').trim() }
  const tm = title.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i)
  if (tm) {
    let h = +tm[1], m = +(tm[2] || 0)
    if (tm[3].toLowerCase() === 'pm' && h < 12) h += 12
    if (tm[3].toLowerCase() === 'am' && h === 12) h = 0
    time = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
    title = title.replace(tm[0], '').trim()
  }
  if (/!high|!p2/i.test(title)) { priority = 'high'; title = title.replace(/!high|!p2/i, '').trim() }
  if (/!urgent|!p1/i.test(title)) { priority = 'urgent'; title = title.replace(/!urgent|!p1/i, '').trim() }
  return { title: title || txt, dueDate, time, priority }
}

/* ============================================================
   Stores
   ============================================================ */
/* Global sort keys shared across the app. "selected" floats favorited tasks to
   the top (a lightweight "pin what I care about" mode). */
type SortKey = 'updated' | 'selected' | 'created' | 'due' | 'priority' | 'title'
type SortDir = 'asc' | 'desc'
type FilterState = { search: string; projectIds: string[]; statuses: Status[]; priorities: Priority[]; tags: string[]; favoriteOnly: boolean; sort: SortKey; sortDir: SortDir }
const baseFilter: FilterState = { search: '', projectIds: [], statuses: [], priorities: [], tags: [], favoriteOnly: false, sort: 'updated', sortDir: 'desc' }

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'updated', label: 'Updated' },
  { key: 'created', label: 'Created' },
  { key: 'due', label: 'Due Date' },
  { key: 'priority', label: 'Priority' },
  { key: 'title', label: 'Title' },
]

/* Walk up the parent chain starting at `startId`. Any ancestor whose status
   is 'done' is flipped back to 'in_progress' — because a completed parent
   shouldn't logically contain an unfinished child. Returns a new tasks array. */
function propagateUnfinishedUp(tasks: Task[], startId: string | undefined): Task[] {
  if (!startId) return tasks
  const byId = new Map(tasks.map(t => [t.id, t]))
  const toFlip = new Set<string>()
  let cur: string | undefined = startId
  // Guard against malformed/cyclic data (shouldn't happen — setParent prevents it)
  let safety = 0
  while (cur && safety++ < 1000) {
    const node = byId.get(cur)
    if (!node) break
    if (node.status === 'done') toFlip.add(node.id)
    cur = node.parentId
  }
  if (toFlip.size === 0) return tasks
  const stamp = nowIso()
  return tasks.map(t => toFlip.has(t.id)
    ? { ...t, status: 'in_progress' as Status, completedAt: undefined, updatedAt: stamp }
    : t)
}

const useUI = create<{
  sidebar: boolean; mobileNav: boolean; details: boolean; selected: string | null; calendarTarget: string | null;
  quick: boolean; command: boolean; filters: boolean;
  theme: 'light' | 'dark' | 'system'; sidebarW: number; detailsW: number;
  compactMode: boolean;
  dndEnabled: boolean;
  calendarSidePanel: boolean;
  quickParentId: string | null;
  quickSettings: boolean;
  // Undo/Redo toast preferences
  undoToastEnabled: boolean;
  undoToastDuration: number; // milliseconds the toast stays visible
  set: (p: Partial<any>) => void
}>()(persist(
  (set) => ({
    sidebar: true, mobileNav: false, details: false, selected: null, calendarTarget: null,
    quick: false, command: false, filters: false,
    theme: 'system', sidebarW: 280, detailsW: 380,
    compactMode: false,
    dndEnabled: true,
    calendarSidePanel: true,
    quickParentId: null,
    quickSettings: false,
    undoToastEnabled: true,
    undoToastDuration: 2000,
    set: (p) => set(p),
  }),
  { name: 'orbit-ui' }
))

/** Global drag-and-drop toggle. Read this anywhere a drag interaction is
 *  wired up; when it returns false the interaction must become inert. */
const useDndEnabled = () => useUI(s => s.dndEnabled)

// Apply compact mode class to <html> so CSS can target it globally
const applyCompactMode = (on: boolean) => {
  const root = document.documentElement
  if (on) root.classList.add('compact-mode')
  else root.classList.remove('compact-mode')
}

const useData = create<{
  booted: boolean; tasks: Task[]; projects: Project[]; tags: Tag[]; filters: FilterState;
  hydrate: (b: Bootstrap) => void;
  setFilters: (p: Partial<FilterState>) => void; resetFilters: () => void;
  addTask: (p: Partial<Task> & { title: string }) => void;
  updateTask: (id: string, p: Partial<Task>) => void;
  deleteTask: (id: string) => void;
  toggleDone: (id: string) => void;
  toggleFav: (id: string) => void;
  archiveTask: (id: string) => void;
  duplicateTask: (id: string) => void;
  moveTaskToProject: (id: string, projectId: string | undefined) => void;
  setParent: (id: string, parentId: string | undefined) => void;
  reorder: (ids: string[]) => void;
  addProject: (name: string) => void;
  updateProject: (id: string, p: Partial<Project>) => void;
  duplicateProject: (id: string) => void;
  deleteProject: (id: string) => void;
  toggleProjectFav: (id: string) => void;
  archiveProject: (id: string) => void;
  reorderProjects: (ids: string[]) => void;
  addTag: (name: string, color?: string) => void;
  updateTag: (id: string, p: Partial<Tag>) => void;
  deleteTag: (id: string) => void;
}>()(persist(
  (set, get) => ({
    booted: false, tasks: [], projects: [], tags: [], filters: baseFilter,
    hydrate: (b) => set(s => s.booted ? s : { booted: true, tasks: b.tasks, projects: b.projects, tags: b.tags }),
    setFilters: (p) => set(s => ({ filters: { ...s.filters, ...p } })),
    resetFilters: () => set({ filters: baseFilter }),
    addTask: (p) => set(s => {
      const newTask: Task = {
        id: String(Date.now()), title: p.title,
        status: p.status ?? 'not_started', priority: p.priority ?? 'medium', category: p.category ?? 'work',
        projectId: p.projectId, parentId: p.parentId, tags: p.tags ?? [],
        dueDate: p.dueDate, startDate: p.startDate, time: p.time,
        estimatedMinutes: p.estimatedMinutes ?? 60, favorite: p.favorite ?? false,
        description: p.description, checklist: p.checklist ?? [], comments: p.comments ?? [], images: p.images ?? [], attachments: p.attachments ?? [],
        activity: [{ id: 'a' + Date.now(), type: 'created', message: 'Task created', createdAt: nowIso(), by: 'You' }],
        createdAt: nowIso(), updatedAt: nowIso(), completedAt: undefined, order: s.tasks.length,
      }
      let tasks = [newTask, ...s.tasks]
      // Status propagation: if this new subtask is NOT done, no completed
      // ancestor should remain Done. Flip every Done ancestor → In Progress.
      if (newTask.parentId && newTask.status !== 'done') {
        tasks = propagateUnfinishedUp(tasks, newTask.parentId)
      }
      return { tasks }
    }),
    updateTask: (id, p) => set(s => ({ tasks: s.tasks.map(t => t.id === id ? { ...t, ...p, updatedAt: nowIso() } : t) })),
    deleteTask: (id) => set(s => ({ tasks: s.tasks.filter(t => t.id !== id && t.parentId !== id) })),
    toggleDone: (id) => set(s => ({
      tasks: s.tasks.map(t => t.id === id
        ? { ...t, status: t.status === 'done' ? 'not_started' : 'done', completedAt: t.status === 'done' ? undefined : nowIso(), updatedAt: nowIso() }
        : t)
    })),
    toggleFav: (id) => set(s => ({ tasks: s.tasks.map(t => t.id === id ? { ...t, favorite: !t.favorite } : t) })),
    archiveTask: (id) => set(s => ({ tasks: s.tasks.map(t => t.id === id ? { ...t, archived: !t.archived, updatedAt: nowIso() } : t) })),
    moveTaskToProject: (id, projectId) => set(s => ({ tasks: s.tasks.map(t => t.id === id ? { ...t, projectId, updatedAt: nowIso() } : t) })),
    setParent: (id, parentId) => set(s => {
      // Prevent cycles: refuse to set parent if it would create a loop
      if (id === parentId) return {}
      if (parentId) {
        // walk up the chain from parentId to make sure `id` isn't an ancestor of parentId
        const byId = new Map(s.tasks.map(t => [t.id, t]))
        let cur: string | undefined = parentId
        while (cur) {
          if (cur === id) return {}
          cur = byId.get(cur)?.parentId
        }
        // also inherit projectId so subtask groups stay coherent.
        // Inherit for the moved node AND for all of its descendants so the
        // whole subtree stays grouped under the new owning project.
        const newParent = byId.get(parentId)
        const newProjectId = newParent?.projectId
        const descendants = new Set<string>()
        const collect = (root: string) => {
          s.tasks.forEach(t => { if (t.parentId === root && !descendants.has(t.id)) { descendants.add(t.id); collect(t.id) } })
        }
        collect(id)
        let tasks = s.tasks.map(t => {
          if (t.id === id) return { ...t, parentId, projectId: newProjectId ?? t.projectId, updatedAt: nowIso() }
          if (descendants.has(t.id) && newProjectId) return { ...t, projectId: newProjectId, updatedAt: nowIso() }
          return t
        })
        // Status propagation: if any moved task (root OR descendants) is not
        // Done, no Done ancestor should remain. Walk up from the new parent
        // and flip Done ancestors to In Progress.
        const movedNodes = [id, ...Array.from(descendants)]
        const anyUnfinished = movedNodes.some(mid => {
          const t = tasks.find(x => x.id === mid)
          return t && t.status !== 'done' && t.status !== 'cancelled'
        })
        if (anyUnfinished) {
          tasks = propagateUnfinishedUp(tasks, parentId)
        }
        return { tasks }
      }
      return { tasks: s.tasks.map(t => t.id === id ? { ...t, parentId: undefined, updatedAt: nowIso() } : t) }
    }),
    duplicateTask: (id) => { const t = get().tasks.find(x => x.id === id); if (!t) return; get().addTask({ ...t, title: t.title + ' (copy)', status: 'not_started' }) },
    reorder: (ids) => set(s => {
      const sorted = [...s.tasks].sort((a, b) => a.order - b.order)
      const idSet = new Set(ids)
      const pos = sorted.map((t, i) => idSet.has(t.id) ? i : -1).filter(i => i >= 0)
      const map = new Map(sorted.map(t => [t.id, t]))
      const subset = ids.map(id => map.get(id)).filter(Boolean) as Task[]
      const next = [...sorted]
      pos.forEach((p, i) => { if (subset[i]) next[p] = subset[i] })
      return { tasks: next.map((t, i) => ({ ...t, order: i })) }
    }),
    addProject: (name) => set(s => ({
      projects: [...s.projects, {
        id: 'p' + Date.now(), name, icon: 'FolderKanban',
        color: colors[s.projects.length % colors.length],
        documentation: '# ' + name + '\n\nStart writing…', order: s.projects.length,
      }]
    })),
    updateProject: (id, p) => set(s => ({ projects: s.projects.map(x => x.id === id ? { ...x, ...p } : x) })),
    duplicateProject: (id) => { const p = get().projects.find(x => x.id === id); if (!p) return; const newId = 'p' + Date.now(); set(s => ({ projects: [...s.projects, { ...p, id: newId, name: p.name + ' (copy)', order: s.projects.length }] })) },
    deleteProject: (id) => set(s => ({
      projects: s.projects.filter(p => p.id !== id),
      tasks: s.tasks.map(t => t.projectId === id ? { ...t, projectId: undefined } : t)
    })),
    toggleProjectFav: (id) => set(s => ({ projects: s.projects.map(p => p.id === id ? { ...p, favorite: !p.favorite } : p) })),
    archiveProject: (id) => set(s => ({ projects: s.projects.map(p => p.id === id ? { ...p, favorite: false } : p), tasks: s.tasks.map(t => t.projectId === id ? { ...t, archived: true } : t) })),
    reorderProjects: (ids) => set(s => {
      const sorted = [...s.projects].sort((a, b) => a.order - b.order)
      const idSet = new Set(ids)
      const pos = sorted.map((p, i) => idSet.has(p.id) ? i : -1).filter(i => i >= 0)
      const map = new Map(sorted.map(p => [p.id, p]))
      const subset = ids.map(id => map.get(id)).filter(Boolean) as Project[]
      const next = [...sorted]
      pos.forEach((p, i) => { if (subset[i]) next[p] = subset[i] })
      return { projects: next.map((p, i) => ({ ...p, order: i })) }
    }),
    addTag: (name, color) => set(s => ({ tags: [...s.tags, { id: 't' + Date.now(), name, color: color || colors[s.tags.length % colors.length] }] })),
    updateTag: (id, p) => set(s => ({ tags: s.tags.map(t => t.id === id ? { ...t, ...p } : t) })),
    deleteTag: (id) => set(s => ({
      tags: s.tags.filter(t => t.id !== id),
      tasks: s.tasks.map(t => ({ ...t, tags: t.tags.filter(tg => tg !== id) }))
    })),
  }),
  {
    name: 'orbit-data',
    version: 3,
    // Deep-merge persisted filters onto the current defaults so older saved
    // state (which predates the `sort`/`sortDir` keys) always has every field.
    merge: (persisted, current) => {
      const p = (persisted ?? {}) as any
      return {
        ...current,
        ...p,
        filters: { ...baseFilter, ...(p.filters ?? {}) },
      }
    },
  }
))

/* ============================================================
   Global Command-based Undo / Redo system
   ------------------------------------------------------------
   Design
   ------
   Every reversible mutation in the app flows through the `useData`
   Zustand store (add/update/delete/toggle/move/reorder/… for tasks,
   projects and tags). Instead of writing a bespoke inverse for each of
   the ~25 actions, we take a *snapshot* of the three mutable data
   slices (tasks / projects / tags) before and after each action runs.
   A command records the { before, after } snapshots plus a
   human-readable label and a "merge key".

   • Undo  = re-apply a command's `before` snapshot.
   • Redo  = re-apply a command's `after`  snapshot.

   Because we restore the full slice, undo/redo reproduces the *exact*
   previous state with zero data loss — no matter how complex the action
   was (cascading subtask deletes, project moves that reparent whole
   subtrees, status propagation, reordering, etc.).

   Rapid edits are merged: consecutive commands that share a merge key
   within MERGE_WINDOW_MS collapse into one history entry (e.g. typing a
   title, dragging a slider), so a single Undo reverts the whole burst.

   The stack keeps at most HISTORY_LIMIT (100) commands.
   ============================================================ */

type DataSnapshot = { tasks: Task[]; projects: Project[]; tags: Tag[] }
type Command = {
  id: number
  label: string          // shown in the toast, e.g. "Edit task", "Delete project"
  before: DataSnapshot
  after: DataSnapshot
  mergeKey: string | null // consecutive same-key commands merge within the window
  time: number
}

const HISTORY_LIMIT = 100
const MERGE_WINDOW_MS = 600

const snapshot = (): DataSnapshot => {
  const s = useData.getState()
  return { tasks: s.tasks, projects: s.projects, tags: s.tags }
}
// Reference equality on the three arrays is enough: every action returns
// brand-new arrays, so an unchanged reference means "nothing happened".
const snapshotsEqual = (a: DataSnapshot, b: DataSnapshot) =>
  a.tasks === b.tasks && a.projects === b.projects && a.tags === b.tags

/* ---- Toast store: a tiny queue-of-one bottom notification. ---- */
type ToastKind = 'undo' | 'redo' | 'info'
const useToast = create<{
  open: boolean
  message: string
  kind: ToastKind
  token: number
  show: (message: string, kind?: ToastKind) => void
  hide: () => void
}>((set) => ({
  open: false,
  message: '',
  kind: 'info',
  token: 0,
  show: (message, kind = 'info') =>
    set(s => ({ open: true, message, kind, token: s.token + 1 })),
  hide: () => set({ open: false }),
}))

/* ---- History store ---- */
const useHistory = create<{
  past: Command[]
  future: Command[]
  canUndo: boolean
  canRedo: boolean
  push: (cmd: Command) => void
  undo: () => void
  redo: () => void
  clear: () => void
}>((set, get) => ({
  past: [],
  future: [],
  canUndo: false,
  canRedo: false,
  push: (cmd) => set(s => {
    let past = s.past
    const last = past[past.length - 1]
    // Merge rapid, same-kind edits into the previous command so one Undo
    // reverts the whole burst (e.g. every keystroke of a title edit).
    if (
      last &&
      cmd.mergeKey != null &&
      last.mergeKey === cmd.mergeKey &&
      cmd.time - last.time <= MERGE_WINDOW_MS
    ) {
      const merged: Command = { ...last, after: cmd.after, time: cmd.time }
      past = [...past.slice(0, -1), merged]
    } else {
      past = [...past, cmd]
      if (past.length > HISTORY_LIMIT) past = past.slice(past.length - HISTORY_LIMIT)
    }
    // Any new action invalidates the redo stack.
    return { past, future: [], canUndo: past.length > 0, canRedo: false }
  }),
  undo: () => {
    const { past, future } = get()
    if (past.length === 0) return
    const cmd = past[past.length - 1]
    applySnapshot(cmd.before)
    const nextPast = past.slice(0, -1)
    const nextFuture = [...future, cmd]
    set({ past: nextPast, future: nextFuture, canUndo: nextPast.length > 0, canRedo: true })
    if (useUI.getState().undoToastEnabled) useToast.getState().show(`Undo: ${cmd.label}`, 'undo')
  },
  redo: () => {
    const { past, future } = get()
    if (future.length === 0) return
    const cmd = future[future.length - 1]
    applySnapshot(cmd.after)
    const nextFuture = future.slice(0, -1)
    const nextPast = [...past, cmd]
    set({ past: nextPast, future: nextFuture, canUndo: true, canRedo: nextFuture.length > 0 })
    if (useUI.getState().undoToastEnabled) useToast.getState().show(`Redo: ${cmd.label}`, 'redo')
  },
  clear: () => set({ past: [], future: [], canUndo: false, canRedo: false }),
}))

/* Restore a data snapshot without itself being recorded as a new command.
   `suspendRecording` guards the wrapper installed below. */
let suspendRecording = false
const applySnapshot = (snap: DataSnapshot) => {
  suspendRecording = true
  try {
    useData.setState({ tasks: snap.tasks, projects: snap.projects, tags: snap.tags })
  } finally {
    suspendRecording = false
  }
}

/* ---- Per-action metadata: label shown in the toast + how to build the
   merge key for rapid-edit collapsing. Actions absent from this map are
   still recorded (with a generic label) so nothing is ever un-undoable. */
type ActionName =
  | 'addTask' | 'updateTask' | 'deleteTask' | 'toggleDone' | 'toggleFav'
  | 'archiveTask' | 'duplicateTask' | 'moveTaskToProject' | 'setParent' | 'reorder'
  | 'addProject' | 'updateProject' | 'duplicateProject' | 'deleteProject'
  | 'toggleProjectFav' | 'archiveProject' | 'reorderProjects'
  | 'addTag' | 'updateTag' | 'deleteTag'

const ACTION_LABELS: Record<ActionName, string> = {
  addTask: 'Create task',
  updateTask: 'Edit task',
  deleteTask: 'Delete task',
  toggleDone: 'Change status',
  toggleFav: 'Toggle favorite',
  archiveTask: 'Archive task',
  duplicateTask: 'Duplicate task',
  moveTaskToProject: 'Move task',
  setParent: 'Reparent task',
  reorder: 'Reorder tasks',
  addProject: 'Create project',
  updateProject: 'Edit project',
  duplicateProject: 'Duplicate project',
  deleteProject: 'Delete project',
  toggleProjectFav: 'Toggle project favorite',
  archiveProject: 'Archive project',
  reorderProjects: 'Reorder projects',
  addTag: 'Create tag',
  updateTag: 'Edit tag',
  deleteTag: 'Delete tag',
}

/* Build a human label; refine a few actions using their payload so the
   toast reads naturally ("Edit priority", "Complete task", …). */
const refineLabel = (name: ActionName, args: any[], before: DataSnapshot): string => {
  const base = ACTION_LABELS[name]
  if (name === 'updateTask') {
    const patch = (args?.[1] ?? {}) as Partial<Task>
    const keys = Object.keys(patch)
    if (keys.length === 1) {
      const k = keys[0]
      const map: Record<string, string> = {
        title: 'Rename task', description: 'Edit description', priority: 'Change priority',
        status: 'Change status', dueDate: 'Change due date', startDate: 'Change start date',
        time: 'Change time', category: 'Change category', tags: 'Edit tags',
        checklist: 'Edit subtasks', estimatedMinutes: 'Change estimate',
      }
      if (map[k]) return map[k]
    }
    if (keys.includes('checklist')) return 'Edit subtasks'
  }
  if (name === 'toggleDone') {
    const t = before.tasks.find(x => x.id === args?.[0])
    return t?.status === 'done' ? 'Reopen task' : 'Complete task'
  }
  if (name === 'toggleFav') {
    const t = before.tasks.find(x => x.id === args?.[0])
    return t?.favorite ? 'Remove favorite' : 'Add favorite'
  }
  return base
}

/* Merge key: rapid updates to the SAME task field collapse into one entry.
   Structural / one-shot actions return null so they always stand alone. */
const mergeKeyFor = (name: ActionName, args: any[]): string | null => {
  if (name === 'updateTask') {
    const id = args?.[0]
    const patch = (args?.[1] ?? {}) as Partial<Task>
    const keys = Object.keys(patch).sort().join(',')
    return `updateTask:${id}:${keys}`
  }
  if (name === 'updateProject') {
    const id = args?.[0]
    const patch = (args?.[1] ?? {}) as Partial<Project>
    return `updateProject:${id}:${Object.keys(patch).sort().join(',')}`
  }
  if (name === 'updateTag') {
    const id = args?.[0]
    const patch = (args?.[1] ?? {}) as Partial<Tag>
    return `updateTag:${id}:${Object.keys(patch).sort().join(',')}`
  }
  // reorder bursts (drag) also merge so one Undo reverts the whole drag.
  if (name === 'reorder') return 'reorder'
  if (name === 'reorderProjects') return 'reorderProjects'
  return null
}

/* Install the recording wrapper: replace each mutating action on the
   useData store with a version that snapshots before/after and records a
   command. Runs once at module load. Non-mutating helpers (hydrate,
   setFilters, resetFilters) are intentionally NOT wrapped. */
let commandSeq = 0
let recordDepth = 0 // guards against nested recording (e.g. duplicateTask → addTask)
;(function installUndoRecorder() {
  const store = useData.getState() as unknown as Record<string, any>
  const names = Object.keys(ACTION_LABELS) as ActionName[]
  const patched: Record<string, any> = {}
  for (const name of names) {
    const original = store[name]
    if (typeof original !== 'function') continue
    patched[name] = (...args: any[]) => {
      // When restoring a snapshot, or when we are already inside a recorded
      // action (nested action call), delegate to the original and let the
      // OUTERMOST action own the single history entry.
      if (suspendRecording || recordDepth > 0) return original(...args)
      recordDepth++
      const before = snapshot()
      let result: any
      try {
        result = original(...args)
      } finally {
        recordDepth--
      }
      const after = snapshot()
      if (!snapshotsEqual(before, after)) {
        useHistory.getState().push({
          id: ++commandSeq,
          label: refineLabel(name, args, before),
          before,
          after,
          mergeKey: mergeKeyFor(name, args),
          time: Date.now(),
        })
      }
      return result
    }
  }
  useData.setState(patched as any)
})()

/* Imperative helpers so non-React code / shortcuts can trigger undo/redo. */
const undoAction = () => useHistory.getState().undo()
const redoAction = () => useHistory.getState().redo()

/* ============================================================
   Helpers
   ============================================================ */
function useBootstrap() {
  const hydrate = useData(s => s.hydrate)
  const q = useQuery({ queryKey: ['bootstrap'], queryFn: async () => boot })
  useEffect(() => { if (q.data) hydrate(q.data) }, [q.data, hydrate])
  return q
}
const applyTheme = (theme: 'light' | 'dark' | 'system') => {
  const root = document.documentElement
  const mode = theme === 'system' ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : theme
  root.classList.remove('light', 'dark'); root.classList.add(mode); root.style.colorScheme = mode
}
/* Global filter matcher. `includeArchived` lets archive-scoped views run the
   same criteria without the default "hide archived" guard, so the top-header
   filter (search / project / status / priority / tag / favorite) narrows every
   task view consistently. */
/* Does a task's OWN title / description contain the query text? */
const matchesSearchText = (t: Task, q: string) =>
  t.title.toLowerCase().includes(q) || (t.description || '').toLowerCase().includes(q)

/* Does this task OR any of its descendants match the query text? Used so a
   search that only hits a subtask still surfaces its parent (with the parent
   rendered at reduced opacity to preserve the hierarchy — see below). */
const searchHitsTaskOrDescendant = (t: Task, q: string, allTasks: Task[]): boolean => {
  if (matchesSearchText(t, q)) return true
  return allTasks.some(c => c.parentId === t.id && searchHitsTaskOrDescendant(c, q, allTasks))
}

const taskMatches = (t: Task, f: FilterState, opts?: { includeArchived?: boolean; allTasks?: Task[] }) => {
  if (t.archived && !opts?.includeArchived) return false
  if (f.search) {
    const q = f.search.toLowerCase()
    // The search matches subtasks too: keep a parent visible when one of its
    // descendants matches, even if the parent itself doesn't. When the task
    // list isn't available fall back to the task's own text.
    const hit = opts?.allTasks
      ? searchHitsTaskOrDescendant(t, q, opts.allTasks)
      : matchesSearchText(t, q)
    if (!hit) return false
  }
  if (f.projectIds.length && !f.projectIds.includes(t.projectId || '')) return false
  if (f.statuses.length && !f.statuses.includes(t.status)) return false
  if (f.priorities.length && !f.priorities.includes(t.priority)) return false
  if (f.tags.length && !f.tags.some(x => t.tags.includes(x))) return false
  if (f.favoriteOnly && !t.favorite) return false
  return true
}

/* True when a task is shown ONLY because a descendant subtask matched the
   active search (the task itself does not match). Such "context parent" rows
   render at reduced opacity so the matching hierarchy stays readable. */
const isSearchContextParent = (t: Task, f: FilterState, allTasks: Task[]) => {
  if (!f.search) return false
  const q = f.search.toLowerCase()
  return !matchesSearchText(t, q) && searchHitsTaskOrDescendant(t, q, allTasks)
}
/* Legacy "smart" ordering: unfinished first, then priority, then due date.
   Used as the tie-breaker / fallback for every sort mode so results always
   feel sensible. */
const smartCompare = (a: Task, b: Task) => {
  if (a.status === 'done' && b.status !== 'done') return 1
  if (a.status !== 'done' && b.status === 'done') return -1
  const pr = priorityMeta[b.priority].rank - priorityMeta[a.priority].rank
  if (pr) return pr
  if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate)
  return a.order - b.order
}

/* Compare two tasks by an explicit sort key + direction. Ties fall back to the
   smart ordering above so lists never look randomly shuffled. */
const compareBy = (a: Task, b: Task, key: SortKey, dir: SortDir) => {
  const mul = dir === 'asc' ? 1 : -1
  let r = 0
  switch (key) {
    case 'title': r = a.title.localeCompare(b.title); break
    case 'priority': r = priorityMeta[a.priority].rank - priorityMeta[b.priority].rank; break
    case 'due': r = (a.dueDate || '\uffff').localeCompare(b.dueDate || '\uffff'); break
    case 'created': r = (a.createdAt || '').localeCompare(b.createdAt || ''); break
    case 'selected': r = (a.favorite ? 1 : 0) - (b.favorite ? 1 : 0); break
    case 'updated':
    default: r = (a.updatedAt || '').localeCompare(b.updatedAt || ''); break
  }
  if (r !== 0) return r * mul
  return smartCompare(a, b)
}

/* App-wide task sorter. Honours the GLOBAL filter's sort key + direction so the
   same ordering is applied consistently everywhere (Today, Upcoming, Projects,
   All tasks, etc.). Falls back to smart ordering when no sort is configured. */
const sortTasks = (items: Task[]) => {
  const f = useData.getState().filters
  const key = f.sort ?? 'updated'
  const dir = f.sortDir ?? 'desc'
  return [...items].sort((a, b) => compareBy(a, b, key, dir))
}
const overdue = (t: Task) => !!t.dueDate && t.status !== 'done' && t.status !== 'cancelled' && isPast(parseISO(t.dueDate)) && !isToday(parseISO(t.dueDate))
const subTasks = (tasks: Task[], id: string) => tasks.filter(t => t.parentId === id)

const statusBadge = (s: Status) =>
  <span className={cn('badge', statusMeta[s].color, 'bg-black/5 dark:bg-white/5')}>
    <span className={cn('h-1.5 w-1.5 rounded-full', statusMeta[s].dot)} />
    {statusMeta[s].label}
  </span>

const priorityBadge = (p: Priority, className?: string) =>
  <span className={cn('badge', priorityMeta[p].color, 'bg-black/5 dark:bg-white/5', className)}>
    {priorityMeta[p].label}
  </span>

function IconProject({ name, color, className }: { name: string; color: string; className?: string }) {
  const I = iconMap[name] || FolderKanban
  return <div className={cn('h-8 w-8 rounded-xl flex items-center justify-center project-icon transition-transform', className)} style={{ background: color + '22' }}>
    <I className='h-4 w-4' style={{ color }} />
  </div>
}

/* ============================================================
   Global drag tracker — used by useContextMenu to guarantee the task
   context menu / popover NEVER renders, mounts, opens, animates, or
   receives events while a drag is in progress. This is a tiny publish /
   subscribe store shared across the whole app so any component that
   opens a context menu can react to a drag starting or ending.
   ============================================================ */
const dragActiveStore = (() => {
  let active = false
  const listeners = new Set<() => void>()
  return {
    get: () => active,
    set: (v: boolean) => {
      if (active === v) return
      active = v
      listeners.forEach(fn => fn())
    },
    subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } },
  }
})()
function useDragActive() {
  const [v, setV] = useState(() => dragActiveStore.get())
  useEffect(() => dragActiveStore.subscribe(() => setV(dragActiveStore.get())), [])
  return v
}

/* ============================================================
   Context Menu (shared popup — same style as setting popup #5995)
   ============================================================ */
type CtxItem =
  | { kind: 'item'; label: string; icon?: React.ReactNode; danger?: boolean; onClick: () => void; disabled?: boolean }
  | { kind: 'separator' }
  | { kind: 'submenu'; label: string; icon?: React.ReactNode; items: CtxItem[] }

function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: CtxItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x, y })
  const [openSub, setOpenSub] = useState<number | null>(null)

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  useEffect(() => {
    if (!ref.current) return
    const r = ref.current.getBoundingClientRect()
    let nx = x, ny = y
    if (x + r.width > window.innerWidth) nx = window.innerWidth - r.width - 8
    if (y + r.height > window.innerHeight) ny = window.innerHeight - r.height - 8
    if (nx < 4) nx = 4
    if (ny < 4) ny = 4
    setPos({ x: nx, y: ny })
  }, [x, y])

  return createPortal(
    <div ref={ref}
         style={{ position: 'fixed', top: pos.y, left: pos.x, zIndex: 1000 }}
         className='min-w-[220px] rounded-xl border bg-[hsl(var(--card))] text-[hsl(var(--card-foreground))] shadow-lg p-1 text-sm border-[hsl(var(--border))]'>
      {items.map((it, i) => {
        if (it.kind === 'separator') return <div key={i} className='my-1 h-px bg-[hsl(var(--border))]' />
        if (it.kind === 'submenu') {
          const isOpen = openSub === i
          return <div key={i} className='relative'
            onMouseEnter={() => setOpenSub(i)}
            onMouseLeave={() => setOpenSub(s => s === i ? null : s)}>
            <button className='w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-[hsl(var(--accent))]'>
              {it.icon}<span className='flex-1 text-left'>{it.label}</span>
              <ChevronRight className='h-3.5 w-3.5 opacity-60' />
            </button>
            {isOpen && (
              <div className='absolute left-full top-0 ml-1 min-w-[220px] max-h-[60vh] overflow-auto rounded-xl border bg-[hsl(var(--card))] shadow-lg p-1 border-[hsl(var(--border))]'>
                {it.items.map((sub, j) => sub.kind === 'separator'
                  ? <div key={j} className='my-1 h-px bg-[hsl(var(--border))]' />
                  : sub.kind === 'item'
                    ? <button key={j} disabled={sub.disabled}
                        onClick={(e) => { e.stopPropagation(); sub.onClick(); onClose() }}
                        className={cn('w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-[hsl(var(--accent))] text-left disabled:opacity-50', sub.danger && 'text-rose-600')}>
                        {sub.icon}<span className='flex-1 truncate'>{sub.label}</span>
                      </button>
                    : null
                )}
              </div>
            )}
          </div>
        }
        return <button key={i} disabled={it.disabled}
          onClick={(e) => { e.stopPropagation(); it.onClick(); onClose() }}
          className={cn('w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-[hsl(var(--accent))] text-left disabled:opacity-50', it.danger && 'text-rose-600')}>
          {it.icon}<span className='flex-1 truncate'>{it.label}</span>
        </button>
      })}
    </div>,
    document.body
  )
}

/* Delete confirmation by typing the exact name */
function DeleteConfirm({ title, name, onClose, onConfirm }: { title: string; name: string; onClose: () => void; onConfirm: () => void }) {
  const [v, setV] = useState('')
  return createPortal(
    <>
      <div className='popup-overlay' onClick={onClose} />
      <div className='popup-shell panel p-0' style={{ maxWidth: 420 }}>
        <div className='p-4 border-b'>
          <div className='text-sm font-semibold'>{title}</div>
          <div className='mt-1 text-xs text-zinc-500'>This action cannot be undone. Type <span className='font-semibold text-[hsl(var(--foreground))]'>{name}</span> to confirm.</div>
        </div>
        <div className='p-4'>
          <input autoFocus className='input' placeholder={name} value={v} onChange={e => setV(e.target.value)} />
        </div>
        <div className='flex items-center justify-end gap-2 px-4 py-3 border-t bg-zinc-50 dark:bg-zinc-900'>
          <button className='btn btn-secondary' onClick={onClose}>Cancel</button>
          <button className='btn btn-primary disabled:opacity-50' style={{ background: '#dc2626' }} disabled={v.trim() !== name.trim()} onClick={() => { onConfirm(); onClose() }}>
            <Trash2 className='h-4 w-4' /> Delete
          </button>
        </div>
      </div>
    </>,
    document.body
  )
}

/* Hook + helpers to wire a left-click context menu on tasks / projects.
   Hard-guarded against drags: if a drag starts, the menu is unmounted
   immediately and any subsequent open() calls are ignored until the drag
   ends. This guarantees the menu never renders / animates / receives
   events during a drag — the only drag visuals are the drag preview,
   the insertion indicator, and valid drop targets. */
function useContextMenu() {
  const [menu, setMenu] = useState<{ x: number; y: number; items: CtxItem[] } | null>(null)
  const dragActive = useDragActive()
  const close = () => setMenu(null)
  // The moment a drag begins anywhere in the app, unmount any open menu.
  useEffect(() => { if (dragActive && menu) setMenu(null) }, [dragActive, menu])
  // Only render while no drag is active. This ensures the menu container
  // (min-w-[220px] rounded-xl border …) is completely absent from the DOM
  // during a drag operation.
  const node = (!dragActive && menu) ? <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={close} /> : null
  return {
    open: (e: React.MouseEvent, items: CtxItem[]) => {
      e.preventDefault(); e.stopPropagation()
      // Silently refuse to open while a drag is happening.
      if (dragActiveStore.get()) return
      setMenu({ x: e.clientX, y: e.clientY, items })
    },
    close,
    node,
  }
}

function buildTaskMenu(
  task: Task,
  ctx: {
    projects: Project[]; navigate: (url: string) => void;
    onRename: () => void; onCopyLink: () => void; onOpenNewTab: () => void; onLocateCalendar: () => void;
    onDelete: () => void; onAddSubtask?: () => void;
  }
): CtxItem[] {
  const d = useData.getState()
  // List of candidate parent tasks (top-level only — avoid creating cycles).
  // We exclude: the task itself, archived tasks, and any descendants of this task.
  const allTasks = d.tasks
  const descendants = new Set<string>()
  const collectDesc = (id: string) => {
    allTasks.forEach(t => { if (t.parentId === id) { descendants.add(t.id); collectDesc(t.id) } })
  }
  collectDesc(task.id)
  const moveCandidates = allTasks
    .filter(t => !t.archived && t.id !== task.id && !descendants.has(t.id))
    .slice(0, 30) // keep submenu reasonable
  return [
    { kind: 'item', label: 'Create subtask', icon: <Plus className='h-3.5 w-3.5' />, onClick: ctx.onAddSubtask || (() => {}) },
    { kind: 'item', label: 'Rename', icon: <Pencil className='h-3.5 w-3.5' />, onClick: ctx.onRename },
    { kind: 'item', label: 'Duplicate', icon: <Copy className='h-3.5 w-3.5' />, onClick: () => d.duplicateTask(task.id) },
    { kind: 'item', label: 'Copy link', icon: <LinkIcon className='h-3.5 w-3.5' />, onClick: ctx.onCopyLink },
    { kind: 'item', label: 'Open in new tab', icon: <ExternalLink className='h-3.5 w-3.5' />, onClick: ctx.onOpenNewTab },
    { kind: 'item', label: 'Locate on calendar', icon: <MapPinned className='h-3.5 w-3.5' />, onClick: ctx.onLocateCalendar, disabled: !task.dueDate },
    { kind: 'item', label: task.favorite ? 'Remove from favorites' : 'Add to favorites', icon: <Star className='h-3.5 w-3.5' />, onClick: () => d.toggleFav(task.id) },
    { kind: 'item', label: task.archived ? 'Unarchive' : 'Archive task', icon: <Archive className='h-3.5 w-3.5' />, onClick: () => d.archiveTask(task.id) },
    { kind: 'separator' },
    { kind: 'submenu', label: 'Move to project', icon: <FolderInput className='h-3.5 w-3.5' />, items: [
      { kind: 'item', label: 'No project', onClick: () => d.moveTaskToProject(task.id, undefined) },
      ...ctx.projects.map<CtxItem>(p => ({ kind: 'item', label: p.name, icon: <span className='h-2 w-2 rounded-full inline-block' style={{ background: p.color }} />, onClick: () => d.moveTaskToProject(task.id, p.id) }))
    ] },
    { kind: 'submenu', label: 'Nest under task', icon: <ListChecks className='h-3.5 w-3.5' />, items: [
      { kind: 'item', label: task.parentId ? 'Detach (make top-level)' : 'Already top-level', disabled: !task.parentId, onClick: () => d.setParent(task.id, undefined) },
      { kind: 'separator' },
      ...moveCandidates.map<CtxItem>(t => ({ kind: 'item', label: t.title, icon: <ListChecks className='h-3 w-3' />, onClick: () => d.setParent(task.id, t.id) }))
    ] },
    { kind: 'separator' },
    { kind: 'item', label: 'Delete task…', icon: <Trash2 className='h-3.5 w-3.5' />, danger: true, onClick: ctx.onDelete },
  ]
}

function buildProjectMenu(
  project: Project,
  ctx: {
    onRename: () => void; onEditIcon: () => void; onCopyLink: () => void; onOpenNewTab: () => void; onDelete: () => void;
  }
): CtxItem[] {
  const d = useData.getState()
  return [
    { kind: 'item', label: 'Rename', icon: <Pencil className='h-3.5 w-3.5' />, onClick: ctx.onRename },
    { kind: 'item', label: 'Edit project icon', icon: <Sparkles className='h-3.5 w-3.5' />, onClick: ctx.onEditIcon },
    { kind: 'item', label: 'Duplicate', icon: <Copy className='h-3.5 w-3.5' />, onClick: () => d.duplicateProject(project.id) },
    { kind: 'item', label: 'Copy link', icon: <LinkIcon className='h-3.5 w-3.5' />, onClick: ctx.onCopyLink },
    { kind: 'item', label: 'Open in new tab', icon: <ExternalLink className='h-3.5 w-3.5' />, onClick: ctx.onOpenNewTab },
    { kind: 'item', label: project.favorite ? 'Remove from favorites' : 'Add to favorites', icon: <Star className='h-3.5 w-3.5' />, onClick: () => d.toggleProjectFav(project.id) },
    { kind: 'item', label: 'Archive project', icon: <Archive className='h-3.5 w-3.5' />, onClick: () => d.archiveProject(project.id) },
    { kind: 'separator' },
    { kind: 'item', label: 'Delete project…', icon: <Trash2 className='h-3.5 w-3.5' />, danger: true, onClick: ctx.onDelete },
  ]
}

/* Edit-name modal (used by Rename actions) */
function NamePrompt({ title, initial, label = 'Name', onClose, onSave }: { title: string; initial: string; label?: string; onClose: () => void; onSave: (v: string) => void }) {
  const [v, setV] = useState(initial)
  return createPortal(
    <>
      <div className='popup-overlay' onClick={onClose} />
      <div className='popup-shell panel p-0' style={{ maxWidth: 460 }}>
        <div className='p-4 border-b text-sm font-semibold'>{title}</div>
        <div className='p-4 space-y-2'>
          <div className='text-[11px] uppercase tracking-wider text-zinc-500'>{label}</div>
          <input autoFocus className='input' value={v} onChange={e => setV(e.target.value)} />
        </div>
        <div className='flex items-center justify-end gap-2 px-4 py-3 border-t bg-zinc-50 dark:bg-zinc-900'>
          <button className='btn btn-secondary' onClick={onClose}>Cancel</button>
          <button className='btn btn-primary' disabled={!v.trim()} onClick={() => { onSave(v.trim()); onClose() }}>Save</button>
        </div>
      </div>
    </>,
    document.body
  )
}

/* Icon picker for projects */
function IconPicker({ project, onClose }: { project: Project; onClose: () => void }) {
  const updateProject = useData(s => s.updateProject)
  const iconNames = Object.keys(iconMap)
  return createPortal(
    <>
      <div className='popup-overlay' onClick={onClose} />
      <div className='popup-shell panel p-0' style={{ maxWidth: 460 }}>
        <div className='p-4 border-b text-sm font-semibold'>Edit project icon</div>
        <div className='p-4 space-y-3'>
          <div className='text-[11px] uppercase tracking-wider text-zinc-500'>Icon</div>
          <div className='flex flex-wrap gap-2'>
            {iconNames.map(n => {
              const I = iconMap[n]
              return <button key={n} onClick={() => updateProject(project.id, { icon: n })}
                className={cn('h-10 w-10 rounded-xl flex items-center justify-center border transition', project.icon === n ? 'ring-2 ring-indigo-500/40' : 'hover:bg-[hsl(var(--accent))]')}
                style={{ background: project.color + '22' }}>
                <I className='h-4 w-4' style={{ color: project.color }} />
              </button>
            })}
          </div>
          <div className='text-[11px] uppercase tracking-wider text-zinc-500 mt-3'>Color</div>
          <div className='flex flex-wrap gap-2'>
            {colors.map(c => (
              <button key={c} onClick={() => updateProject(project.id, { color: c })}
                className={cn('h-7 w-7 rounded-full border transition', project.color === c ? 'ring-2 ring-offset-2 ring-indigo-500/50' : '')}
                style={{ background: c }} />
            ))}
          </div>
        </div>
        <div className='flex items-center justify-end gap-2 px-4 py-3 border-t bg-zinc-50 dark:bg-zinc-900'>
          <button className='btn btn-primary' onClick={onClose}>Done</button>
        </div>
      </div>
    </>,
    document.body
  )
}

/* ============================================================
   Empty States (Improvement #3)
   ============================================================ */
function Empty({ title, desc, icon: Icon = Inbox, action }: { title: string; desc: string; icon?: React.ComponentType<{ className?: string }>; action?: React.ReactNode }) {
  return (
    <div className='empty-state'>
      <div className='empty-illustration'><Icon /></div>
      <div className='text-sm font-semibold text-[hsl(var(--foreground))]'>{title}</div>
      <div className='mt-1 text-xs text-zinc-500 max-w-sm'>{desc}</div>
      {action && <div className='mt-4'>{action}</div>}
    </div>
  )
}

function KanbanEmpty({ onCreate }: { onCreate?: () => void }) {
  return (
    <div className='empty-state'>
      <div className='empty-illustration'>
        <svg viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.6' strokeLinecap='round' strokeLinejoin='round'>
          <rect x='3' y='4' width='6' height='16' rx='2' />
          <rect x='10' y='4' width='6' height='10' rx='2' />
          <rect x='17' y='4' width='4' height='6' rx='1.5' />
        </svg>
      </div>
      <div className='text-sm font-semibold'>Your board is wide open</div>
      <div className='mt-1 text-xs text-zinc-500 max-w-sm'>Drag a task here, or create one to get started.</div>
      <div className='mt-4 flex flex-wrap items-center justify-center gap-2'>
        {onCreate && <button className='btn btn-primary' onClick={onCreate}><Plus className='h-4 w-4' /> Create task</button>}
        <span className='text-[11px] text-zinc-500 inline-flex items-center gap-1'>
          <span className='inline-block h-2 w-2 rounded-full border border-dashed border-zinc-400' /> Drag task here
        </span>
      </div>
    </div>
  )
}

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className={cn('panel p-4', className)}>{children}</motion.div>
}

function StatusDot({ status, onClick }: { status: Status; onClick?: () => void }) {
  const I = statusMeta[status].icon
  // Clicking the checkbox must only toggle the status — never bubble up to a
  // parent handler (e.g. the task card body) that would open the details panel.
  return (
    <button
      type='button'
      onPointerDown={e => e.stopPropagation()}
      onMouseDown={e => e.stopPropagation()}
      onClick={e => { e.stopPropagation(); onClick?.() }}
      className='mt-0.5'
    >
      <I className={cn('h-4 w-4', statusMeta[status].color)} />
    </button>
  )
}

/* ============================================================
   Task Row — supports SUBTASKS (expand / collapse / add) and
   COMPACT MODE (extra slim, table-style rendering driven by CSS).
   ============================================================ */
function TaskRow({ task, showProject = true, depth = 0 }: { task: Task; showProject?: boolean; depth?: number }) {
  const toggleDone = useData(s => s.toggleDone)
  const toggleFav = useData(s => s.toggleFav)
  const setUI = useUI(s => s.set)
  const selected = useUI(s => s.selected)
  const compactMode = useUI(s => s.compactMode)
  const projects = useData(s => s.projects)
  const tags = useData(s => s.tags)
  const allTasks = useData(s => s.tasks)
  const deleteTask = useData(s => s.deleteTask)
  const updateTask = useData(s => s.updateTask)
  const addTask = useData(s => s.addTask)
  const navigate = useNavigate()
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: task.id })
  // While this row is the one being dragged, we COLLAPSE its slot entirely
  // (height:0, no margin, no border/padding, no children) so the sibling list
  // does NOT shift by the dragged row's height. Without this, dnd-kit reserves
  // an origin slot the same size as the dragged item, which pushes every row
  // below by that height and makes the visual drop position feel offset from
  // the cursor. Collapsing the origin slot means the indicator line above /
  // below the row under the cursor is always exactly under the cursor.
  const style: React.CSSProperties = isDragging
    ? {
        transform: CSS.Transform.toString(transform),
        transition,
        height: 0,
        minHeight: 0,
        margin: 0,
        padding: 0,
        border: 0,
        opacity: 0,
        overflow: 'hidden',
        pointerEvents: 'none',
      }
    : { transform: CSS.Transform.toString(transform), transition, opacity: 1 }
  const p = projects.find(x => x.id === task.projectId)
  const ts = tags.filter(t => task.tags.includes(t.id))
  const isSelected = selected === task.id
  const filters = useData(s => s.filters)
  // When a search only matches a descendant subtask, this parent is shown just
  // to preserve the hierarchy — render it dimmed so the real match stands out.
  const isContextParent = isSearchContextParent(task, filters, allTasks)
  const ctx = useContextMenu()
  const isMobileTaskCard = useMedia('(max-width: 768px)')
  const dndEnabled = useDndEnabled()
  const rowDragAttributes = !dndEnabled ? {} : isMobileTaskCard ? {} : attributes
  const rowDragListeners = !dndEnabled ? {} : isMobileTaskCard ? {} : listeners
  const handleDragAttributes = !dndEnabled ? {} : isMobileTaskCard ? attributes : {}
  const handleDragListeners = !dndEnabled ? {} : isMobileTaskCard ? listeners : {}
  const [renaming, setRenaming] = useState(false)
  const [confirming, setConfirming] = useState(false)

  // Subtasks (children whose parentId points here). Sorted same way as parent list.
  const hideDoneChildren = React.useContext(HideDoneCtx)
  const children = useMemo(
    () => sortTasks(allTasks.filter(t => t.parentId === task.id && !t.archived && (!hideDoneChildren || t.status !== 'done'))),
    [allTasks, task.id, hideDoneChildren]
  )
  const hasChildren = children.length > 0
  // Expand by default when a subtask exists, so users see them.
  const [expanded, setExpanded] = useState(true)
  const doneChildren = children.filter(c => c.status === 'done').length

  // Inline "add subtask" input — quick capture without opening details panel.
  const [addingChild, setAddingChild] = useState(false)
  const [childTitle, setChildTitle] = useState('')
  const commitChild = () => {
    const v = childTitle.trim()
    if (!v) { setAddingChild(false); return }
    addTask({ title: v, parentId: task.id, projectId: task.projectId })
    setChildTitle('')
    setAddingChild(false)
    setExpanded(true)
  }

  const openMenu = (e: React.MouseEvent) => {
    if (isMobileTaskCard) {
      e.preventDefault()
      e.stopPropagation()
      return
    }
    ctx.open(e, buildTaskMenu(task, {
      projects, navigate,
      onRename: () => setRenaming(true),
      onCopyLink: () => { try { navigator.clipboard?.writeText(window.location.origin + '/?task=' + task.id) } catch {} },
      onOpenNewTab: () => window.open(window.location.origin + '/?task=' + task.id, '_blank'),
      onLocateCalendar: () => { useUI.getState().set({ calendarTarget: task.id }); navigate('/calendar') },
      onDelete: () => setConfirming(true),
      onAddSubtask: () => { setExpanded(true); setAddingChild(true) },
    }))
  }

  // "Is any drag happening right now" — used to guarantee the long-press
  // context menu can never open once a drag has begun (touch devices).
  const anyDragActive = useAnyDragActive()

  // Long-press handler for touch devices: opens the context menu after a
  // hold WITHOUT scrolling. The timer must fire AFTER the TouchSensor's
  // activation window so it never competes with a real drag: TouchSensor
  // activates at 120ms, this fires at 500ms — well outside that window.
  const longPressRef = useRef<{ t: ReturnType<typeof setTimeout> | null; x: number; y: number; fired: boolean }>({ t: null, x: 0, y: 0, fired: false })
  const cancelLongPress = () => { if (longPressRef.current.t) { clearTimeout(longPressRef.current.t); longPressRef.current.t = null } }
  // Keep a live ref of "is a drag active" so the (closured) long-press timer
  // can read the CURRENT value when it fires rather than the value captured
  // at touchstart. Without this the menu could pop open mid-drag.
  const anyDragActiveRef = useRef(anyDragActive)
  anyDragActiveRef.current = anyDragActive
  // Once a drag begins anywhere, immediately kill any pending long-press timer
  // on this row so it can't fire after the drag ends either.
  useEffect(() => { if (anyDragActive) cancelLongPress() }, [anyDragActive])
  const onTouchStart = (e: React.TouchEvent) => {
    if (isMobileTaskCard) return
    const t = e.touches[0]
    longPressRef.current = { t: null, x: t.clientX, y: t.clientY, fired: false }
    longPressRef.current.t = setTimeout(() => {
      // Guard: never open the context menu once a drag is in progress. This is
      // the key fix — the drag preview is the ONLY drag-related visual allowed.
      if (anyDragActiveRef.current || dragActiveStore.get()) { cancelLongPress(); return }
      longPressRef.current.fired = true
      // synth a fake mouse event for our context menu (only clientX/Y are used)
      const fake = { clientX: longPressRef.current.x, clientY: longPressRef.current.y, preventDefault: () => {}, stopPropagation: () => {} } as unknown as React.MouseEvent
      openMenu(fake)
    }, 500)
  }
  const onTouchMove = (e: React.TouchEvent) => {
    if (isMobileTaskCard) return
    const t = e.touches[0]
    if (Math.abs(t.clientX - longPressRef.current.x) > 6 || Math.abs(t.clientY - longPressRef.current.y) > 6) cancelLongPress()
  }

  // Drop indicator state from the parent TaskList. This powers the
  // mutually-exclusive visual feedback: either highlight the row (nest) OR
  // show a thick insertion line above/below it (reorder).
  const drop = useDropIndicator(task.id)
  const nestHighlight = drop.mode === 'inside'
  const lineAbove = drop.mode === 'above'
  const lineBelow = drop.mode === 'below'

  // When THIS row is the one being dragged, skip rendering its content and
  // collapse the wrapper to zero height so it takes no space in the layout.
  // The DragOverlay / transform still shows the dragged row visually to the
  // user, but the source position no longer reserves a placeholder slot.
  if (isDragging) {
    return (
      <motion.div
        ref={setNodeRef}
        {...attributes}
        {...listeners}
        style={style}
        aria-hidden='true'
      />
    )
  }

  return (
    <motion.div style={style} className={cn('task-row-wrap', lineAbove && 'has-line-above', lineBelow && 'has-line-below')}>
      {/* Full-width insertion line above the row */}
      {lineAbove && <div className='task-drop-line task-drop-line-top' aria-hidden='true' />}
      <div
        ref={setNodeRef}
        {...rowDragAttributes}
        {...rowDragListeners}
        className={cn('group panel p-3 task-row', dndEnabled && 'cursor-grab active:cursor-grabbing task-row-draggable', isSelected && 'is-selected', nestHighlight && 'task-row-nest-target', isContextParent && 'task-row-search-context')}
        onClick={() => { if (longPressRef.current.fired) { longPressRef.current.fired = false; return } setUI({ selected: task.id, details: true }) }}
        onContextMenu={isMobileTaskCard ? (e) => { e.preventDefault(); e.stopPropagation() } : openMenu}
        onTouchStart={onTouchStart}
        onTouchEnd={cancelLongPress}
        onTouchCancel={cancelLongPress}
        onTouchMove={onTouchMove}
      >
        {ctx.node}
        {renaming && <NamePrompt title='Rename task' initial={task.title} label='Title' onClose={() => setRenaming(false)} onSave={(v) => updateTask(task.id, { title: v })} />}
        {confirming && <DeleteConfirm title='Delete task' name={task.title} onClose={() => setConfirming(false)} onConfirm={() => deleteTask(task.id)} />}
        <div className='flex gap-3 items-start'>
          {/* Expand toggle for parents with subtasks. Reserves space even when no
              children, so titles align across rows. */}
          <button
            type='button'
            onPointerDown={e => e.stopPropagation()}
            onClick={e => { e.stopPropagation(); if (hasChildren) setExpanded(s => !s) }}
            className={cn('subtask-toggle mt-0.5', expanded && 'is-open', !hasChildren && 'invisible')}
            aria-label={expanded ? 'Collapse subtasks' : 'Expand subtasks'}
          >
            <ChevronRight className='h-3.5 w-3.5' />
          </button>

          <span onPointerDown={e => e.stopPropagation()}><StatusDot status={task.status} onClick={() => toggleDone(task.id)} /></span>
          <div className='min-w-0 flex-1'>
            <div className='flex items-start gap-2'>
              <div className={cn('text-sm font-medium flex-1', task.status === 'done' && 'line-through text-zinc-400')}>{task.title}</div>
              {hasChildren && (
                <span className='badge bg-black/5 dark:bg-white/5 text-[10px]' title={`${doneChildren} of ${children.length} subtasks done`}>
                  <ListChecks className='h-3 w-3' /> {doneChildren}/{children.length}
                </span>
              )}
              <button className='task-favorite-toggle' onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); toggleFav(task.id) }} aria-label='Toggle favorite'>
                <Star className={cn('h-4 w-4', task.favorite ? 'fill-amber-400 text-amber-400' : 'text-zinc-400')} />
              </button>
              {isMobileTaskCard && dndEnabled && (
                <button
                  type='button'
                  ref={setActivatorNodeRef}
                  {...handleDragAttributes}
                  {...handleDragListeners}
                  className='task-drag-handle'
                  aria-label={`Drag task ${task.title}`}
                  onClick={e => e.stopPropagation()}
                >
                  <GripVertical className='h-4 w-4' />
                </button>
              )}
              <button onPointerDown={e => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); openMenu(e) }} className='task-row-menu opacity-0 group-hover:opacity-100 transition' aria-label='Task actions'>
                <MoreHorizontal className='h-4 w-4 text-zinc-400' />
              </button>
            </div>
            {task.description && <div className='compact-hide mt-0.5 text-xs text-zinc-500 line-clamp-1'>{task.description}</div>}
            {!!task.images?.length && (
              <div className='compact-hide mt-2 flex items-center gap-2 overflow-x-auto pb-1'>
                {task.images.slice(0, 3).map(img => (
                  <img key={img.id} src={img.url} alt={img.name || task.title} className='h-10 w-10 rounded-lg object-cover border border-black/5 dark:border-white/10 shrink-0' />
                ))}
                {task.images.length > 3 && <span className='text-[11px] text-zinc-500'>+{task.images.length - 3} more</span>}
              </div>
            )}
            <div className={cn('compact-row-meta', !compactMode && 'mt-2 flex flex-wrap gap-x-3 gap-y-2 text-[11px] text-zinc-500', compactMode && 'flex items-center gap-x-3 text-[11px] text-zinc-500')}>
              {task.dueDate && (
                <span className={cn('compact-meta compact-meta-date inline-flex items-center gap-1.5', overdue(task) && 'text-rose-600')}>
                  <CalendarDays className='h-3 w-3' />
                  {format(parseISO(task.dueDate), 'MMM d')}{task.time && ` · ${task.time}`}
                </span>
              )}
              {task.estimatedMinutes && (
                <span className='compact-meta compact-meta-estimate inline-flex items-center gap-1.5'>
                  <Clock3 className='h-3 w-3' />
                  {task.estimatedMinutes}m
                </span>
              )}
              {showProject && p && (
                <span className='compact-meta compact-meta-project inline-flex items-center gap-1.5'>
                  <span className='h-2 w-2 rounded-full' style={{ background: p.color }} />
                  {p.name}
                </span>
              )}
              {priorityBadge(task.priority, 'compact-meta compact-meta-priority')}
              {ts.slice(0, 2).map(t => (
                <span key={t.id} className='badge bg-black/5 dark:bg-white/5 compact-meta compact-meta-tag'>
                  <span className='h-1.5 w-1.5 rounded-full' style={{ background: t.color }} />
                  {t.name}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
      {/* Full-width insertion line below the row */}
      {lineBelow && <div className='task-drop-line task-drop-line-bottom' aria-hidden='true' />}

      {/* Subtasks tree — indented and visually connected to the parent.
          Note: all task rows share the parent TaskList's single DndContext so a
          subtask can be dragged anywhere (resorted among siblings OR re-parented).

          Smooth collapse animation: animate grid-template-rows from 0fr → 1fr
          which cleanly interpolates auto-height without measuring, avoids the
          jarring "layout" pop from framer-motion, and keeps subtask cards from
          overshooting or clipping. */}
      <AnimatePresence initial={false}>
        {(hasChildren || addingChild) && expanded && (
          <motion.div
            key='subtree'
            className='subtask-children-anim'
            initial={{ gridTemplateRows: '0fr', opacity: 0 }}
            animate={{ gridTemplateRows: '1fr', opacity: 1 }}
            exit={{ gridTemplateRows: '0fr', opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
            style={{ display: 'grid', overflow: 'hidden' }}
          >
            <div style={{ minHeight: 0 }}>
              <div className='subtask-children'>
                {children.length > 0 && (
                  <div className='flex flex-col gap-1.5'>
                    {children.map(c => (
                      <TaskRow key={c.id} task={c} showProject={showProject} depth={depth + 1} />
                    ))}
                  </div>
                )}
                {addingChild ? (
                  <div className='flex items-center gap-2'>
                    <input
                      autoFocus
                      value={childTitle}
                      onChange={e => setChildTitle(e.target.value)}
                      onClick={e => e.stopPropagation()}
                      onKeyDown={e => {
                        if (e.key === 'Enter') { e.preventDefault(); commitChild() }
                        if (e.key === 'Escape') { setAddingChild(false); setChildTitle('') }
                      }}
                      onBlur={commitChild}
                      placeholder='Subtask title — press Enter to add'
                      className='input h-8 text-sm flex-1'
                    />
                  </div>
                ) : (
                  <button
                    type='button'
                    className='subtask-add-inline self-start'
                    onClick={e => { e.stopPropagation(); setAddingChild(true); setExpanded(true) }}
                  >
                    <Plus className='h-3 w-3' /> Add subtask
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

    </motion.div>
  )
}

/* Helper: collect all visible task ids (top-level + all descendants currently
   rendered) so they share one SortableContext and can be re-parented via DnD. */
function collectVisibleIds(roots: Task[], all: Task[]): string[] {
  const out: string[] = []
  const childrenMap = new Map<string, Task[]>()
  all.forEach(t => {
    if (t.archived) return
    if (!t.parentId) return
    const arr = childrenMap.get(t.parentId) || []
    arr.push(t)
    childrenMap.set(t.parentId, arr)
  })
  const walk = (t: Task) => {
    out.push(t.id)
    const kids = sortTasks(childrenMap.get(t.id) || [])
    kids.forEach(walk)
  }
  roots.forEach(walk)
  return out
}

/* ============================================================
   Drop indicator context
   ------------------------------------------------------------
   While a task is being dragged, exactly ONE row at a time can have a visual
   feedback marker:
     - mode 'inside' → highlight that row in accent color (drop = make subtask)
     - mode 'above'  → thick insertion line above   (drop = reorder before)
     - mode 'below'  → thick insertion line below   (drop = reorder after)
   These three states are mutually exclusive, ensuring users can't see both
   the highlight and the insertion line at the same time.
   ============================================================ */
type DropMode = 'inside' | 'above' | 'below'
type DropIndicator = { targetId: string; mode: DropMode } | null

/* ============================================================
   Mobile drag preview — the ONLY drag-related visual rendered while a task is
   being dragged on touch devices. It is a static, non-interactive, slightly
   scaled-down + low-opacity floating card that mirrors the dragged task so the
   user can clearly see WHAT they are moving and (together with the untouched
   insertion indicator) exactly WHERE it will land. Rendered inside dnd-kit's
   <DragOverlay>, so it follows the finger without disturbing list layout.
   ============================================================ */
function TaskDragPreview({ task }: { task: Task }) {
  const projects = useData(s => s.projects)
  const tags = useData(s => s.tags)
  const p = projects.find(x => x.id === task.projectId)
  const ts = tags.filter(t => task.tags.includes(t.id))
  return (
    <div className='task-drag-preview panel p-3'>
      <div className='flex gap-3 items-start'>
        <span className='mt-0.5'>{(() => { const I = statusMeta[task.status].icon; return <I className={cn('h-4 w-4', statusMeta[task.status].color)} /> })()}</span>
        <div className='min-w-0 flex-1'>
          <div className={cn('text-sm font-medium', task.status === 'done' && 'line-through text-zinc-400')}>{task.title}</div>
          <div className='mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-zinc-500'>
            {task.dueDate && (
              <span className={cn('inline-flex items-center gap-1.5', overdue(task) && 'text-rose-600')}>
                <CalendarDays className='h-3 w-3' />
                {format(parseISO(task.dueDate), 'MMM d')}{task.time && ` · ${task.time}`}
              </span>
            )}
            {p && (
              <span className='inline-flex items-center gap-1.5'>
                <span className='h-2 w-2 rounded-full' style={{ background: p.color }} />
                {p.name}
              </span>
            )}
            {priorityBadge(task.priority)}
            {ts.slice(0, 2).map(t => (
              <span key={t.id} className='badge bg-black/5 dark:bg-white/5'>
                <span className='h-1.5 w-1.5 rounded-full' style={{ background: t.color }} />
                {t.name}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

const DropIndicatorCtx = React.createContext<{ indicator: DropIndicator; activeId: string | null }>({ indicator: null, activeId: null })
const useDropIndicator = (taskId: string) => {
  const { indicator, activeId } = React.useContext(DropIndicatorCtx)
  if (activeId === taskId) return { isActive: true, mode: null as DropMode | null }
  if (!indicator || indicator.targetId !== taskId) return { isActive: false, mode: null as DropMode | null }
  return { isActive: false, mode: indicator.mode }
}
/** True when ANY task in the current DndContext is being dragged. Used by
 *  TaskRow (mobile) to suppress the long-press context menu so it can never
 *  fire mid-drag. */
const useAnyDragActive = () => React.useContext(DropIndicatorCtx).activeId !== null

/* Hide-Done context — when set, TaskRow filters out any Done subtasks from
   its rendered children (used by the All Tasks page "Done" filter so that
   unchecking Done also hides Done tasks nested inside non-Done parents). */
const HideDoneCtx = React.createContext<boolean>(false)

function TaskList({ tasks, showProject = true, empty = 'No tasks', emptyDesc, emptyAction, hideChildren = true, hideDoneChildren = false }: { tasks: Task[]; showProject?: boolean; empty?: string; emptyDesc?: string; emptyAction?: React.ReactNode; hideChildren?: boolean; hideDoneChildren?: boolean }) {
  const reorder = useData(s => s.reorder)
  const setParent = useData(s => s.setParent)
  const updateTask = useData(s => s.updateTask)
  const allTasks = useData(s => s.tasks)
  // Same floating drag preview is used on BOTH mobile and desktop for a
  // consistent, unified drag experience across form factors. See
  // <DragOverlay> below and .task-drag-preview in index.css.

  /* Pending-drop confirmation — shown when the user drags a Done task above /
     below a non-Done sibling OR into a non-Done parent. Confirming flips the
     dragged task to "In Progress" and completes the move; canceling leaves
     the task in its original position. */
  const [pendingDrop, setPendingDrop] = useState<null | {
    mode: DropMode
    activeId: string
    targetId: string
  }>(null)
  // Two sensors so drag works on both desktop (pointer) and touch devices.
  // Touch: require a slightly longer intentional press-and-hold before a drag
  // starts. This reduces accidental drags while the user is just scrolling or
  // tapping near the drag handle. The `tolerance` window still lets normal
  // vertical scrolling win: if the finger moves before the delay elapses, the
  // touch stream is handed back to the browser for scrolling and no drag is
  // initiated. Once activation succeeds the sensor takes exclusive control of
  // the touch (see body.is-dnd-dragging rules in index.css) so there is zero
  // gesture conflict mid-drag. Desktop (PointerSensor) is unchanged.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 260, tolerance: 5 } }),
  )
  const setUI = useUI(s => s.set)
  // Show only top-level tasks at the root list — children are rendered as a
  // nested tree by their parent TaskRow.
  const rootIds = new Set(tasks.map(t => t.id))
  const visible = hideChildren ? tasks.filter(t => !t.parentId || !rootIds.has(t.parentId)) : tasks
  const allIds = useMemo(() => collectVisibleIds(visible, allTasks), [visible, allTasks])

  // ---- Drop indicator state shared with every TaskRow via context ----
  const [activeId, setActiveId] = useState<string | null>(null)
  const [indicator, setIndicator] = useState<DropIndicator>(null)
  const ctxValue = useMemo(() => ({ indicator, activeId }), [indicator, activeId])

  // While a drag is in progress, swallow the native contextmenu and
  // selectstart events on the whole document. This prevents mobile Safari /
  // Chrome from opening the tap-and-hold context menu OR starting a text
  // selection when the user long-presses a task to initiate a drag.
  React.useEffect(() => {
    if (!activeId) return
    const block: EventListener = (e) => { e.preventDefault(); e.stopPropagation() }
    document.addEventListener('contextmenu', block, true)
    document.addEventListener('selectstart', block, true)
    return () => {
      document.removeEventListener('contextmenu', block, true)
      document.removeEventListener('selectstart', block, true)
    }
  }, [activeId])

  /** Decide whether the cursor is over the top edge, bottom edge, or middle
   *  of the over-row. Top/bottom → insertion line, middle → nest highlight. */
  const computeMode = (e: DragMoveEvent): DropMode | null => {
    const over = e.over
    if (!over) return null
    const rect = over.rect as { top: number; height: number; bottom?: number } | null
    if (!rect) return 'inside'
    // dnd-kit exposes the active draggable's translated client rect under
    // active.rect.current.translated; we use its vertical center as the cursor proxy.
    const tr = e.active.rect.current?.translated
    if (!tr) return 'inside'
    const cursorY = tr.top + tr.height / 2
    // 28% top edge → above, 28% bottom edge → below, middle 44% → inside.
    const edge = Math.min(18, rect.height * 0.28)
    if (cursorY < rect.top + edge) return 'above'
    if (cursorY > rect.top + rect.height - edge) return 'below'
    return 'inside'
  }

  const handleDragStart = (e: DragStartEvent) => {
    setActiveId(String(e.active.id))
    setIndicator(null)
    // Publish drag-active to the global tracker so every open context menu
    // / popover unmounts instantly and refuses to reopen until drag ends.
    dragActiveStore.set(true)
    // Lock the whole document into "drag mode": disables text selection,
    // iOS long-press callout, and native context menu. See body.is-dnd-dragging
    // rules in index.css. This guarantees a mobile long-press ONLY triggers
    // the drag — no selection handles, no share sheet, no context menu.
    if (typeof document !== 'undefined') {
      document.body.classList.add('is-dnd-dragging')
      // Clear any selection the browser may have already started before the
      // drag activation delay elapsed.
      try { window.getSelection?.()?.removeAllRanges() } catch {}
    }
  }
  const handleDragMove = (e: DragMoveEvent) => {
    const over = e.over
    if (!over) { setIndicator(null); return }
    const overIdRaw = String(over.id)
    const activeIdRaw = String(e.active.id)
    // Nest-only droppable (legacy fallback) — always 'inside'.
    if (overIdRaw.startsWith('nest:')) {
      const targetId = overIdRaw.slice(5)
      if (targetId === activeIdRaw) { setIndicator(null); return }
      setIndicator({ targetId, mode: 'inside' })
      return
    }
    if (overIdRaw === activeIdRaw) { setIndicator(null); return }
    // Guard against dropping a parent onto its own descendant.
    const byId = new Map(allTasks.map(t => [t.id, t]))
    let cur: string | undefined = overIdRaw
    while (cur) {
      if (cur === activeIdRaw) { setIndicator(null); return }
      cur = byId.get(cur)?.parentId
    }
    const mode = computeMode(e)
    if (!mode) { setIndicator(null); return }
    setIndicator({ targetId: overIdRaw, mode })
  }
  const handleDragCancel = () => {
    setActiveId(null)
    setIndicator(null)
    dragActiveStore.set(false)
    if (typeof document !== 'undefined') document.body.classList.remove('is-dnd-dragging')
  }

  /** Execute the resolved drop (reparent / reorder). Extracted so both the
   *  direct path and the post-confirmation path share exactly one code path,
   *  which keeps status propagation and ordering rules in a single place. */
  const performDrop = (activeId: string, targetId: string, mode: DropMode) => {
    const byId = new Map(useData.getState().tasks.map(t => [t.id, t]))
    const activeTask = byId.get(activeId)
    const overTask = byId.get(targetId)
    if (!activeTask || !overTask) return

    if (mode === 'inside') {
      if (activeTask.parentId === targetId) return
      setParent(activeId, targetId)
      return
    }

    if (activeTask.parentId !== overTask.parentId) {
      setParent(activeId, overTask.parentId)
    }
    const latest = useData.getState().tasks
    const siblings = latest
      .filter(t => (t.parentId || '') === (overTask.parentId || '') && !t.archived)
      .sort((a, b) => a.order - b.order)
      .map(t => t.id)
    const from = siblings.indexOf(activeId)
    let to = siblings.indexOf(targetId)
    if (from < 0 || to < 0) return
    if (mode === 'below') to = to + (from < to ? 0 : 1)
    else /* above */ to = to + (from < to ? -1 : 0)
    if (to < 0) to = 0
    if (to >= siblings.length) to = siblings.length - 1
    if (from === to) return
    reorder(arrayMove(siblings, from, to))
  }

  const handleDragEnd = (e: DragEndEvent) => {
    const ind = indicator
    const active = e.active
    const over = e.over
    setActiveId(null)
    setIndicator(null)
    dragActiveStore.set(false)
    if (typeof document !== 'undefined') document.body.classList.remove('is-dnd-dragging')
    if (!over || active.id === over.id) return
    const activeId = String(active.id)
    const overIdRaw = String(over.id)
    const byId = new Map(allTasks.map(t => [t.id, t]))
    const activeTask = byId.get(activeId)
    if (!activeTask) return

    // Resolve target task id (the nest:* droppable shares the same target id).
    const targetId = overIdRaw.startsWith('nest:') ? overIdRaw.slice(5) : overIdRaw
    const overTask = byId.get(targetId)
    if (!overTask) return

    // Don't allow dropping onto self or a descendant (cycle guard).
    let cur: string | undefined = targetId
    while (cur) {
      if (cur === activeId) return
      cur = byId.get(cur)?.parentId
    }

    // Mode = whatever the live indicator showed at drop time; default to
    // 'inside' for backwards compat with the dedicated nest droppable.
    const mode: DropMode = ind && ind.targetId === targetId ? ind.mode : (overIdRaw.startsWith('nest:') ? 'inside' : 'inside')

    /* ---- Done → non-Done confirmation ---------------------------------
       If the dragged task is Done and the drop would place it into a
       non-Done context (as a subtask of a non-Done parent OR next to a
       non-Done sibling in the same list), ask the user to confirm losing
       the Done status. Cancel = task stays in its original position. */
    if (activeTask.status === 'done') {
      const contextIsNotDone =
        mode === 'inside'
          ? overTask.status !== 'done'
          : overTask.status !== 'done'
      if (contextIsNotDone) {
        setPendingDrop({ mode, activeId, targetId })
        return
      }
    }

    performDrop(activeId, targetId, mode)
  }

  const pendingActiveTitle = pendingDrop ? (allTasks.find(t => t.id === pendingDrop.activeId)?.title || '') : ''

  if (!visible.length) {
    return <>
      <Empty
        title={empty}
        desc={emptyDesc || 'You are all caught up.'}
        action={emptyAction || <button className='btn btn-primary' onClick={() => setUI({ quick: true })}><Plus className='h-4 w-4' /> Create task</button>}
      />
      {pendingDrop && (
        <DoneMoveConfirm
          taskTitle={pendingActiveTitle}
          onCancel={() => setPendingDrop(null)}
          onConfirm={() => {
            const { activeId, targetId, mode } = pendingDrop
            updateTask(activeId, { status: 'in_progress', completedAt: undefined })
            performDrop(activeId, targetId, mode)
            setPendingDrop(null)
          }}
        />
      )}
    </>
  }
  return (
    <DropIndicatorCtx.Provider value={ctxValue}>
      <HideDoneCtx.Provider value={hideDoneChildren}>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragMove={handleDragMove}
        onDragCancel={handleDragCancel}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={allIds} strategy={noShiftSortingStrategy}>
          <div className='task-list-stack space-y-2'>
            {visible.map(t => <TaskRow key={t.id} task={t} showProject={showProject} />)}
          </div>
        </SortableContext>
        {/* Floating drag preview — rendered on BOTH mobile and desktop with
            identical appearance and behavior. The dragged source row is
            collapsed to zero height (see TaskRow's `isDragging` branch), so
            the DragOverlay preview is the ONLY visible copy of the task
            during a drag, matching the mobile experience on desktop. */}
        <DragOverlay dropAnimation={null} zIndex={9999}>
          {activeId ? (() => {
            const t = allTasks.find(x => x.id === activeId)
            return t ? <TaskDragPreview task={t} /> : null
          })() : null}
        </DragOverlay>
      </DndContext>
      </HideDoneCtx.Provider>
      {pendingDrop && (
        <DoneMoveConfirm
          taskTitle={pendingActiveTitle}
          onCancel={() => setPendingDrop(null)}
          onConfirm={() => {
            const { activeId, targetId, mode } = pendingDrop
            updateTask(activeId, { status: 'in_progress', completedAt: undefined })
            performDrop(activeId, targetId, mode)
            setPendingDrop(null)
          }}
        />
      )}
    </DropIndicatorCtx.Provider>
  )
}

/* Small confirmation dialog shown when dragging a Done task into a non-Done
   context. Keeps visual language identical to DeleteConfirm so the modal
   feels native and premium. */
function DoneMoveConfirm({ taskTitle, onCancel, onConfirm }: { taskTitle: string; onCancel: () => void; onConfirm: () => void }) {
  return createPortal(
    <>
      <div className='popup-overlay' onClick={onCancel} />
      <div className='popup-shell panel p-0' style={{ maxWidth: 420 }}>
        <div className='p-4 border-b'>
          <div className='text-sm font-semibold'>Done status will be removed</div>
          <div className='mt-1 text-xs text-zinc-500'>
            <span className='font-medium text-[hsl(var(--foreground))]'>{taskTitle || 'This task'}</span> is currently marked Done. Moving it here will change its status to In Progress. Move anyway?
          </div>
        </div>
        <div className='flex items-center justify-end gap-2 px-4 py-3 border-t bg-zinc-50 dark:bg-zinc-900'>
          <button className='btn btn-secondary' onClick={onCancel}>Cancel</button>
          <button className='btn btn-primary' onClick={onConfirm}>Move anyway</button>
        </div>
      </div>
    </>,
    document.body
  )
}

/* ============================================================
   AlertDialog — clean, UI-consistent alert modal used in place of the
   raw browser alert(). Same visual language as DeleteConfirm /
   DoneMoveConfirm / NamePrompt so every popup in the app feels native.

   A small module-level store queues alert() requests and a single
   <AlertHost /> mounted once at the app root renders them. The global
   window.alert is patched (see App() below) so any legacy alert() call
   routes through the themed dialog automatically.
   ============================================================ */
type AlertKind = 'info' | 'warning' | 'error' | 'success'
type AlertRequest = {
  id: number
  title: string
  message?: string
  kind: AlertKind
  confirmLabel: string
  onConfirm?: () => void
}
const alertDialogStore = (() => {
  let seq = 1
  let queue: AlertRequest[] = []
  const listeners = new Set<() => void>()
  const emit = () => listeners.forEach(fn => fn())
  return {
    getQueue: () => queue,
    push: (req: Omit<AlertRequest, 'id'>) => {
      queue = [...queue, { ...req, id: seq++ }]
      emit()
    },
    dismiss: (id: number) => {
      queue = queue.filter(r => r.id !== id)
      emit()
    },
    subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } },
  }
})()
/** Themed replacement for window.alert. Returns a promise that resolves
 *  when the user dismisses the dialog. */
function showAlert(opts: string | { title?: string; message?: string; kind?: AlertKind; confirmLabel?: string }): Promise<void> {
  const req: Omit<AlertRequest, 'id'> = typeof opts === 'string'
    ? { title: 'Notice', message: opts, kind: 'info', confirmLabel: 'OK' }
    : {
        title: opts.title ?? 'Notice',
        message: opts.message,
        kind: opts.kind ?? 'info',
        confirmLabel: opts.confirmLabel ?? 'OK',
      }
  return new Promise<void>(resolve => {
    alertDialogStore.push({ ...req, onConfirm: () => resolve() })
  })
}
function AlertDialog({ req, onClose }: { req: AlertRequest; onClose: () => void }) {
  const dismiss = () => { req.onConfirm?.(); onClose() }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); dismiss() }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const accent =
    req.kind === 'error'   ? 'text-rose-600'   :
    req.kind === 'warning' ? 'text-amber-600'  :
    req.kind === 'success' ? 'text-emerald-600':
                             'text-[hsl(var(--focus))]'
  const Icon =
    req.kind === 'error'   ? AlertCircle :
    req.kind === 'warning' ? AlertCircle :
    req.kind === 'success' ? CheckCircle2 :
                             AlertCircle
  return createPortal(
    <>
      <div className='popup-overlay' onClick={dismiss} />
      <div className='popup-shell panel p-0' style={{ maxWidth: 420 }} role='alertdialog' aria-modal='true' aria-labelledby='alertdialog-title'>
        <div className='p-4 border-b flex items-start gap-3'>
          <Icon className={cn('h-5 w-5 mt-0.5 shrink-0', accent)} />
          <div className='min-w-0 flex-1'>
            <div id='alertdialog-title' className='text-sm font-semibold'>{req.title}</div>
            {req.message && <div className='mt-1 text-xs text-zinc-500 whitespace-pre-wrap break-words'>{req.message}</div>}
          </div>
        </div>
        <div className='flex items-center justify-end gap-2 px-4 py-3 border-t bg-zinc-50 dark:bg-zinc-900'>
          <button autoFocus className='btn btn-primary' onClick={dismiss}>{req.confirmLabel}</button>
        </div>
      </div>
    </>,
    document.body
  )
}
function AlertHost() {
  const [queue, setQueue] = useState<AlertRequest[]>(() => alertDialogStore.getQueue())
  useEffect(() => alertDialogStore.subscribe(() => setQueue([...alertDialogStore.getQueue()])), [])
  // Only render the first request in the queue; alerts stack sequentially.
  const req = queue[0]
  if (!req) return null
  return <AlertDialog req={req} onClose={() => alertDialogStore.dismiss(req.id)} />
}

/* ============================================================
   Undo / Redo — bottom toast + global keyboard shortcuts
   ============================================================ */

/** Bottom-center toast shown after every Undo / Redo. Auto-dismisses after
 *  the user-configured duration; can be disabled entirely in Settings. */
function UndoToastHost() {
  const open = useToast(s => s.open)
  const message = useToast(s => s.message)
  const kind = useToast(s => s.kind)
  const token = useToast(s => s.token)
  const hide = useToast(s => s.hide)
  const duration = useUI(s => s.undoToastDuration)
  const canRedo = useHistory(s => s.canRedo)

  // Restart the auto-dismiss timer every time a new toast fires (token bumps).
  useEffect(() => {
    if (!open) return
    const ms = Math.max(500, Number(duration) || 2000)
    const id = window.setTimeout(() => hide(), ms)
    return () => window.clearTimeout(id)
  }, [open, token, duration, hide])

  const Icon = kind === 'redo' ? Redo2 : Undo2
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key={token}
          className='undo-toast'
          role='status'
          aria-live='polite'
          initial={{ opacity: 0, x: '-50%', y: 16, scale: 0.98 }}
          animate={{ opacity: 1, x: '-50%', y: 0, scale: 1 }}
          exit={{ opacity: 0, x: '-50%', y: 16, scale: 0.98 }}
          transition={{ type: 'spring', stiffness: 420, damping: 34 }}
        >
          <Icon className='h-4 w-4 shrink-0 text-indigo-300' />
          <span className='undo-toast-msg'>{message}</span>
          {kind === 'undo' && canRedo && (
            <button
              className='undo-toast-action'
              onClick={() => { redoAction() }}
            >
              Redo
            </button>
          )}
          <button className='undo-toast-close' aria-label='Dismiss' onClick={() => hide()}>
            <X className='h-3.5 w-3.5' />
          </button>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  )
}

/** Global keyboard shortcuts for undo/redo:
 *  • Undo — Ctrl/Cmd+Z
 *  • Redo — Ctrl+Y  OR  Ctrl/Cmd+Shift+Z
 *  Ignored while typing in inputs/textareas/contentEditable so it never
 *  clobbers the browser's native text-editing undo. */
function UndoRedoShortcuts() {
  useEffect(() => {
    const isTypingTarget = (el: EventTarget | null) => {
      if (!(el instanceof HTMLElement)) return false
      const tag = el.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
      if (el.isContentEditable) return true
      return false
    }
    const on = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return
      const key = e.key.toLowerCase()
      // Redo: Ctrl+Y or Ctrl/Cmd+Shift+Z
      if ((key === 'y' && !e.shiftKey) || (key === 'z' && e.shiftKey)) {
        e.preventDefault()
        redoAction()
        return
      }
      // Undo: Ctrl/Cmd+Z (no shift)
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault()
        undoAction()
      }
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [])
  return null
}

/** Undo / Redo icon buttons, used in the Topbar. */
function UndoRedoButtons() {
  const canUndo = useHistory(s => s.canUndo)
  const canRedo = useHistory(s => s.canRedo)
  const isMac = typeof navigator !== 'undefined' && /Mac|iP(hone|ad|od)/.test(navigator.platform)
  const mod = isMac ? '⌘' : 'Ctrl'
  return (
    <div className='flex items-center'>
      <button
        className='btn btn-ghost'
        disabled={!canUndo}
        onClick={() => undoAction()}
        title={`Undo (${mod}Z)`}
        aria-label='Undo'
      >
        <Undo2 className='h-4 w-4' />
      </button>
      <button
        className='btn btn-ghost'
        disabled={!canRedo}
        onClick={() => redoAction()}
        title={`Redo (${isMac ? '⌘⇧Z' : 'Ctrl+Y'})`}
        aria-label='Redo'
      >
        <Redo2 className='h-4 w-4' />
      </button>
    </div>
  )
}

/* ============================================================
   Sidebar (Improvement #1: projects + sidebar search fit)
   ============================================================ */
function Sidebar() {
  const ui = useUI()
  const data = useData()
  // Local modal state for creating a new project. Replaces the old
  // browser `prompt('Project name')` call with a themed NamePrompt modal.
  const [creatingProject, setCreatingProject] = useState(false)
  const counts = {
    today: data.tasks.filter(t => t.dueDate === todayStr && t.status !== 'done').length,
    upcoming: data.tasks.filter(t => t.dueDate && t.dueDate > todayStr && t.status !== 'done').length,
    favorites: data.tasks.filter(t => t.favorite).length,
    completed: data.tasks.filter(t => t.status === 'done').length,
  }
  const roots = [...data.projects].sort((a, b) => a.order - b.order)
  const projectIds = roots.map(p => p.id)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  return (
    <div className='h-full flex flex-col'>
      <div className='h-14 border-b px-4 flex items-center gap-3'>
        <div className='h-8 w-8 rounded-xl bg-black text-white dark:bg-white dark:text-black flex items-center justify-center font-bold'>O</div>
        {ui.sidebar && <div><div className='text-sm font-semibold'>Orbit</div><div className='text-[10px] text-zinc-500'>Tasks & Calendar</div></div>}
      </div>

      {ui.sidebar && (
        <button className='sidebar-search' onClick={() => ui.set({ command: true })}>
          <Search className='h-4 w-4 shrink-0' />
          <span className='sidebar-search-label'>Search…</span>
          <span className='sidebar-search-kbd'>⌘K</span>
        </button>
      )}

      {/* Premium quick-link to All tasks — always visible in the sidebar */}
      {ui.sidebar && (
        <NavLink
          to='/all-tasks'
          className='all-tasks-link'
          onClick={() => ui.set({ mobileNav: false })}
        >
          <span className='inline-flex items-center gap-2 min-w-0'>
            <ListChecks className='h-4 w-4 shrink-0' />
            <span className='truncate font-medium'>Show every task</span>
          </span>
          <span className='all-tasks-count'>{data.tasks.filter(t => !t.archived).length}</span>
        </NavLink>
      )}

      <div className='mt-3 flex-1 overflow-y-auto scrollbar-thin px-2 space-y-1'>
        {navItems.map(i => (
          <NavLink
            key={i.to}
            to={i.to}
            end={i.to === '/dashboard'}
            className={({ isActive }) => cn('nav-item', isActive && 'is-active')}
            onClick={() => ui.set({ mobileNav: false })}
          >
            <i.icon className='h-4 w-4 text-zinc-500' />
            {ui.sidebar && <>
              <span className='flex-1 truncate'>{i.label}</span>
              {i.to === '/today' && counts.today > 0 && <span className='text-[10px] text-zinc-500'>{counts.today}</span>}
              {i.to === '/upcoming' && counts.upcoming > 0 && <span className='text-[10px] text-zinc-500'>{counts.upcoming}</span>}
              {i.to === '/favorites' && counts.favorites > 0 && <span className='text-[10px] text-zinc-500'>{counts.favorites}</span>}
              {i.to === '/completed' && counts.completed > 0 && <span className='text-[10px] text-zinc-500'>{counts.completed}</span>}
            </>}
          </NavLink>
        ))}

        {ui.sidebar && (
          <>
            <div className='mt-5 mb-2 px-3 text-[11px] uppercase tracking-wider text-zinc-500 flex items-center justify-between'>
              <span className='font-semibold text-zinc-600 dark:text-zinc-400'>Projects</span>
              <button onClick={() => setCreatingProject(true)} aria-label='Add project'>
                <Plus className='h-3 w-3' />
              </button>
            </div>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(e) => {
              if (!e.over || e.active.id === e.over.id) return
              data.reorderProjects(arrayMove(projectIds, projectIds.indexOf(String(e.active.id)), projectIds.indexOf(String(e.over.id))))
            }}>
              <SortableContext items={projectIds} strategy={verticalListSortingStrategy}>
                <div className='space-y-1'>
                  {roots.map(p => <ProjectItem key={p.id} project={p} />)}
                </div>
              </SortableContext>
            </DndContext>
          </>
        )}
      </div>
      {creatingProject && (
        <NamePrompt
          title='New project'
          initial=''
          label='Project name'
          onClose={() => setCreatingProject(false)}
          onSave={(v) => { data.addProject(v) }}
        />
      )}
    </div>
  )
}

function ProjectItem({ project }: { project: Project }) {
  const dndEnabled = useDndEnabled()
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: project.id })
  const style = { transform: CSS.Transform.toString(transform), transition, ['--project-color' as any]: project.color }
  const count = useData(s => s.tasks).filter(t => t.projectId === project.id && t.status !== 'done' && !t.archived).length
  const updateProject = useData(s => s.updateProject)
  const deleteProject = useData(s => s.deleteProject)
  const ctx = useContextMenu()
  const [renaming, setRenaming] = useState(false)
  const [editingIcon, setEditingIcon] = useState(false)
  const [confirming, setConfirming] = useState(false)

  const openMenu = (e: React.MouseEvent) => {
    ctx.open(e, buildProjectMenu(project, {
      onRename: () => setRenaming(true),
      onEditIcon: () => setEditingIcon(true),
      onCopyLink: () => { try { navigator.clipboard?.writeText(window.location.origin + '/projects/' + project.id) } catch {} },
      onOpenNewTab: () => window.open(window.location.origin + '/projects/' + project.id, '_blank'),
      onDelete: () => setConfirming(true),
    }))
  }

  return (
    <>
      {ctx.node}
      {renaming && <NamePrompt title='Rename project' initial={project.name} label='Name' onClose={() => setRenaming(false)} onSave={(v) => updateProject(project.id, { name: v })} />}
      {editingIcon && <IconPicker project={project} onClose={() => setEditingIcon(false)} />}
      {confirming && <DeleteConfirm title='Delete project' name={project.name} onClose={() => setConfirming(false)} onConfirm={() => deleteProject(project.id)} />}
      <NavLink
        ref={setNodeRef as any}
        style={style as React.CSSProperties}
        to={`/projects/${project.id}`}
        className={({ isActive }) => cn('project-item', isActive && 'is-active')}
        onContextMenu={openMenu}
      >
        {dndEnabled && (
          <button {...attributes} {...listeners} className='opacity-40 hover:opacity-100 transition' onClick={e => e.stopPropagation()}>
            <GripVertical className='h-3 w-3 text-zinc-400' />
          </button>
        )}
        <span className='project-dot' style={{ background: project.color }} />
        <IconProject name={project.icon} color={project.color} className='!h-7 !w-7' />
        <span className='flex-1 truncate font-medium'>{project.name}</span>
        {project.favorite && <Star className='h-3 w-3 fill-amber-400 text-amber-400' />}
        {count > 0 && <span className='text-[10px] text-zinc-500 tabular-nums'>{count}</span>}
        <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); openMenu(e) }} className='opacity-0 hover:opacity-100 group-hover:opacity-100 transition'>
          <MoreHorizontal className='h-3.5 w-3.5 text-zinc-400' />
        </button>
      </NavLink>
    </>
  )
}

/* ============================================================
   Topbar (Improvement #5)
   ============================================================ */
function Topbar() {
  const ui = useUI()
  const navigate = useNavigate()
  const theme = ui.theme
  const compactMode = ui.compactMode
  useEffect(() => applyTheme(theme), [theme])
  // Mirror compactMode into a class on <html> so CSS can target every list.
  useEffect(() => applyCompactMode(compactMode), [compactMode])

  return (
    <div className='topbar'>
      <button className='btn btn-ghost md:hidden' onClick={() => ui.set({ mobileNav: true })}>
        <Menu className='h-4 w-4' />
      </button>
      <button
        className='btn btn-ghost hidden md:inline-flex'
        onClick={() => ui.set({ quickSettings: !ui.quickSettings })}
        aria-haspopup='dialog'
        aria-expanded={ui.quickSettings}
        title='Quick settings'
      >
        <SlidersHorizontal className='h-4 w-4' />
        <span className='hidden lg:inline'>Quick settings</span>
      </button>
      <button className='btn btn-ghost' onClick={() => ui.set({ filters: true })}>
        <Filter className='h-4 w-4' />
      </button>
      <button className='btn btn-ghost' onClick={() => ui.set({ command: true })}>
        <Search className='h-4 w-4' />
      </button>
      <div className='ml-2 hidden sm:flex items-center border-l pl-2'>
        <UndoRedoButtons />
      </div>
      <div className='ml-auto flex items-center gap-2'>
        <div className='sm:hidden'>
          <UndoRedoButtons />
        </div>
        <button className='btn btn-ghost' onClick={() => ui.set({ theme: theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light' })}>
          {theme === 'light' ? <Sun className='h-4 w-4' /> : theme === 'dark' ? <Moon className='h-4 w-4' /> : <Monitor className='h-4 w-4' />}
        </button>
        <button className='btn btn-primary' onClick={() => ui.set({ quick: true })}>
          <Plus className='h-4 w-4' />
          <span className='hidden sm:inline'>New task</span>
        </button>
      </div>
    </div>
  )
}

/* ============================================================
   Pages
   ============================================================ */
function Dashboard() {
  const f = useData(s => s.filters)
  const allTasks = useData(s => s.tasks)
  const tasks = allTasks.filter(t => taskMatches(t, f, { allTasks }))
  const projects = useData(s => s.projects)
  const compactMode = useUI(s => s.compactMode)
  const isMobile = useMedia('(max-width: 640px)')
  const slim = compactMode && isMobile
  const todays = sortTasks(tasks.filter(t => t.dueDate === todayStr))
  const due = sortTasks(tasks.filter(overdue))
  const upcoming = sortTasks(tasks.filter(t => t.dueDate && t.dueDate > todayStr)).slice(0, slim ? 4 : 5)
  const completed = tasks.filter(t => t.status === 'done').slice(0, slim ? 4 : 5)
  const week = eachDayOfInterval({ start: startOfWeek(new Date(), { weekStartsOn: 1 }), end: endOfWeek(new Date(), { weekStartsOn: 1 }) })
    .map(day => ({ day, done: tasks.filter(t => t.completedAt && isWithinInterval(parseISO(t.completedAt), { start: day, end: addDays(day, 1) })).length }))
  const statCards = [
    { label: 'Today', value: todays.length, icon: Sun },
    { label: 'Overdue', value: due.length, icon: AlertCircle },
    { label: 'Completed', value: completed.length, icon: CheckCircle2 },
    { label: 'Projects', value: projects.length, icon: FolderKanban },
  ]

  return (
    <div className={cn('overflow-y-auto scrollbar-thin h-full', slim ? 'p-4 space-y-4' : 'p-6 space-y-6')}>
      <div className='grid grid-cols-2 xl:grid-cols-4 gap-3'>
        {statCards.map(({ label, value, icon: Icon }, i) => (
          <Card key={i} className={cn(slim && '!p-3')}>
            <div className='flex items-center gap-2 text-zinc-500 text-[11px] uppercase tracking-wider'><Icon className='h-4 w-4' />{label}</div>
            <div className={cn('font-semibold', slim ? 'mt-1 text-xl' : 'mt-2 text-2xl')}>{value}</div>
          </Card>
        ))}
      </div>
      <div className={cn('grid gap-4 sm:gap-6', slim ? 'grid-cols-1' : 'lg:grid-cols-3')}>
        <Card className={cn(!slim && 'lg:col-span-2', slim && '!p-3')}>
          <div className='mb-3 flex items-center justify-between'>
            <div className='text-xs uppercase tracking-wider text-zinc-500'>Today</div>
          </div>
          {due.length > 0 && <div className='mb-3'>
            <div className='mb-2 text-[11px] uppercase tracking-wider text-rose-600'>Overdue</div>
            <TaskList tasks={due.slice(0, slim ? 2 : 3)} />
          </div>}
          <TaskList tasks={todays.slice(0, slim ? 4 : 6)} empty='Nothing for today' emptyDesc='Enjoy a quieter day or plan ahead.' />
        </Card>
        <Card className={cn(slim && '!p-3')}>
          <div className='text-xs uppercase tracking-wider text-zinc-500 mb-2'>Weekly progress</div>
          <WeeklyProgress data={week} />
        </Card>
        <Card className={cn(slim && '!p-3')}>
          <div className='text-xs uppercase tracking-wider text-zinc-500 mb-3'>Upcoming</div>
          <TaskList tasks={upcoming} empty='Nothing scheduled' emptyDesc='Your week is clear.' />
        </Card>
        <Card className={cn(slim && '!p-3')}>
          <div className='text-xs uppercase tracking-wider text-zinc-500 mb-3'>Project progress</div>
          <div className={cn('space-y-3', slim && 'space-y-2')}>
            {projects.map(p => {
              const items = tasks.filter(t => t.projectId === p.id && !t.archived)
              const done = items.filter(t => t.status === 'done').length
              const pct = items.length ? Math.round(done / items.length * 100) : 0
              return (
                <NavLink key={p.id} to={`/projects/${p.id}`} className='block'>
                  <div className='flex items-center gap-2 mb-1'>
                    <span className='h-2 w-2 rounded-full' style={{ background: p.color }} />
                    <span className='text-sm flex-1 truncate'>{p.name}</span>
                    <span className='text-[10px] text-zinc-500'>{slim ? `${done}/${items.length || 0}` : `${pct}%`}</span>
                  </div>
                  <div className='h-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden'>
                    <div className='h-full' style={{ width: `${pct}%`, background: p.color }} />
                  </div>
                </NavLink>
              )
            })}
          </div>
        </Card>
        <Card className={cn(slim && '!p-3')}>
          <div className='text-xs uppercase tracking-wider text-zinc-500 mb-3'>Recently completed</div>
          <div className='space-y-2'>
            {completed.length === 0 && <div className='text-xs text-zinc-500'>Nothing completed yet.</div>}
            {completed.map(t => (
              <div key={t.id} className='flex items-center gap-2 text-sm'>
                <CheckCircle2 className='h-4 w-4 text-emerald-500 shrink-0' />
                <span className='line-through text-zinc-500 truncate'>{t.title}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  )
}

/* ============================================================
   WeeklyProgress — brand new SVG-driven chart.
   Replaces the previous bar chart that animated `height: '%'` with
   framer-motion (which fails to interpolate string units, producing
   invisible bars). This one is deterministic: it computes pixel
   coordinates from a fixed viewBox, draws an area + line + per-day
   bars + today marker, and is fully self-contained.
   ============================================================ */
function WeeklyProgress({ data }: { data: { day: Date; done: number }[] }) {
  // Stable viewBox math so the SVG looks crisp at any size.
  const W = 320, H = 140, PAD_X = 12, PAD_Y = 18
  const innerW = W - PAD_X * 2
  const innerH = H - PAD_Y * 2
  const n = Math.max(1, data.length)
  const max = Math.max(1, ...data.map(d => d.done))
  const step = innerW / (n - 1 || 1)
  const barW = Math.min(28, step * 0.55)

  const xFor = (i: number) => PAD_X + i * step
  const yFor = (v: number) => PAD_Y + innerH - (v / max) * innerH

  const points = data.map((d, i) => ({ x: xFor(i), y: yFor(d.done), v: d.done, day: d.day, i }))

  // Smoothed line using a simple cubic curve between points.
  const linePath = points.length
    ? points.map((p, i) => {
        if (i === 0) return `M ${p.x.toFixed(1)} ${p.y.toFixed(1)}`
        const prev = points[i - 1]
        const cx = ((prev.x + p.x) / 2).toFixed(1)
        return `C ${cx} ${prev.y.toFixed(1)} ${cx} ${p.y.toFixed(1)} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`
      }).join(' ')
    : ''
  // Same shape, closed at the bottom to form the area fill.
  const areaPath = linePath ? `${linePath} L ${PAD_X + innerW} ${PAD_Y + innerH} L ${PAD_X} ${PAD_Y + innerH} Z` : ''

  // Horizontal grid lines (4 ticks).
  const ticks = [0, 0.33, 0.66, 1]

  const todayIndex = data.findIndex(d => isToday(d.day))
  const total = data.reduce((s, d) => s + d.done, 0)
  const bestDay = data.reduce((acc, d) => (d.done > acc.done ? d : acc), data[0] || { day: new Date(), done: 0 })

  return (
    <div className='weekly-progress'>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio='none' role='img' aria-label='Weekly progress chart'>
        <defs>
          <linearGradient id='wpAreaGradient' x1='0' x2='0' y1='0' y2='1'>
            <stop offset='0%' stopColor='hsl(var(--selected-border))' stopOpacity='0.35' />
            <stop offset='100%' stopColor='hsl(var(--selected-border))' stopOpacity='0.02' />
          </linearGradient>
        </defs>

        {/* Grid */}
        <g className='wp-grid'>
          {ticks.map((t, i) => {
            const y = PAD_Y + innerH * t
            return <line key={i} x1={PAD_X} x2={W - PAD_X} y1={y} y2={y} />
          })}
        </g>

        {/* Per-day bars sit behind the curve to give the chart depth. */}
        <g>
          {points.map(p => {
            const baseY = PAD_Y + innerH
            const barH = Math.max(2, baseY - p.y)
            return (
              <rect
                key={p.i}
                className={cn('wp-bar', p.i === todayIndex && 'is-today')}
                x={p.x - barW / 2}
                y={baseY - barH}
                width={barW}
                height={barH}
                rx={6}
              >
                <title>{`${format(p.day, 'EEEE, MMM d')} — ${p.v} completed`}</title>
              </rect>
            )
          })}
        </g>

        {/* Area + line + points on top */}
        <path className='wp-area' d={areaPath} />
        <path className='wp-line' d={linePath} />
        <g>
          {points.map(p => (
            <circle key={p.i} className={cn('wp-point', p.i === todayIndex && 'is-today')} cx={p.x} cy={p.y} r={p.i === todayIndex ? 4 : 3} />
          ))}
        </g>

        {/* Value labels for non-zero days */}
        <g>
          {points.map(p => p.v > 0 ? (
            <text key={p.i} className='wp-value' x={p.x} y={Math.max(PAD_Y + 8, p.y - 8)} textAnchor='middle'>{p.v}</text>
          ) : null)}
        </g>

        {/* Day labels along the bottom */}
        <g>
          {points.map(p => (
            <text key={p.i} className={cn('wp-label', p.i === todayIndex && 'is-today')} x={p.x} y={H - 4} textAnchor='middle'>
              {format(p.day, 'EEEEE')}
            </text>
          ))}
        </g>
      </svg>

      <div className='weekly-progress-summary'>
        <span className='wp-total'>
          <b>{total}</b>
          <span>completed this week</span>
        </span>
        {total > 0 && (
          <span className='wp-pill'>
            <Sparkles className='h-3 w-3' />
            Best: {format(bestDay.day, 'EEE')} · {bestDay.done}
          </span>
        )}
      </div>
    </div>
  )
}

function TodayPage() {
  const f = useData(s => s.filters)
  const allTasks = useData(s => s.tasks)
  // Today = tasks dueing today (and not done). Overdue = tasks whose due date is
  // strictly before today and that are still open. Show BOTH groups on Today.
  const todayTasks = sortTasks(allTasks.filter(t => taskMatches(t, f, { allTasks }) && t.dueDate === todayStr))
  const dueTasks = sortTasks(allTasks.filter(t => taskMatches(t, f, { allTasks }) && overdue(t)))
  return (
    <div className='p-6 space-y-6 overflow-y-auto h-full'>
      {dueTasks.length > 0 && (
        <div>
          <div className='mb-2 text-[11px] uppercase tracking-wider text-rose-600 flex items-center gap-1.5'>
            <AlertCircle className='h-3.5 w-3.5' />
            Overdue
            <span className='text-rose-600/60 normal-case tracking-normal'>· {dueTasks.length}</span>
          </div>
          <TaskList tasks={dueTasks} />
        </div>
      )}
      <div>
        <div className='mb-2 text-[11px] uppercase tracking-wider text-zinc-500 flex items-center gap-1.5'>
          <Sun className='h-3.5 w-3.5' />
          Today
          {todayTasks.length > 0 && <span className='normal-case tracking-normal'>· {todayTasks.length}</span>}
        </div>
        <TaskList
          tasks={todayTasks}
          empty={dueTasks.length > 0 ? 'Nothing scheduled for today' : 'Nothing on your plate today'}
          emptyDesc={dueTasks.length > 0 ? 'You still have overdue work above — finish those first.' : 'Take a breather or plan ahead.'}
        />
      </div>
    </div>
  )
}
function UpcomingPage() {
  const f = useData(s => s.filters)
  const allTasks = useData(s => s.tasks)
  const tasks = sortTasks(allTasks.filter(t => taskMatches(t, f, { allTasks }) && t.dueDate && t.dueDate >= todayStr))
  return <div className='p-6 overflow-y-auto h-full'><TaskList tasks={tasks} empty='Nothing upcoming' emptyDesc='No future tasks scheduled yet.' /></div>
}
function FavoritesPage() {
  const f = useData(s => s.filters)
  const allTasks = useData(s => s.tasks)
  const tasks = sortTasks(allTasks.filter(t => t.favorite && taskMatches(t, f, { allTasks })))
  return <div className='p-6 overflow-y-auto h-full'><TaskList tasks={tasks} empty='No favorites yet' emptyDesc='Star tasks to find them faster.' /></div>
}
function CompletedPage() {
  const f = useData(s => s.filters)
  const allTasks = useData(s => s.tasks)
  const tasks = sortTasks(allTasks.filter(t => t.status === 'done' && taskMatches(t, f, { allTasks })))
  return <div className='p-6 overflow-y-auto h-full'><TaskList tasks={tasks} empty='Nothing completed yet' emptyDesc='Finished work will appear here.' /></div>
}
function ArchivePage() {
  const f = useData(s => s.filters)
  const allTasks = useData(s => s.tasks)
  const tasks = sortTasks(allTasks.filter(t => t.archived && taskMatches(t, f, { includeArchived: true, allTasks })))
  return <div className='p-6 overflow-y-auto h-full'><TaskList tasks={tasks} empty='Archive is empty' emptyDesc='Archived tasks land here.' /></div>
}

/* ============================================================
   All Tasks — every task ever created, except archived (filterable).
   ============================================================ */
function AllTasksPage() {
  const allTasks = useData(s => s.tasks)
  const projects = useData(s => s.projects)
  const tags = useData(s => s.tags)
  const globalFilter = useData(s => s.filters)
  const setGlobalFilters = useData(s => s.setFilters)

  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<Status | 'all'>('all')
  const [priority, setPriority] = useState<Priority | 'all'>('all')
  const [projectId, setProjectId] = useState<string>('all')
  const [tagId, setTagId] = useState<string>('all')
  const [favOnly, setFavOnly] = useState(false)
  const [includeDone, setIncludeDone] = useState(true)
  const [includeArchived, setIncludeArchived] = useState(false)
  // Sort is driven by the GLOBAL filter so the top-header "Filters & Sort"
  // panel and this page's own sort control stay in sync and both work.
  const sortKey = globalFilter.sort ?? 'updated'
  const sortDir = globalFilter.sortDir ?? 'desc'
  const setSortKey = (k: SortKey) => setGlobalFilters({ sort: k })
  const setSortDir = (d: SortDir | ((prev: SortDir) => SortDir)) =>
    setGlobalFilters({ sortDir: typeof d === 'function' ? d(sortDir) : d })
  const [showFilters, setShowFilters] = useState(false)

  const filtered = useMemo(() => {
    // Apply the GLOBAL top-header filter first so it narrows this view too,
    // then layer the page's own local filters on top.
    let list = allTasks.filter(t => taskMatches(t, globalFilter, { includeArchived: true, allTasks }))
    if (!includeArchived) list = list.filter(t => !t.archived)
    if (!includeDone) list = list.filter(t => t.status !== 'done')
    if (status !== 'all') list = list.filter(t => t.status === status)
    if (priority !== 'all') list = list.filter(t => t.priority === priority)
    if (projectId !== 'all') list = list.filter(t => (t.projectId || '') === (projectId == 'none' ? '' : projectId))
    if (tagId !== 'all') list = list.filter(t => t.tags.includes(tagId))
    if (favOnly) list = list.filter(t => t.favorite)
    if (query.trim()) {
      const q = query.trim().toLowerCase()
      // Match subtasks too: keep a parent when any descendant matches.
      list = list.filter(t => searchHitsTaskOrDescendant(t, q, allTasks))
    }
    list.sort((a, b) => compareBy(a, b, sortKey, sortDir))
    return list
  }, [allTasks, globalFilter, includeArchived, includeDone, status, priority, projectId, tagId, favOnly, query, sortKey, sortDir])

  const total = allTasks.filter(t => !t.archived).length
  const archivedCount = allTasks.filter(t => t.archived).length
  const resetFilters = () => {
    setQuery(''); setStatus('all'); setPriority('all'); setProjectId('all'); setTagId('all')
    setFavOnly(false); setIncludeDone(true); setIncludeArchived(false)
    setGlobalFilters({ sort: 'updated', sortDir: 'desc' })
  }
  const activeFilterCount = [
    query.trim().length > 0,
    status !== 'all',
    priority !== 'all',
    projectId !== 'all',
    tagId !== 'all',
    favOnly,
    !includeDone,
    includeArchived,
  ].filter(Boolean).length

  // Filter popover anchor — the popover is positioned absolutely below the
  // "Filters" button so it never steals layout space (no more half-screen panel).
  const filterBtnRef = useRef<HTMLButtonElement | null>(null)
  const [filterPos, setFilterPos] = useState<{ top: number; left: number } | null>(null)
  useEffect(() => {
    if (!showFilters) { setFilterPos(null); return }
    const update = () => {
      const el = filterBtnRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      setFilterPos({ top: r.bottom + 8, left: r.left })
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [showFilters])
  // Close on outside click / escape
  useEffect(() => {
    if (!showFilters) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowFilters(false) }
    const onClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement
      if (t.closest('.alltasks-filter-pop') || t.closest('.alltasks-filter-btn')) return
      setShowFilters(false)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onClick)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onClick)
    }
  }, [showFilters])

  return (
    <div className='h-full flex flex-col'>
      {/* Compact, single-row header: title + count on left, search + filter + sort on right.
          No more fixed half-screen filter panel — filters open as a small popover.

          Mobile note: the whole strip is redesigned as a single compact row
          (see .alltasks-filter-strip in index.css @media max-width:768px). Search
          becomes a flex-1 field with icon-only filter / sort-dir buttons and a
          slim sort-key select. Desktop layout is untouched. */}
      <div className='alltasks-header border-b px-4 sm:px-6 py-2.5 sm:py-3 flex items-center gap-2 sm:gap-3 flex-wrap'>
        <div className='min-w-0'>
          <div className='text-sm sm:text-base font-semibold flex items-center gap-2'>
            <ListChecks className='h-4 w-4 sm:h-5 sm:w-5' /> All tasks
            <span className='text-[11px] font-normal text-zinc-500 ml-1'>
              <span className='font-semibold text-[hsl(var(--foreground))]'>{filtered.length}</span> / {total}
              {archivedCount > 0 && <span className='text-zinc-400'> · {archivedCount} archived</span>}
            </span>
          </div>
        </div>

        {/* The new compact filter strip — lives inline, doesn't dominate the page. */}
        <div className='alltasks-filter-strip ml-auto flex items-center gap-1.5 flex-wrap sm:flex-nowrap'>
          <div className='alltasks-search search-field search-field-sm w-[160px] sm:w-[220px]'>
            <Search className='search-field-icon' />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder='Search tasks…'
              className='search-field-input'
              aria-label='Search tasks'
            />
          </div>
          <button
            ref={filterBtnRef}
            className={cn('alltasks-filter-btn btn btn-secondary !h-9 !px-2.5 text-xs', showFilters && 'bg-zinc-200 dark:bg-zinc-700', activeFilterCount > 0 && 'ring-1 ring-[hsl(var(--focus))/0.4]')}
            onClick={() => setShowFilters(v => !v)}
            aria-expanded={showFilters}
            aria-label='Filters'
            title='Filters'
          >
            <Filter className='h-3.5 w-3.5' />
            <span className='alltasks-btn-label hidden sm:inline'>Filters</span>
            {activeFilterCount > 0 && <span className='rounded-full bg-[hsl(var(--focus))/0.18] text-[hsl(var(--focus))] px-1.5 py-0.5 text-[10px] leading-none font-semibold min-w-[16px] text-center'>{activeFilterCount}</span>}
          </button>
          <select className='alltasks-sort-key input !w-auto !h-9 text-xs min-w-[100px]' value={sortKey} onChange={e => setSortKey(e.target.value as SortKey)} title='Sort by' aria-label='Sort by'>
            <option value='updated'>Updated</option>
            <option value='created'>Created</option>
            <option value='due'>Due date</option>
            <option value='priority'>Priority</option>
            <option value='title'>Title</option>
          </select>
          <button
            className='alltasks-sort-dir btn btn-secondary !h-9 !w-9 !px-0 inline-flex items-center justify-center'
            title={sortDir === 'asc' ? 'Ascending' : 'Descending'}
            aria-label={sortDir === 'asc' ? 'Ascending' : 'Descending'}
            onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')}
          >
            {sortDir === 'asc'
              ? <ArrowUp className='h-3.5 w-3.5' aria-hidden='true' />
              : <ArrowDown className='h-3.5 w-3.5' aria-hidden='true' />}
          </button>
          {activeFilterCount > 0 && (
            <button className='alltasks-reset btn btn-ghost !h-9 !px-2 text-xs' onClick={resetFilters} aria-label='Reset filters' title='Reset filters'>
              <X className='h-3.5 w-3.5' /> <span className='alltasks-btn-label hidden sm:inline'>Reset</span>
            </button>
          )}
        </div>

        {/* Active filter chips — only when filters are applied, on a second line, compact. */}
        {activeFilterCount > 0 && (
          <div className='basis-full flex flex-wrap gap-1.5 -mt-1'>
            {status !== 'all' && <button className='filter-chip' onClick={() => setStatus('all')}>{statusMeta[status].label} <X className='h-3 w-3' /></button>}
            {priority !== 'all' && <button className='filter-chip' onClick={() => setPriority('all')}>{priorityMeta[priority].label} <X className='h-3 w-3' /></button>}
            {projectId !== 'all' && <button className='filter-chip' onClick={() => setProjectId('all')}>{projectId === 'none' ? 'No project' : projects.find(p => p.id === projectId)?.name || 'Project'} <X className='h-3 w-3' /></button>}
            {tagId !== 'all' && <button className='filter-chip' onClick={() => setTagId('all')}>{tags.find(t => t.id === tagId)?.name || 'Tag'} <X className='h-3 w-3' /></button>}
            {favOnly && <button className='filter-chip' onClick={() => setFavOnly(false)}>Favorites <X className='h-3 w-3' /></button>}
            {!includeDone && <button className='filter-chip' onClick={() => setIncludeDone(true)}>Open only <X className='h-3 w-3' /></button>}
            {includeArchived && <button className='filter-chip' onClick={() => setIncludeArchived(false)}>Archived <X className='h-3 w-3' /></button>}
          </div>
        )}
      </div>

      {/* Filter popover — portaled out of normal flow so it never resizes the page. */}
      {showFilters && filterPos && createPortal(
        <div
          className='alltasks-filter-pop panel'
          style={{
            position: 'fixed',
            top: filterPos.top,
            left: Math.max(8, Math.min(filterPos.left, window.innerWidth - 360)),
            width: 'min(360px, calc(100vw - 16px))',
            zIndex: 60,
          }}
          onMouseDown={e => e.stopPropagation()}
        >
          <div className='p-3 sm:p-4 space-y-3'>
            <div className='grid grid-cols-2 gap-2.5'>
              <label className='space-y-1 text-[10px] uppercase tracking-wider text-zinc-500'>
                <span>Status</span>
                <select className='input !h-8 text-xs w-full' value={status} onChange={e => setStatus(e.target.value as Status | 'all')}>
                  <option value='all'>All</option>
                  {(Object.keys(statusMeta) as Status[]).map(s => <option key={s} value={s}>{statusMeta[s].label}</option>)}
                </select>
              </label>
              <label className='space-y-1 text-[10px] uppercase tracking-wider text-zinc-500'>
                <span>Priority</span>
                <select className='input !h-8 text-xs w-full' value={priority} onChange={e => setPriority(e.target.value as Priority | 'all')}>
                  <option value='all'>All</option>
                  {(Object.keys(priorityMeta) as Priority[]).map(p => <option key={p} value={p}>{priorityMeta[p].label}</option>)}
                </select>
              </label>
              <label className='space-y-1 text-[10px] uppercase tracking-wider text-zinc-500'>
                <span>Project</span>
                <select className='input !h-8 text-xs w-full' value={projectId} onChange={e => setProjectId(e.target.value)}>
                  <option value='all'>All</option>
                  <option value='none'>No project</option>
                  {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>
              <label className='space-y-1 text-[10px] uppercase tracking-wider text-zinc-500'>
                <span>Tag</span>
                <select className='input !h-8 text-xs w-full' value={tagId} onChange={e => setTagId(e.target.value)}>
                  <option value='all'>All</option>
                  {tags.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </label>
            </div>
            <div className='flex flex-wrap gap-1.5 pt-1 border-t border-[hsl(var(--border))]'>
              <label className='filter-toggle'>
                <input type='checkbox' checked={favOnly} onChange={e => setFavOnly(e.target.checked)} />
                <Star className='h-3 w-3' /> Favorites
              </label>
              <label className='filter-toggle'>
                <input type='checkbox' checked={includeDone} onChange={e => setIncludeDone(e.target.checked)} />
                <CheckCircle2 className='h-3 w-3' /> Done
              </label>
              <label className='filter-toggle'>
                <input type='checkbox' checked={includeArchived} onChange={e => setIncludeArchived(e.target.checked)} />
                <Archive className='h-3 w-3' /> Archived
              </label>
            </div>
            {/* No Apply/Done button — filters apply in real time as you change
                them. Only a "Clear all" affordance remains. */}
            <div className='flex items-center justify-between pt-1'>
              <span className='text-[10px] text-zinc-400'>Changes apply instantly</span>
              <button className='btn btn-ghost !h-8 text-xs' onClick={resetFilters} disabled={activeFilterCount === 0}>Clear all</button>
            </div>
          </div>
        </div>,
        document.body
      )}

      <div className='flex-1 min-h-0 overflow-y-auto scrollbar-thin p-4 sm:p-6'>
        <TaskList
          tasks={filtered}
          empty='No tasks match'
          emptyDesc='Try clearing some filters or create a new task.'
          emptyAction={<button className='btn btn-secondary' onClick={resetFilters}>Reset filters</button>}
          hideDoneChildren={!includeDone}
        />
      </div>
    </div>
  )
}

/* Defensive boundary so a runtime error in a sub-tree (e.g. canvas drag) never
   takes down the whole app. Renders a recovery panel instead of a blank screen. */
class ErrorBoundary extends React.Component<{ children: React.ReactNode; fallback?: React.ReactNode }, { err: Error | null }> {
  constructor(props: any){ super(props); this.state = { err: null } }
  static getDerivedStateFromError(err: Error){ return { err } }
  componentDidCatch(err: Error){ console.error('[Orbit] caught render error:', err) }
  reset = () => this.setState({ err: null })
  render(){
    if (this.state.err){
      return this.props.fallback ?? (
        <div className='h-full flex items-center justify-center p-6'>
          <div className='panel p-6 max-w-md text-center'>
            <div className='text-sm font-semibold mb-2'>Something went wrong</div>
            <div className='text-xs text-zinc-500 mb-4'>The view hit an unexpected error. You can keep working — the rest of the app is fine.</div>
            <div className='flex justify-center gap-2'>
              <button className='btn btn-secondary' onClick={this.reset}>Try again</button>
              <a className='btn btn-primary' href='/today'>Back to Today</a>
            </div>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

function TagsPage() {
  const tags = useData(s => s.tags)
  const tasks = useData(s => s.tasks)
  const addTag = useData(s => s.addTag)
  const updateTag = useData(s => s.updateTag)
  const deleteTag = useData(s => s.deleteTag)
  const [tab, setTab] = useState<'view' | 'manage'>('view')
  const [active, setActive] = useState(tags[0]?.id || '')
  const [confirmDel, setConfirmDel] = useState<Tag | null>(null)
  const [newName, setNewName] = useState('')
  const f = useData(s => s.filters)
  const filtered = sortTasks(tasks.filter(t => (active ? t.tags.includes(active) : false) && taskMatches(t, f, { allTasks: tasks })))

  return (
    <div className='h-full flex flex-col'>
      <div className='border-b px-4 flex items-center gap-2 h-12'>
        {(['view', 'manage'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={cn('px-3 py-1.5 rounded-lg text-sm capitalize transition', tab === t ? 'bg-[hsl(var(--accent))] font-semibold' : 'text-zinc-500 hover:bg-[hsl(var(--accent))]')}>
            {t}
          </button>
        ))}
      </div>
      {tab === 'view' ? (
        <div className='grid md:grid-cols-[240px_1fr] flex-1 min-h-0'>
          <div className='border-b md:border-b-0 md:border-r p-4 space-y-1 overflow-y-auto'>
            {tags.length === 0 && <div className='text-xs text-zinc-500'>No tags yet. Go to the Manage tab to add one.</div>}
            {tags.map(t => (
              <button key={t.id} onClick={() => setActive(t.id)} className={cn('w-full flex items-center gap-2 rounded-xl px-3 py-2 text-sm', active === t.id ? 'bg-zinc-100 dark:bg-zinc-800' : 'hover:bg-zinc-100 dark:hover:bg-zinc-800')}>
                <span className='h-2 w-2 rounded-full' style={{ background: t.color }} />
                {t.name}
                <span className='ml-auto text-[10px] text-zinc-500'>{tasks.filter(x => x.tags.includes(t.id)).length}</span>
              </button>
            ))}
          </div>
          <div className='p-6 overflow-y-auto'>
            <TaskList tasks={filtered} empty='Pick a tag' emptyDesc='Select a tag to see related tasks.' />
          </div>
        </div>
      ) : (
        <div className='p-6 overflow-y-auto flex-1 min-h-0'>
          {confirmDel && <DeleteConfirm title='Delete tag' name={confirmDel.name} onClose={() => setConfirmDel(null)} onConfirm={() => deleteTag(confirmDel.id)} />}
          <div className='max-w-2xl space-y-4'>
            <Card>
              <div className='text-sm font-semibold mb-3'>Add a tag</div>
              <div className='flex gap-2'>
                <input className='input flex-1' placeholder='Tag name' value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && newName.trim()) { addTag(newName.trim()); setNewName('') } }} />
                <button className='btn btn-primary' disabled={!newName.trim()} onClick={() => { addTag(newName.trim()); setNewName('') }}><Plus className='h-4 w-4' /> Add</button>
              </div>
            </Card>
            <Card>
              <div className='text-sm font-semibold mb-3'>Manage tags</div>
              {tags.length === 0 && <div className='text-xs text-zinc-500'>No tags yet.</div>}
              <div className='space-y-2'>
                {tags.map(t => (
                  <div key={t.id} className='flex items-center gap-2'>
                    <input type='color' className='h-9 w-10 border rounded cursor-pointer bg-transparent' value={t.color} onChange={e => updateTag(t.id, { color: e.target.value })} />
                    <input className='input flex-1' value={t.name} onChange={e => updateTag(t.id, { name: e.target.value })} />
                    <span className='text-xs text-zinc-500 w-12 text-right'>{tasks.filter(x => x.tags.includes(t.id)).length} tasks</span>
                    <button className='btn btn-ghost text-rose-600' onClick={() => setConfirmDel(t)}>
                      <Trash2 className='h-4 w-4' />
                    </button>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------
   Reusable switch used by every settings surface. Reads/writes the
   SAME useUI store, so any instance (main page or Quick Settings popup)
   stays in sync automatically — flipping one updates the other live.
   ------------------------------------------------------------------ */
function Switch({ checked, onChange, label }: { checked: boolean; onChange: () => void; label?: string }) {
  return (
    <button
      type='button'
      role='switch'
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      className={cn(
        'relative inline-flex h-6 w-11 items-center rounded-full transition shrink-0',
        checked ? 'bg-indigo-500' : 'bg-zinc-300 dark:bg-zinc-700'
      )}
    >
      <span
        className={cn(
          'inline-block h-5 w-5 transform rounded-full bg-white shadow transition',
          checked ? 'translate-x-5' : 'translate-x-0.5'
        )}
      />
    </button>
  )
}

/* Shared settings body. `compact` renders a tighter version for the
   Quick Settings popup; the full version powers the main Settings page.
   Both operate on the identical useUI store so they are always in sync. */
function SettingsContent({ compact = false }: { compact?: boolean }) {
  const ui = useUI()
  return (
    <div className={cn(compact ? 'space-y-4' : 'space-y-6')}>
      <Card className={cn(compact && '!p-4')}>
        <div className='text-sm font-semibold mb-3'>Appearance</div>
        <div className='grid grid-cols-3 gap-2'>
          {(['light', 'dark', 'system'] as const).map(m => (
            <button key={m} onClick={() => ui.set({ theme: m })} className={cn('panel text-sm capitalize', compact ? 'p-2.5' : 'p-4', ui.theme === m && 'ring-2 ring-indigo-500/30')}>{m}</button>
          ))}
        </div>
      </Card>

      {/* ====== Global Drag & Drop toggle ====== */}
      <Card className={cn(compact && '!p-4')}>
        <div className='flex items-start gap-3'>
          <div className='flex-1'>
            <div className='text-sm font-semibold flex items-center gap-2'>
              <Move className='h-4 w-4 text-zinc-500' />Drag &amp; drop
            </div>
            <div className='mt-1 text-xs text-zinc-500'>
              {ui.dndEnabled ? 'Enabled' : 'Disabled'} — controls every drag-and-drop
              interaction across the app: reordering tasks, subtasks and projects,
              moving cards on the board, and dragging tasks onto the calendar.
            </div>
          </div>
          <Switch
            checked={ui.dndEnabled}
            onChange={() => ui.set({ dndEnabled: !ui.dndEnabled })}
            label='Enable or disable drag and drop'
          />
        </div>
      </Card>

      {/* ====== Undo / Redo toast ====== */}
      <Card className={cn(compact && '!p-4')}>
        <div className='flex items-start gap-3'>
          <div className='flex-1'>
            <div className='text-sm font-semibold flex items-center gap-2'>
              <RotateCcw className='h-4 w-4 text-zinc-500' />Undo &amp; Redo toast
            </div>
            <div className='mt-1 text-xs text-zinc-500'>
              {ui.undoToastEnabled ? 'Enabled' : 'Disabled'} — after each Undo or
              Redo, a small toast at the bottom describes the reverted action.
              Undo with {typeof navigator !== 'undefined' && /Mac/.test(navigator.platform) ? '⌘Z' : 'Ctrl+Z'},
              redo with {typeof navigator !== 'undefined' && /Mac/.test(navigator.platform) ? '⌘⇧Z' : 'Ctrl+Y'}.
            </div>
          </div>
          <Switch
            checked={ui.undoToastEnabled}
            onChange={() => ui.set({ undoToastEnabled: !ui.undoToastEnabled })}
            label='Toggle undo/redo toast'
          />
        </div>
        {ui.undoToastEnabled && (
          <div className='mt-4'>
            <div className='flex items-center justify-between text-xs text-zinc-500 mb-2'>
              <span>Toast duration</span>
              <span className='font-medium text-[hsl(var(--foreground))]'>
                {(ui.undoToastDuration / 1000).toFixed(1)}s
              </span>
            </div>
            <input
              type='range'
              min={1000}
              max={8000}
              step={500}
              value={ui.undoToastDuration}
              onChange={e => ui.set({ undoToastDuration: Number(e.target.value) })}
              className='w-full accent-indigo-500 cursor-pointer'
              aria-label='Toast duration in milliseconds'
            />
            <div className='flex justify-between text-[10px] text-zinc-400 mt-1'>
              <span>1s</span><span>Default 2s</span><span>8s</span>
            </div>
          </div>
        )}
      </Card>

      {/* ====== Calendar side panel toggle (desktop only) ====== */}
      <Card className={cn(compact && '!p-4')}>
        <div className='flex items-start gap-3'>
          <div className='flex-1'>
            <div className='text-sm font-semibold flex items-center gap-2'>
              <CalendarDays className='h-4 w-4 text-zinc-500' />Calendar side panel
            </div>
            <div className='mt-1 text-xs text-zinc-500'>
              {ui.calendarSidePanel ? 'Enabled' : 'Disabled'} — shows a fixed
              "Select existing task" panel on the right of the calendar (desktop
              only). Pick a task to schedule it onto the day you're viewing.
            </div>
          </div>
          <Switch
            checked={ui.calendarSidePanel}
            onChange={() => ui.set({ calendarSidePanel: !ui.calendarSidePanel })}
            label='Toggle calendar side panel'
          />
        </div>
      </Card>

      {/* ====== Density / Layout toggle ====== */}
      <Card className={cn(compact && '!p-4')}>
        <div className='flex items-start gap-3'>
          <div className='flex-1'>
            <div className='text-sm font-semibold'>Compact layout</div>
            <div className='mt-1 text-xs text-zinc-500'>
              Render every task and project list in a minimum, table-row style.
              Descriptions, images and verbose meta are hidden so you can scan
              dozens of rows at a glance. Toggle off to return to the spacious view.
            </div>
          </div>
          <Switch
            checked={ui.compactMode}
            onChange={() => ui.set({ compactMode: !ui.compactMode })}
            label='Toggle compact layout'
          />
        </div>
        {!compact && (
          <div className='mt-4 grid sm:grid-cols-2 gap-3'>
            <button
              onClick={() => ui.set({ compactMode: false })}
              className={cn('panel p-3 text-left', !ui.compactMode && 'ring-2 ring-indigo-500/40')}
            >
              <div className='text-xs font-semibold mb-2'>Spacious</div>
              <div className='space-y-1.5'>
                <div className='h-3 rounded bg-zinc-200 dark:bg-zinc-700 w-3/4' />
                <div className='h-2 rounded bg-zinc-100 dark:bg-zinc-800 w-1/2' />
                <div className='flex gap-1.5 pt-1'>
                  <div className='h-2 w-8 rounded bg-zinc-100 dark:bg-zinc-800' />
                  <div className='h-2 w-10 rounded bg-zinc-100 dark:bg-zinc-800' />
                </div>
              </div>
            </button>
            <button
              onClick={() => ui.set({ compactMode: true })}
              className={cn('panel p-3 text-left', ui.compactMode && 'ring-2 ring-indigo-500/40')}
            >
              <div className='text-xs font-semibold mb-2'>Compact (table)</div>
              <div className='space-y-1'>
                <div className='h-2 rounded bg-zinc-200 dark:bg-zinc-700 w-5/6' />
                <div className='h-2 rounded bg-zinc-200 dark:bg-zinc-700 w-4/6' />
                <div className='h-2 rounded bg-zinc-200 dark:bg-zinc-700 w-5/6' />
                <div className='h-2 rounded bg-zinc-200 dark:bg-zinc-700 w-3/6' />
              </div>
            </button>
          </div>
        )}
      </Card>

      {!compact && (
        <Card>
          <div className='text-sm font-semibold mb-3'>Keyboard shortcuts</div>
          <div className='space-y-2 text-sm text-zinc-500'>
            <div>⌘K — command palette</div>
            <div>⌘N — quick add</div>
            <div>⌘B — toggle sidebar</div>
            <div>⌘D — duplicate selected task</div>
            <div>⌘Z — undo last action</div>
            <div>⌘⇧Z / Ctrl+Y — redo</div>
            <div>Delete / Backspace — delete selected task or open project (with confirmation)</div>
            <div>Drag & drop — reorder tasks, subtasks, and projects</div>
          </div>
        </Card>
      )}
      <Card className={cn(compact && '!p-4')}>
        <div className='text-sm font-semibold mb-3'>Local data</div>
        <button className='btn btn-secondary' onClick={() => { localStorage.removeItem('orbit-data'); location.reload() }}>
          <Trash2 className='h-4 w-4' />Reset demo data
        </button>
      </Card>
    </div>
  )
}

function SettingsPage() {
  return (
    <div className='p-6 max-w-3xl overflow-y-auto h-full'>
      <SettingsContent />
    </div>
  )
}

/* ------------------------------------------------------------------
   Quick Settings popup — a compact shortcut to the main Settings page.
   Contains the exact same settings (via <SettingsContent compact />),
   so every control here is fully synchronized with /settings.
   ------------------------------------------------------------------ */
function QuickSettingsPopup() {
  const open = useUI(s => s.quickSettings)
  const setUI = useUI(s => s.set)
  const navigate = useNavigate()
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setUI({ quickSettings: false }) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, setUI])
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className='popup-overlay'
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setUI({ quickSettings: false })}
          />
          <motion.div
            className='quick-settings-popup panel'
            role='dialog'
            aria-label='Quick settings'
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
          >
            <div className='flex items-center gap-2 p-4 border-b'>
              <SlidersHorizontal className='h-4 w-4 text-zinc-500' />
              <div className='text-sm font-semibold'>Quick settings</div>
              <button
                className='btn btn-ghost !h-8 !px-2 ml-auto'
                onClick={() => { setUI({ quickSettings: false }); navigate('/settings') }}
              >
                <span className='text-xs'>All settings</span>
                <ExternalLink className='h-3.5 w-3.5' />
              </button>
              <button className='btn btn-ghost !h-8 !px-2' onClick={() => setUI({ quickSettings: false })} aria-label='Close'>
                <X className='h-4 w-4' />
              </button>
            </div>
            <div className='p-4 overflow-y-auto scrollbar-thin quick-settings-body'>
              <SettingsContent compact />
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

function ProjectsPage() {
  const projects = useData(s => s.projects)
  const tasks = useData(s => s.tasks)
  const compactMode = useUI(s => s.compactMode)
  return (
    <div className='p-6 overflow-y-auto h-full'>
      {compactMode ? (
        <div className='space-y-2'>
          {projects.map(p => {
            const items = tasks.filter(t => t.projectId === p.id && !t.archived)
            const done = items.filter(t => t.status === 'done').length
            const pct = items.length ? Math.round(done / items.length * 100) : 0
            return (
              <NavLink key={p.id} to={`/projects/${p.id}`} className='panel px-3 py-3 flex items-center gap-3 hover:shadow-sm transition'>
                <IconProject name={p.icon} color={p.color} className='!h-9 !w-9' />
                <div className='min-w-0 flex-1'>
                  <div className='flex items-center gap-2'>
                    <div className='text-sm font-semibold truncate'>{p.name}</div>
                    {p.favorite && <Star className='h-3 w-3 fill-amber-400 text-amber-400 shrink-0' />}
                    <span className='ml-auto text-[10px] text-zinc-500'>{items.length} tasks</span>
                  </div>
                  <div className='mt-1 flex items-center gap-2 text-[11px] text-zinc-500'>
                    <span>{done}/{items.length || 0} done</span>
                    <span className='h-1 w-1 rounded-full bg-zinc-300 dark:bg-zinc-600' />
                    <span>{pct}% complete</span>
                  </div>
                </div>
              </NavLink>
            )
          })}
        </div>
      ) : (
        <div className='grid lg:grid-cols-3 md:grid-cols-2 gap-4'>
          {projects.map(p => {
            const items = tasks.filter(t => t.projectId === p.id && !t.archived)
            const done = items.filter(t => t.status === 'done').length
            const pct = items.length ? Math.round(done / items.length * 100) : 0
            return (
              <NavLink key={p.id} to={`/projects/${p.id}`} className='panel p-4 block hover:shadow-sm transition'>
                <div className='flex items-start gap-3'>
                  <IconProject name={p.icon} color={p.color} />
                  <div className='flex-1 min-w-0'>
                    <div className='flex items-center gap-2'>
                      <div className='text-sm font-semibold truncate'>{p.name}</div>
                      {p.favorite && <Star className='h-3 w-3 fill-amber-400 text-amber-400' />}
                    </div>
                    <div className='mt-1 text-xs text-zinc-500'>{p.description || 'Project workspace'}</div>
                    <div className='mt-3 h-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden'>
                      <div className='h-full' style={{ width: `${pct}%`, background: p.color }} />
                    </div>
                  </div>
                </div>
              </NavLink>
            )
          })}
        </div>
      )}
    </div>
  )
}

function KanbanTaskCard({ task, onDragStart, onDragEnd }: { task: Task; onDragStart: (id: string) => void; onDragEnd: () => void }) {
  const setUI = useUI(s => s.set)
  const toggleFav = useData(s => s.toggleFav)
  const projects = useData(s => s.projects)
  const tags = useData(s => s.tags)
  const allTasks = useData(s => s.tasks)
  const deleteTask = useData(s => s.deleteTask)
  const updateTask = useData(s => s.updateTask)
  const navigate = useNavigate()
  const ctx = useContextMenu()
  const isMobileTaskCard = useMedia('(max-width: 768px)')
  const dndEnabled = useDndEnabled()
  const [renaming, setRenaming] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const tg = tags.filter(t => task.tags.includes(t.id))
  const subCount = allTasks.filter(t => t.parentId === task.id && !t.archived).length
  const subDone = allTasks.filter(t => t.parentId === task.id && t.status === 'done' && !t.archived).length
  const openMenu = (e: React.MouseEvent) => {
    if (isMobileTaskCard) {
      e.preventDefault()
      e.stopPropagation()
      return
    }
    ctx.open(e, buildTaskMenu(task, {
      projects, navigate,
      onRename: () => setRenaming(true),
      onCopyLink: () => { try { navigator.clipboard?.writeText(window.location.origin + '/?task=' + task.id) } catch {} },
      onOpenNewTab: () => window.open(window.location.origin + '/?task=' + task.id, '_blank'),
      onLocateCalendar: () => { useUI.getState().set({ calendarTarget: task.id }); navigate('/calendar') },
      onDelete: () => setConfirming(true),
      onAddSubtask: () => { useUI.getState().set({ selected: task.id, details: true }) },
    }))
  }
  return (
    <div
      draggable={dndEnabled}
      onDragStart={dndEnabled ? (e) => {
        e.dataTransfer.setData('text/plain', task.id)
        e.dataTransfer.effectAllowed = 'move'
        onDragStart(task.id)
      } : undefined}
      onDragEnd={dndEnabled ? onDragEnd : undefined}
      onContextMenu={isMobileTaskCard ? (e) => { e.preventDefault(); e.stopPropagation() } : openMenu}
      onClick={() => setUI({ selected: task.id, details: true })}
      className={cn('panel compact-card p-3 hover:shadow-sm transition', dndEnabled && 'cursor-grab active:cursor-grabbing')}
    >
      {ctx.node}
      {renaming && <NamePrompt title='Rename task' initial={task.title} label='Title' onClose={() => setRenaming(false)} onSave={(v) => updateTask(task.id, { title: v })} />}
      {confirming && <DeleteConfirm title='Delete task' name={task.title} onClose={() => setConfirming(false)} onConfirm={() => deleteTask(task.id)} />}
      <div className='flex items-start gap-2'>
        <div className='text-sm font-medium flex-1'>{task.title}</div>
        {subCount > 0 && (
          <span className='badge bg-black/5 dark:bg-white/5 text-[10px]' title={`${subDone}/${subCount} subtasks done`}>
            <ListChecks className='h-3 w-3' /> {subDone}/{subCount}
          </span>
        )}
        <button className='task-favorite-toggle' onClick={e => { e.stopPropagation(); toggleFav(task.id) }}>
          <Star className={cn('h-4 w-4', task.favorite ? 'fill-amber-400 text-amber-400' : 'text-zinc-400')} />
        </button>
      </div>
      {!!task.images?.length && (
        <div className='compact-hide mt-2 flex items-center gap-2 overflow-x-auto pb-1'>
          {task.images.slice(0, 2).map(img => (
            <img key={img.id} src={img.url} alt={img.name || task.title} className='h-14 w-14 rounded-xl object-cover border border-black/5 dark:border-white/10 shrink-0' />
          ))}
          {task.images.length > 2 && <span className='text-[11px] text-zinc-500'>+{task.images.length - 2} images</span>}
        </div>
      )}
      <div className='compact-row-meta mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-zinc-500'>
        {task.dueDate && <span className={cn('compact-meta compact-meta-date inline-flex items-center gap-1', overdue(task) && 'text-rose-600')}><CalendarDays className='h-3 w-3' />{format(parseISO(task.dueDate), 'MMM d')}</span>}
        {priorityBadge(task.priority, 'compact-meta compact-meta-priority')}
        {tg.slice(0, 2).map(t => <span key={t.id} className='badge bg-black/5 dark:bg-white/5 compact-meta compact-meta-tag'><span className='h-1.5 w-1.5 rounded-full' style={{ background: t.color }} />{t.name}</span>)}
      </div>
    </div>
  )
}

/* ============================================================
   useDragAutoScroll — ensures that when the user drags a kanban
   card near the top/bottom of a scrollable container, the container
   smoothly scrolls so columns hidden below/above the viewport become
   reachable. Listens at window-level on `dragover` so it works with
   the native HTML5 drag API (which is what KanbanTaskCard uses).
   ============================================================ */
function useDragAutoScroll(containerRef: React.RefObject<HTMLElement | null>, active: boolean) {
  useEffect(() => {
    if (!active) return
    const el = containerRef.current
    if (!el) return

    const EDGE = 90       // px from edge that triggers scroll
    const MAX_SPEED = 22  // px per frame at the very edge
    let raf = 0
    let velocity = 0

    const tick = () => {
      if (Math.abs(velocity) < 0.5) { raf = 0; return }
      el.scrollTop += velocity
      raf = requestAnimationFrame(tick)
    }

    const onDragOver = (e: DragEvent) => {
      const rect = el.getBoundingClientRect()
      const y = e.clientY
      // Only react when the pointer is over the container (or just outside it).
      if (e.clientX < rect.left - 40 || e.clientX > rect.right + 40) { velocity = 0; return }

      const fromTop = y - rect.top
      const fromBot = rect.bottom - y

      if (fromTop < EDGE && fromTop > -EDGE) {
        // ease: closer to edge → faster scroll
        const factor = Math.min(1, (EDGE - fromTop) / EDGE)
        velocity = -MAX_SPEED * factor
      } else if (fromBot < EDGE && fromBot > -EDGE) {
        const factor = Math.min(1, (EDGE - fromBot) / EDGE)
        velocity = MAX_SPEED * factor
      } else {
        velocity = 0
      }
      if (velocity !== 0 && !raf) raf = requestAnimationFrame(tick)
    }

    const stop = () => { velocity = 0; if (raf) { cancelAnimationFrame(raf); raf = 0 } }

    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragend', stop)
    window.addEventListener('drop', stop)
    return () => {
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragend', stop)
      window.removeEventListener('drop', stop)
      stop()
    }
  }, [containerRef, active])
}

function ProjectPage() {
  const { id } = useParams()
  const data = useData()
  const p = data.projects.find(x => x.id === id)
  const [previewMode, setPreviewMode] = useState<'list' | 'status'>('status')
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [overCol, setOverCol] = useState<Status | null>(null)

  // On mobile (< lg breakpoint) we render the Documentation panel as a
  // collapsible footer that's COLLAPSED BY DEFAULT, so it never covers the
  // task area. A small up/down chevron toggles its expanded state. On desktop
  // the panel keeps its existing side-by-side layout untouched.
  const isMobileLayout = useMedia('(max-width: 1023px)')
  const [docOpen, setDocOpen] = useState(false)
  // Reset to collapsed whenever the user switches viewport or project.
  useEffect(() => { setDocOpen(false) }, [isMobileLayout, id])

  // Auto-scroll the board container when dragging near top/bottom edges.
  // Without this, status columns hidden below the viewport were unreachable.
  const scrollRef = useRef<HTMLDivElement>(null)
  useDragAutoScroll(scrollRef, !!draggingId)

  if (!p) return <Navigate to='/projects' replace />

  const projectTasks = sortTasks(data.tasks.filter(t => t.projectId === p.id && taskMatches(t, data.filters, { allTasks: data.tasks })))
  const topLevelTasks = projectTasks.filter(t => !t.parentId)
  const kanbanGroups: { key: Status; label: string }[] = [
    { key: 'not_started', label: 'Not Started' },
    { key: 'planned', label: 'Planned' },
    { key: 'in_progress', label: 'In Progress' },
    { key: 'waiting', label: 'Waiting' },
    { key: 'blocked', label: 'Blocked' },
    { key: 'done', label: 'Done' },
  ]

  const handleDrop = (status: Status) => (e: React.DragEvent) => {
    e.preventDefault()
    const id = e.dataTransfer.getData('text/plain') || draggingId
    if (id) data.updateTask(id, { status })
    setDraggingId(null)
    setOverCol(null)
  }

  return (
    <div className={cn('project-page-layout grid lg:grid-cols-[minmax(0,1fr)_440px] h-full', isMobileLayout && 'is-mobile', isMobileLayout && docOpen && 'doc-open')}>
      <div ref={scrollRef} className='project-page-main border-b lg:border-b-0 lg:border-r overflow-y-auto p-4 sm:p-6 space-y-4 scrollbar-thin relative'>
        <div className='flex items-center gap-3'>
          <IconProject name={p.icon} color={p.color} />
          <div className='min-w-0'>
            <div className='text-lg font-semibold truncate'>{p.name}</div>
            <div className='text-xs text-zinc-500'>{p.description || 'Project workspace'}</div>
          </div>
          <div className='ml-auto flex items-center gap-2'>
            <div className='panel p-1 flex items-center gap-1'>
              <button
                title='Task list'
                aria-label='Task list'
                className={cn('h-9 w-9 rounded-xl inline-flex items-center justify-center transition', previewMode === 'list' ? 'bg-zinc-100 dark:bg-zinc-700 text-[hsl(var(--foreground))]' : 'text-zinc-500 hover:bg-[hsl(var(--accent))]')}
                onClick={() => setPreviewMode('list')}
              >
                <ListChecks className='h-4 w-4' />
              </button>
              <button
                title='Status board'
                aria-label='Status board'
                className={cn('h-9 w-9 rounded-xl inline-flex items-center justify-center transition', previewMode === 'status' ? 'bg-zinc-100 dark:bg-zinc-700 text-[hsl(var(--foreground))]' : 'text-zinc-500 hover:bg-[hsl(var(--accent))]')}
                onClick={() => setPreviewMode('status')}
              >
                <FolderKanban className='h-4 w-4' />
              </button>
            </div>
          </div>
        </div>

        {previewMode === 'list' ? (
          <TaskList tasks={projectTasks} showProject={false} empty='No tasks yet' emptyDesc='Tasks added to this project will appear here.' />
        ) : (
          <div className='space-y-4'>
            {kanbanGroups.map(g => {
              const items = topLevelTasks.filter(t => t.status === g.key)
              const isOver = overCol === g.key
              return (
                <div key={g.key}
                  onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (overCol !== g.key) setOverCol(g.key) }}
                  onDragLeave={() => setOverCol(s => s === g.key ? null : s)}
                  onDrop={handleDrop(g.key)}
                >
                  <div className='mb-2 flex items-center justify-between'>
                    <div className='text-[11px] uppercase tracking-wider text-zinc-500 flex items-center gap-2'>
                      <span className={cn('h-1.5 w-1.5 rounded-full', statusMeta[g.key].dot)} />
                      {g.label}
                      <span className='text-zinc-400'>{items.length}</span>
                    </div>
                  </div>
                  {items.length === 0
                    ? <div className={cn('kanban-empty', isOver && 'bg-indigo-500/10 border-indigo-500/40')}>
                        <div className='font-medium text-zinc-500'>{isOver ? 'Drop to move here' : 'No tasks yet'}</div>
                        <div className='mt-1 text-[11px]'>Drag a task here from another column.</div>
                      </div>
                    : <div className={cn('space-y-2 rounded-xl transition', isOver && 'bg-indigo-500/5 ring-2 ring-indigo-500/30 p-1')}>
                        {items.map(t => <KanbanTaskCard key={t.id} task={t} onDragStart={setDraggingId} onDragEnd={() => { setDraggingId(null); setOverCol(null) }} />)}
                      </div>
                  }
                </div>
              )
            })}
          </div>
        )}
      </div>
      <div
        className={cn(
          'project-doc-pane overflow-y-auto',
          isMobileLayout && 'project-doc-mobile-drawer',
          isMobileLayout && (docOpen ? 'is-open' : 'is-closed'),
        )}
        aria-hidden={isMobileLayout && !docOpen}
      >
        {isMobileLayout && (
          <button
            type='button'
            className='project-doc-mobile-drawer-toggle'
            onClick={() => setDocOpen(o => !o)}
            aria-expanded={docOpen}
            aria-controls={`project-doc-${p.id}`}
          >
            <BookOpen className='h-4 w-4 text-zinc-500' />
            <span className='project-doc-mobile-drawer-label'>Documentation</span>
            <span className='project-doc-mobile-drawer-hint'>{docOpen ? 'Tap to collapse' : 'Tap to expand'}</span>
            <ChevronRight className={cn('h-4 w-4 transition-transform project-doc-mobile-drawer-chevron', docOpen && 'is-open')} aria-hidden='true' />
          </button>
        )}
        <div id={`project-doc-${p.id}`} className='project-doc-mobile-drawer-body'>
          <ProjectDocumentation project={p} onChange={(doc) => data.updateProject(p.id, { documentation: doc })} />
        </div>
      </div>
    </div>
  )
}

/* ============================================================
   Project Documentation — Notion / Linear style editor with
   live Markdown preview, formatting toolbar, word counter,
   autosave indicator, and tabs (Write ↔ Preview). Works on
   both desktop and mobile.
   ============================================================ */
function renderInlineMd(text: string): React.ReactNode[] {
  // Minimal inline markdown: **bold**, *italic*, `code`, [text](url)
  const nodes: React.ReactNode[] = []
  let i = 0
  const re = /(\*\*([^*]+)\*\*)|(\*([^*]+)\*)|(`([^`]+)`)|(\[([^\]]+)\]\(([^)]+)\))/g
  let m: RegExpExecArray | null
  let key = 0
  while ((m = re.exec(text)) !== null) {
    if (m.index > i) nodes.push(text.slice(i, m.index))
    if (m[2] !== undefined) nodes.push(<strong key={key++}>{m[2]}</strong>)
    else if (m[4] !== undefined) nodes.push(<em key={key++}>{m[4]}</em>)
    else if (m[6] !== undefined) nodes.push(<code key={key++} className='doc-inline-code'>{m[6]}</code>)
    else if (m[8] !== undefined) nodes.push(<a key={key++} href={m[9]} target='_blank' rel='noreferrer' className='doc-inline-link'>{m[8]}</a>)
    i = m.index + m[0].length
  }
  if (i < text.length) nodes.push(text.slice(i))
  return nodes
}

function MarkdownPreview({ text }: { text: string }) {
  // A tiny, dependency-free Markdown renderer. Supports headings, lists,
  // task lists, blockquotes, code fences, hr, and inline bold/italic/code/link.
  const blocks = useMemo(() => {
    const lines = text.split('\n')
    const out: React.ReactNode[] = []
    let i = 0
    let key = 0
    while (i < lines.length) {
      const line = lines[i]
      // Code fence
      if (line.trim().startsWith('```')) {
        const buf: string[] = []
        i++
        while (i < lines.length && !lines[i].trim().startsWith('```')) { buf.push(lines[i]); i++ }
        i++ // closing fence
        out.push(<pre key={key++} className='doc-pre'><code>{buf.join('\n')}</code></pre>)
        continue
      }
      // Heading
      const h = /^(#{1,6})\s+(.*)$/.exec(line)
      if (h) {
        const lvl = h[1].length
        const txt = h[2]
        const cls = ['doc-h1', 'doc-h2', 'doc-h3', 'doc-h4', 'doc-h5', 'doc-h6'][lvl - 1]
        const HeadingTag = ('h' + lvl) as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'
        out.push(React.createElement(HeadingTag, { key: key++, className: cls }, renderInlineMd(txt)))
        i++; continue
      }
      // HR
      if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) { out.push(<hr key={key++} className='doc-hr' />); i++; continue }
      // Blockquote
      if (/^\s*>\s?/.test(line)) {
        const buf: string[] = []
        while (i < lines.length && /^\s*>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^\s*>\s?/, '')); i++ }
        out.push(<blockquote key={key++} className='doc-quote'>{buf.map((l, j) => <div key={j}>{renderInlineMd(l)}</div>)}</blockquote>)
        continue
      }
      // Task list / unordered list
      if (/^\s*[-*+]\s+/.test(line)) {
        const items: { txt: string; done?: boolean; check?: boolean }[] = []
        while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
          const raw = lines[i].replace(/^\s*[-*+]\s+/, '')
          const taskM = /^\[( |x|X)\]\s+(.*)$/.exec(raw)
          if (taskM) items.push({ txt: taskM[2], done: taskM[1].toLowerCase() === 'x', check: true })
          else items.push({ txt: raw })
          i++
        }
        out.push(
          <ul key={key++} className='doc-ul'>
            {items.map((it, j) => (
              <li key={j} className={cn('doc-li', it.check && 'doc-li-task', it.done && 'doc-li-done')}>
                {it.check ? <span className={cn('doc-check', it.done && 'is-done')}>{it.done && <CheckCircle2 className='h-3.5 w-3.5' />}</span> : <span className='doc-bullet' />}
                <span className='doc-li-text'>{renderInlineMd(it.txt)}</span>
              </li>
            ))}
          </ul>
        )
        continue
      }
      // Ordered list
      if (/^\s*\d+\.\s+/.test(line)) {
        const items: string[] = []
        while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*\d+\.\s+/, '')); i++ }
        out.push(<ol key={key++} className='doc-ol'>{items.map((it, j) => <li key={j} className='doc-li'>{renderInlineMd(it)}</li>)}</ol>)
        continue
      }
      // Blank line
      if (line.trim() === '') { i++; continue }
      // Paragraph (gather contiguous non-empty, non-block lines)
      const buf: string[] = [line]; i++
      while (i < lines.length && lines[i].trim() !== '' && !/^(#{1,6}\s|\s*>|\s*[-*+]\s|\s*\d+\.\s|```)/.test(lines[i])) {
        buf.push(lines[i]); i++
      }
      out.push(<p key={key++} className='doc-p'>{renderInlineMd(buf.join(' '))}</p>)
    }
    return out
  }, [text])
  if (!text.trim()) return <div className='doc-empty-state'><BookOpen className='h-6 w-6 text-zinc-400' /><div className='mt-2 text-sm font-medium'>Nothing to preview yet</div><div className='mt-1 text-xs text-zinc-500'>Switch to the Write tab and start documenting your project.</div></div>
  return <div className='doc-preview-body'>{blocks}</div>
}

function ProjectDocumentation({ project, onChange }: { project: Project; onChange: (v: string) => void }) {
  const [tab, setTab] = useState<'write' | 'preview'>('write')
  const [saved, setSaved] = useState(true)
  const textRef = useRef<HTMLTextAreaElement>(null)

  // Local value to render "unsaved" badge briefly before persisting.
  const value = project.documentation
  const wordCount = useMemo(() => value.trim() ? value.trim().split(/\s+/).length : 0, [value])
  const charCount = value.length
  const readMin = Math.max(1, Math.round(wordCount / 220))

  useEffect(() => { setSaved(false); const t = setTimeout(() => setSaved(true), 400); return () => clearTimeout(t) }, [value])

  /** Insert / wrap text at cursor. */
  const wrap = (before: string, after = before, placeholder = '') => {
    const el = textRef.current; if (!el) return
    const start = el.selectionStart ?? 0
    const end = el.selectionEnd ?? 0
    const selected = value.slice(start, end) || placeholder
    const next = value.slice(0, start) + before + selected + after + value.slice(end)
    onChange(next)
    requestAnimationFrame(() => {
      el.focus()
      const pos = start + before.length + selected.length
      el.setSelectionRange(pos, pos)
    })
  }
  const insertLine = (prefix: string, placeholder = '') => {
    const el = textRef.current; if (!el) return
    const start = el.selectionStart ?? 0
    const lineStart = value.lastIndexOf('\n', start - 1) + 1
    const isEmpty = value.slice(lineStart, start).trim() === ''
    const insertion = (isEmpty ? '' : '\n') + prefix + placeholder
    const next = value.slice(0, start) + insertion + value.slice(start)
    onChange(next)
    requestAnimationFrame(() => {
      el.focus()
      const pos = start + insertion.length
      el.setSelectionRange(pos, pos)
    })
  }

  return (
    <div className='project-doc'>
      <div className='project-doc-header'>
        <div className='project-doc-header-row'>
          <div className='flex items-center gap-2 min-w-0'>
            <BookOpen className='h-4 w-4 text-zinc-500 shrink-0' />
            <div className='text-sm font-semibold truncate'>Documentation</div>
          </div>
          <div className='ml-auto flex items-center gap-2'>
            <div className='project-doc-tabs' role='tablist' aria-label='Documentation view'>
              <button role='tab' aria-selected={tab === 'write'} className={cn('project-doc-tab', tab === 'write' && 'is-active')} onClick={() => setTab('write')}>
                <Pencil className='h-3.5 w-3.5' /> Write
              </button>
              <button role='tab' aria-selected={tab === 'preview'} className={cn('project-doc-tab', tab === 'preview' && 'is-active')} onClick={() => setTab('preview')}>
                <BookOpen className='h-3.5 w-3.5' /> Preview
              </button>
            </div>
          </div>
        </div>
        {tab === 'write' && (
          <div className='project-doc-toolbar' role='toolbar' aria-label='Formatting toolbar'>
            <button className='doc-tool' onClick={() => insertLine('# ', 'Heading 1')} title='Heading 1'><span className='doc-tool-h'>H1</span></button>
            <button className='doc-tool' onClick={() => insertLine('## ', 'Heading 2')} title='Heading 2'><span className='doc-tool-h'>H2</span></button>
            <button className='doc-tool' onClick={() => insertLine('### ', 'Heading 3')} title='Heading 3'><span className='doc-tool-h'>H3</span></button>
            <div className='doc-tool-sep' />
            <button className='doc-tool' onClick={() => wrap('**', '**', 'bold')} title='Bold (Ctrl+B)'><strong>B</strong></button>
            <button className='doc-tool' onClick={() => wrap('*', '*', 'italic')} title='Italic (Ctrl+I)'><em>I</em></button>
            <button className='doc-tool' onClick={() => wrap('`', '`', 'code')} title='Inline code'><code>{'<>'}</code></button>
            <div className='doc-tool-sep' />
            <button className='doc-tool' onClick={() => insertLine('- ', 'List item')} title='Bulleted list'>• List</button>
            <button className='doc-tool' onClick={() => insertLine('1. ', 'List item')} title='Numbered list'>1. List</button>
            <button className='doc-tool' onClick={() => insertLine('- [ ] ', 'Task')} title='Task list'><CheckCircle2 className='h-3.5 w-3.5' /></button>
            <div className='doc-tool-sep' />
            <button className='doc-tool' onClick={() => insertLine('> ', 'Quote')} title='Blockquote'>”</button>
            <button className='doc-tool' onClick={() => wrap('\n```\n', '\n```\n', 'code block')} title='Code block'>{'</>'}</button>
            <button className='doc-tool' onClick={() => insertLine('---\n', '')} title='Divider'>—</button>
            <button className='doc-tool' onClick={() => wrap('[', '](https://)', 'link text')} title='Link'><LinkIcon className='h-3.5 w-3.5' /></button>
          </div>
        )}
      </div>

      <div className='project-doc-body'>
        {tab === 'write' ? (
          <textarea
            ref={textRef}
            value={value}
            onChange={e => onChange(e.target.value)}
            onKeyDown={e => {
              if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') { e.preventDefault(); wrap('**', '**', 'bold') }
              if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'i') { e.preventDefault(); wrap('*', '*', 'italic') }
            }}
            placeholder={`# ${project.name}\n\nStart writing your project notes…\n\n## Goals\n- \n\n## Decisions\n- `}
            className='project-doc-textarea'
            spellCheck
          />
        ) : (
          <div className='project-doc-preview'><MarkdownPreview text={value} /></div>
        )}
      </div>

      <div className='project-doc-footer'>
        <div className='flex items-center gap-3 text-[11px] text-zinc-500'>
          <span>{wordCount} {wordCount === 1 ? 'word' : 'words'}</span>
          <span className='opacity-30'>•</span>
          <span>{charCount} characters</span>
          <span className='opacity-30'>•</span>
          <span>~{readMin} min read</span>
        </div>
        <div className={cn('doc-save-pill', saved ? 'is-saved' : 'is-saving')}>
          <span className='doc-save-dot' />
          {saved ? 'Saved' : 'Saving…'}
        </div>
      </div>
    </div>
  )
}

/* ============================================================
   MOBILE-ONLY calendar month grid with drag-and-drop
   ------------------------------------------------------------
   react-big-calendar's drag-and-drop addon (`withDragAndDrop`)
   drives the DESKTOP calendar and relies on mouse events, which
   do not translate to reliable cell-to-cell dragging on touch
   devices. To give phones the same "drag a task from one day to
   another" capability WITHOUT touching the desktop code path,
   we render this self-contained month grid instead — but ONLY
   on mobile AND only for the Month view. Everything else
   (all desktop views + mobile Day / Week / Agenda) keeps using
   the untouched <DragAndDropCalendar>.

   Drag interactions use @dnd-kit with a TouchSensor, exactly the
   same primitives the rest of the app already uses for mobile
   drag (task lists), so touch behavior stays consistent.
   ============================================================ */

// A single scheduled task chip that can be picked up and dragged.
function MobileMonthEventChip({ task, onOpen }: { task: Task; onOpen: () => void }) {
  const dndEnabled = useDndEnabled()
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `cal-event-${task.id}`,
    data: { taskId: task.id },
    disabled: !dndEnabled,
  })
  const hex = priorityMeta[task.priority].hex
  const isDark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
  return (
    <button
      ref={setNodeRef}
      {...(dndEnabled ? attributes : {})}
      {...(dndEnabled ? listeners : {})}
      type='button'
      // A tap (no drag) opens the task; the TouchSensor's activation delay
      // keeps taps and drags cleanly separated.
      onClick={onOpen}
      className={cn('cal-m-event', isDragging && 'cal-m-event-dragging')}
      style={{
        background: isDark ? hex + '33' : hex + '22',
        borderLeft: `3px solid ${hex}`,
      }}
      aria-label={`Task ${task.title}. Drag to move to another day.`}
    >
      <span className='cal-m-event-title'>{task.title}</span>
    </button>
  )
}

// A droppable day cell. Highlights while a chip hovers over it.
function MobileMonthDayCell({
  day, currentMonth, tasks, onOpenTask, onSelectDay,
}: {
  day: Date
  currentMonth: Date
  tasks: Task[]
  onOpenTask: (id: string) => void
  onSelectDay: (day: Date) => void
}) {
  const dayKey = format(day, 'yyyy-MM-dd')
  const { setNodeRef, isOver } = useDroppable({ id: `cal-day-${dayKey}`, data: { dayKey } })
  const inMonth = isSameMonth(day, currentMonth)
  const today = isToday(day)
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'cal-m-cell',
        !inMonth && 'cal-m-cell-muted',
        today && 'cal-m-cell-today',
        isOver && 'cal-m-cell-over',
      )}
      onClick={() => onSelectDay(day)}
    >
      <div className='cal-m-cell-date'>{format(day, 'd')}</div>
      <div className='cal-m-cell-events'>
        {tasks.map(t => (
          <MobileMonthEventChip key={t.id} task={t} onOpen={() => onOpenTask(t.id)} />
        ))}
      </div>
    </div>
  )
}

function MobileCalendarMonth({
  date, events, onMoveTask, onOpenTask, onSelectDay,
}: {
  date: Date
  events: (Event & { resource: Task })[]
  onMoveTask: (taskId: string, dayKey: string) => void
  onOpenTask: (id: string) => void
  onSelectDay: (day: Date) => void
}) {
  // Touch-first sensors. A short press-delay lets a plain tap through to the
  // chip's onClick (open task) while a held-then-moved gesture starts a drag.
  const sensors = useSensors(
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  )
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null)

  // Six-week grid (42 cells) that always starts on the week containing the
  // 1st and covers the whole month — mirrors react-big-calendar's month layout.
  const gridDays = useMemo(() => {
    const first = startOfWeek(startOfMonth(date), { weekStartsOn: 0 })
    const last = endOfWeek(endOfMonth(date), { weekStartsOn: 0 })
    return eachDayOfInterval({ start: first, end: last })
  }, [date])

  // Bucket scheduled tasks by their day so each cell can render its own chips.
  const tasksByDay = useMemo(() => {
    const map = new Map<string, Task[]>()
    for (const e of events) {
      const key = format(e.start as Date, 'yyyy-MM-dd')
      const arr = map.get(key) || []
      arr.push(e.resource)
      map.set(key, arr)
    }
    for (const arr of map.values()) sortTasks(arr)
    return map
  }, [events])

  const activeTask: Task | null = activeTaskId ? (events.find(e => e.resource.id === activeTaskId)?.resource ?? null) : null
  const weekDayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={(e: DragStartEvent) => setActiveTaskId((e.active.data.current as any)?.taskId ?? null)}
      onDragEnd={(e: DragEndEvent) => {
        const taskId = (e.active.data.current as any)?.taskId as string | undefined
        const dayKey = (e.over?.data.current as any)?.dayKey as string | undefined
        if (taskId && dayKey) onMoveTask(taskId, dayKey)
        setActiveTaskId(null)
      }}
      onDragCancel={() => setActiveTaskId(null)}
    >
      <div className='cal-m-grid'>
        <div className='cal-m-weekdays'>
          {weekDayLabels.map(l => <div key={l} className='cal-m-weekday'>{l}</div>)}
        </div>
        <div className='cal-m-cells'>
          {gridDays.map(day => (
            <MobileMonthDayCell
              key={day.toISOString()}
              day={day}
              currentMonth={date}
              tasks={tasksByDay.get(format(day, 'yyyy-MM-dd')) || []}
              onOpenTask={onOpenTask}
              onSelectDay={onSelectDay}
            />
          ))}
        </div>
      </div>
      <DragOverlay dropAnimation={null}>
        {activeTask && (
          <div
            className='cal-m-event cal-m-event-overlay'
            style={{
              borderLeft: `3px solid ${priorityMeta[activeTask.priority].hex}`,
              background: (typeof document !== 'undefined' && document.documentElement.classList.contains('dark'))
                ? priorityMeta[activeTask.priority].hex + '55'
                : priorityMeta[activeTask.priority].hex + '33',
            }}
          >
            <span className='cal-m-event-title'>{activeTask.title}</span>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  )
}

/* ============================================================
   MOBILE-ONLY Week + Day time grids with drag-and-drop (dnd-kit)
   ------------------------------------------------------------
   react-big-calendar's DnD addon is mouse-driven and does not work
   reliably on touch for the Week/Day (time-slot) views. These
   self-contained grids give phones real touch drag-and-drop:
     • Week: drag a task chip between day columns (day changes).
     • Day:  drag a task chip between hour rows (time changes).
   They mirror MobileCalendarMonth and reuse the same TouchSensor
   primitives so behavior stays consistent across the app. Desktop
   is completely untouched.
   ============================================================ */

// Hours rendered in the mobile Day/Week time grids (7:00 → 21:00).
const MOBILE_DAY_START_HOUR = 7
const MOBILE_DAY_END_HOUR = 21
const mobileHours = Array.from(
  { length: MOBILE_DAY_END_HOUR - MOBILE_DAY_START_HOUR + 1 },
  (_, i) => MOBILE_DAY_START_HOUR + i,
)

function mobileEventChipStyle(task: Task) {
  const hex = priorityMeta[task.priority].hex
  const isDark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
  return { background: isDark ? hex + '33' : hex + '22', borderLeft: `3px solid ${hex}` }
}

// A draggable task chip shared by the mobile Week / Day grids.
function MobileTimeEventChip({ task, onOpen }: { task: Task; onOpen: () => void }) {
  const dndEnabled = useDndEnabled()
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `cal-time-event-${task.id}`,
    data: { taskId: task.id },
    disabled: !dndEnabled,
  })
  return (
    <button
      ref={setNodeRef}
      {...(dndEnabled ? attributes : {})}
      {...(dndEnabled ? listeners : {})}
      type='button'
      onClick={onOpen}
      className={cn('cal-m-event', isDragging && 'cal-m-event-dragging')}
      style={mobileEventChipStyle(task)}
      aria-label={`Task ${task.title}. Drag to reschedule.`}
    >
      <span className='cal-m-event-title'>{task.title}</span>
      {task.time && <span className='cal-m-event-time'>{task.time}</span>}
    </button>
  )
}

// A droppable cell (one day column × one hour row) for the Week/Day grid.
function MobileTimeDropCell({
  dropId, data, tasks, onOpenTask, onSelectSlot,
}: {
  dropId: string
  data: Record<string, unknown>
  tasks: Task[]
  onOpenTask: (id: string) => void
  onSelectSlot: () => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: dropId, data })
  return (
    <div
      ref={setNodeRef}
      className={cn('cal-m-slot', isOver && 'cal-m-slot-over')}
      onClick={onSelectSlot}
    >
      {tasks.map(t => (
        <MobileTimeEventChip key={t.id} task={t} onOpen={() => onOpenTask(t.id)} />
      ))}
    </div>
  )
}

// Shared DnD wrapper + overlay for the Week / Day mobile grids.
function MobileTimeGrid({
  children, events, onDrop, onSetActive, activeTaskId,
}: {
  children: React.ReactNode
  events: (Event & { resource: Task })[]
  onDrop: (taskId: string, over: Record<string, unknown>) => void
  onSetActive: (id: string | null) => void
  activeTaskId: string | null
}) {
  const sensors = useSensors(
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  )
  const activeTask: Task | null = activeTaskId
    ? (events.find(e => e.resource.id === activeTaskId)?.resource ?? null)
    : null
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={(e: DragStartEvent) => onSetActive((e.active.data.current as any)?.taskId ?? null)}
      onDragEnd={(e: DragEndEvent) => {
        const taskId = (e.active.data.current as any)?.taskId as string | undefined
        const over = e.over?.data.current as Record<string, unknown> | undefined
        if (taskId && over) onDrop(taskId, over)
        onSetActive(null)
      }}
      onDragCancel={() => onSetActive(null)}
    >
      {children}
      <DragOverlay dropAnimation={null}>
        {activeTask && (
          <div className='cal-m-event cal-m-event-overlay' style={mobileEventChipStyle(activeTask)}>
            <span className='cal-m-event-title'>{activeTask.title}</span>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  )
}

function MobileCalendarWeek({
  date, events, onMoveTask, onOpenTask, onSelectSlot,
}: {
  date: Date
  events: (Event & { resource: Task })[]
  onMoveTask: (taskId: string, dayKey: string, hour: number) => void
  onOpenTask: (id: string) => void
  onSelectSlot: (day: Date, hour: number) => void
}) {
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null)
  const weekDays = useMemo(() => {
    const first = startOfWeek(date, { weekStartsOn: 1 })
    return eachDayOfInterval({ start: first, end: endOfWeek(date, { weekStartsOn: 1 }) })
  }, [date])

  // Bucket events by "day|hour" so each cell knows what to render.
  const byCell = useMemo(() => {
    const map = new Map<string, Task[]>()
    for (const e of events) {
      const start = e.start as Date
      const key = `${format(start, 'yyyy-MM-dd')}|${start.getHours()}`
      const arr = map.get(key) || []
      arr.push(e.resource)
      map.set(key, arr)
    }
    for (const arr of map.values()) sortTasks(arr)
    return map
  }, [events])

  return (
    <MobileTimeGrid
      events={events}
      activeTaskId={activeTaskId}
      onSetActive={setActiveTaskId}
      onDrop={(taskId, over) => {
        const dayKey = over.dayKey as string | undefined
        const hour = over.hour as number | undefined
        if (dayKey != null && hour != null) onMoveTask(taskId, dayKey, hour)
      }}
    >
      <div className='cal-m-time-grid'>
        <div className='cal-m-week-head'>
          <div className='cal-m-time-gutter-head' />
          {weekDays.map(d => (
            <div key={d.toISOString()} className={cn('cal-m-week-day-head', isToday(d) && 'cal-m-week-day-today')}>
              <span className='cal-m-week-day-name'>{format(d, 'EEE')}</span>
              <span className='cal-m-week-day-num'>{format(d, 'd')}</span>
            </div>
          ))}
        </div>
        <div className='cal-m-time-body'>
          {mobileHours.map(hour => (
            <div key={hour} className='cal-m-time-row'>
              <div className='cal-m-time-gutter'>{format(new Date(2000, 0, 1, hour), 'ha')}</div>
              {weekDays.map(d => {
                const dayKey = format(d, 'yyyy-MM-dd')
                return (
                  <MobileTimeDropCell
                    key={dayKey + hour}
                    dropId={`cal-week-${dayKey}-${hour}`}
                    data={{ dayKey, hour }}
                    tasks={byCell.get(`${dayKey}|${hour}`) || []}
                    onOpenTask={onOpenTask}
                    onSelectSlot={() => onSelectSlot(d, hour)}
                  />
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </MobileTimeGrid>
  )
}

function MobileCalendarDay({
  date, events, onMoveTask, onOpenTask, onSelectSlot,
}: {
  date: Date
  events: (Event & { resource: Task })[]
  onMoveTask: (taskId: string, hour: number) => void
  onOpenTask: (id: string) => void
  onSelectSlot: (hour: number) => void
}) {
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null)
  const dayKey = format(date, 'yyyy-MM-dd')
  const dayEvents = useMemo(
    () => events.filter(e => format(e.start as Date, 'yyyy-MM-dd') === dayKey),
    [events, dayKey],
  )
  const byHour = useMemo(() => {
    const map = new Map<number, Task[]>()
    for (const e of dayEvents) {
      const h = (e.start as Date).getHours()
      const arr = map.get(h) || []
      arr.push(e.resource)
      map.set(h, arr)
    }
    for (const arr of map.values()) sortTasks(arr)
    return map
  }, [dayEvents])

  return (
    <MobileTimeGrid
      events={dayEvents}
      activeTaskId={activeTaskId}
      onSetActive={setActiveTaskId}
      onDrop={(taskId, over) => {
        const hour = over.hour as number | undefined
        if (hour != null) onMoveTask(taskId, hour)
      }}
    >
      <div className='cal-m-time-grid cal-m-day-grid'>
        <div className='cal-m-time-body'>
          {mobileHours.map(hour => (
            <div key={hour} className='cal-m-time-row cal-m-day-row'>
              <div className='cal-m-time-gutter'>{format(new Date(2000, 0, 1, hour), 'ha')}</div>
              <MobileTimeDropCell
                dropId={`cal-day-${dayKey}-${hour}`}
                data={{ dayKey, hour }}
                tasks={byHour.get(hour) || []}
                onOpenTask={onOpenTask}
                onSelectSlot={() => onSelectSlot(hour)}
              />
            </div>
          ))}
        </div>
      </div>
    </MobileTimeGrid>
  )
}

function CalendarPage() {
  const tasks = useData(s => s.tasks)
  const addTask = useData(s => s.addTask)
  const updateTask = useData(s => s.updateTask)
  const toggleDone = useData(s => s.toggleDone)
  const setUI = useUI(s => s.set)
  const calendarTarget = useUI(s => s.calendarTarget)
  const sidePanelEnabled = useUI(s => s.calendarSidePanel)
  const dndEnabled = useDndEnabled()
  const isMobile = useMedia('(max-width: 768px)')
  // Desktop-only fixed panel: only render when enabled in App Settings AND on
  // a desktop-width viewport (never on mobile, per requirements).
  const showSidePanel = sidePanelEnabled && !isMobile
  // Default to day view on mobile; desktop stays on week. (Week IS available on
  // mobile now — we render a clean horizontally-scrollable week so the user
  // can opt in to it explicitly via the view switcher.)
  const [view, setView] = useState<View>(isMobile ? Views.DAY : Views.WEEK)
  const [date, setDate] = useState(new Date())
  // Tapping a calendar slot captures its start/end/view here, then opens a small
  // chooser popup that lets the user create a New Task or attach an Existing one.
  const [slotDraft, setSlotDraft] = useState<null | { start: Date; end: Date; view: View }>(null)
  // Which step of the slot flow is showing: the New/Existing chooser, the
  // new-task name prompt, or the searchable existing-task picker.
  const [slotStep, setSlotStep] = useState<'choose' | 'new' | 'existing'>('choose')
  // Desktop-only: the task currently being dragged out of the side panel onto
  // the calendar. react-big-calendar's DnD addon reads this via
  // `dragFromOutsideItem` to preview the drop, and `onDropFromOutside` uses it
  // to schedule the task at the exact dropped slot. Held in a ref (as well as
  // state) so the calendar's synchronous drop handler always sees the latest.
  const [outsideDragId, setOutsideDragId] = useState<string | null>(null)
  const outsideDragIdRef = useRef<string | null>(null)
  const setOutsideDrag = (id: string | null) => { outsideDragIdRef.current = id; setOutsideDragId(id) }

  const events = useMemo(() => tasks.filter(t => t.dueDate && !t.archived).map(t => {
    const [y, m, dv] = t.dueDate!.split('-').map(Number)
    let start = new Date(y, m - 1, dv, 9, 0)
    if (t.time) { const [h, mm] = t.time.split(':').map(Number); start = new Date(y, m - 1, dv, h, mm) }
    const end = new Date(start.getTime() + Math.max(t.estimatedMinutes || 60, 30) * 60000)
    return { title: t.title, start, end, allDay: !t.time, resource: t } as Event & { resource: Task }
  }), [tasks])

  const taskMap = useMemo(() => new Map(tasks.map(t => [t.id, t])), [tasks])

  useEffect(() => {
    if (!calendarTarget) return
    const task = taskMap.get(calendarTarget)
    setUI({ calendarTarget: null })
    if (!task || !task.dueDate) return
    const focusDate = task.time ? parse(`${task.dueDate} ${task.time}`, 'yyyy-MM-dd HH:mm', new Date()) : parse(task.dueDate, 'yyyy-MM-dd', new Date())
    setDate(focusDate)
    setView(task.time ? Views.WEEK : Views.MONTH)
    setTimeout(() => setUI({ selected: task.id, details: true }), 80)
  }, [calendarTarget, taskMap, setUI])

  const syncTaskToSlot = (task: Task, start: Date, end: Date, allDay?: boolean) => {
    // For an all-day drop we keep the task's own estimated duration (an all-day
    // slot spans the whole day, so the raw start→end diff isn't meaningful).
    const minutes = allDay
      ? (task.estimatedMinutes || 60)
      : Math.max(30, Math.round((end.getTime() - start.getTime()) / 60000) || task.estimatedMinutes || 60)
    updateTask(task.id, {
      dueDate: format(start, 'yyyy-MM-dd'),
      time: allDay ? undefined : format(start, 'HH:mm'),
      estimatedMinutes: minutes,
      status: task.status === 'done' ? 'planned' : task.status,
    })
  }

  // Mobile month-view drag: reschedule a task to a new day cell. Only the date
  // changes — the task's existing time (if any) and duration are preserved,
  // matching how dropping across day columns behaves conceptually.
  const moveTaskToDay = (taskId: string, dayKey: string) => {
    const task = taskMap.get(taskId)
    if (!task || task.dueDate === dayKey) return
    updateTask(task.id, {
      dueDate: dayKey,
      status: task.status === 'done' ? 'planned' : task.status,
    })
  }

  // Mobile week-view drag: move a task to a specific day column AND hour row.
  const moveTaskToDayHour = (taskId: string, dayKey: string, hour: number) => {
    const task = taskMap.get(taskId)
    if (!task) return
    const time = `${String(hour).padStart(2, '0')}:00`
    if (task.dueDate === dayKey && task.time === time) return
    updateTask(task.id, {
      dueDate: dayKey,
      time,
      status: task.status === 'done' ? 'planned' : task.status,
    })
  }

  // Mobile day-view drag: keep the day, change only the hour.
  const moveTaskToHour = (taskId: string, hour: number) => {
    const task = taskMap.get(taskId)
    if (!task) return
    const time = `${String(hour).padStart(2, '0')}:00`
    if (task.time === time) return
    updateTask(task.id, {
      time,
      status: task.status === 'done' ? 'planned' : task.status,
    })
  }

  // Attach an EXISTING task to the slot the user tapped (from the picker).
  const attachExistingTask = (taskId: string) => {
    if (!slotDraft) return
    const task = taskMap.get(taskId)
    if (!task) { setSlotDraft(null); return }
    const s = slotDraft
    updateTask(task.id, {
      dueDate: format(s.start, 'yyyy-MM-dd'),
      time: s.view === Views.MONTH ? undefined : format(s.start, 'HH:mm'),
      status: task.status === 'done' ? 'planned' : task.status,
    })
    setSlotDraft(null)
    setUI({ selected: task.id, details: true })
  }

  // Open the New/Existing chooser for a tapped slot.
  const openSlotChooser = (start: Date, end: Date, v: View) => {
    setSlotStep('choose')
    setSlotDraft({ start, end, view: v })
  }

  // Desktop fixed side-panel: attach an existing task to the currently viewed
  // date. Month view schedules an all-day task; Day/Week keep the task's own
  // time (or default 09:00) so the pick lands sensibly on the visible range.
  const attachExistingToView = (taskId: string) => {
    const task = taskMap.get(taskId)
    if (!task) return
    const dueDate = format(date, 'yyyy-MM-dd')
    const time = view === Views.MONTH ? task.time : (task.time || '09:00')
    updateTask(task.id, {
      dueDate,
      time,
      status: task.status === 'done' ? 'planned' : task.status,
    })
    setUI({ selected: task.id, details: true })
  }

  // Desktop drag-and-drop: a task dragged out of the side panel was dropped on
  // a specific calendar slot. Schedule it to that exact date/time. Month view
  // has no time component, so drop there becomes an all-day schedule.
  const handleDropFromOutside = ({ start, allDay }: { start: Date; end?: Date; allDay?: boolean }) => {
    const id = outsideDragIdRef.current
    setOutsideDrag(null)
    if (!id) return
    const task = taskMap.get(id)
    if (!task) return
    const monthLike = view === Views.MONTH || allDay
    updateTask(task.id, {
      dueDate: format(start, 'yyyy-MM-dd'),
      time: monthLike ? task.time : format(start, 'HH:mm'),
      status: task.status === 'done' ? 'planned' : task.status,
    })
    // NOTE: Dragging a task from the fixed side panel onto the calendar must
    // NEVER open the task details panel — only schedule it. (Clicking a task in
    // the panel still opens details via attachExistingToView / attachExistingTask.)
  }

  // react-big-calendar asks for a lightweight "event" to preview while dragging
  // a task in from outside. We synthesize one from the dragged task so the
  // ghost has a sensible title and duration.
  const dragFromOutsideItem = () => {
    const id = outsideDragIdRef.current
    if (!id) return null
    const task = taskMap.get(id)
    if (!task) return null
    // Return a fully-formed calendar event (same shape as `events` above),
    // including `resource: task`. react-big-calendar renders this preview via
    // the same TimeGridEvent path as real events — which calls eventPropGetter
    // and reads `resource`. Omitting `resource` made the preview crash the view.
    return {
      title: task.title,
      start: new Date(),
      end: new Date(Date.now() + Math.max(task.estimatedMinutes || 60, 30) * 60000),
      resource: task,
    } as Event & { resource: Task }
  }

  // Desktop calendar event renderer. Requirements:
  //  • A NORMAL click (no meaningful pointer movement) opens the task details.
  //  • DRAGGING an event (to reschedule) must NEVER open details.
  //  • Clicking the status checkbox toggles the task and must NEVER open details.
  // We can't rely on react-big-calendar's onSelectEvent because it also fires at
  // the end of a drag gesture, so instead we detect a click-vs-drag ourselves by
  // measuring pointer travel between pointerdown and pointerup.
  // Defined once (stable identity) so react-big-calendar doesn't remount every
  // event chip on each CalendarPage render. `toggleDone` / `setUI` are stable
  // zustand actions, so they don't need to be dependencies.
  const CalendarEvent = useMemo(() => {
    const DRAG_THRESHOLD = 5 // px — pointer travel beyond this counts as a drag
    return function CalendarEvent({ event }: { event: Event & { resource?: Task } }) {
      const task = event.resource
      const downRef = useRef<{ x: number; y: number } | null>(null)
      if (!task) return <span className='calendar-event-title'>{event.title}</span>
      return (
        <div className='calendar-event-content flex items-center gap-1.5 min-w-0'>
          {/* Status checkbox — toggling never bubbles up to open the details
              panel and never starts a calendar drag (stops pointerdown). */}
          <span
            className='calendar-event-check inline-flex shrink-0'
            onPointerDown={e => e.stopPropagation()}
            onMouseDown={e => e.stopPropagation()}
            onClick={e => { e.stopPropagation(); e.preventDefault(); toggleDone(task.id) }}
          >
            <StatusDot status={task.status} onClick={() => {}} />
          </span>
          <span
            className={cn('calendar-event-title truncate', task.status === 'done' && 'line-through opacity-60')}
            onPointerDown={e => { downRef.current = { x: e.clientX, y: e.clientY } }}
            onClick={e => {
              const down = downRef.current
              downRef.current = null
              // Only a genuine click (tiny/zero pointer travel) opens details.
              // A drag moves the pointer beyond the threshold → do nothing so
              // the reschedule drop is the only outcome.
              if (down) {
                const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y)
                if (moved > DRAG_THRESHOLD) return
              }
              e.stopPropagation()
              setUI({ selected: task.id, details: true })
            }}
          >
            {event.title}
          </span>
        </div>
      )
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // View choices in the order users naturally read them (Day → Week → Month →
  // Agenda). Mobile gets the SAME set as desktop — the previous build dropped
  // Week entirely on mobile, which is what made it feel broken. Mobile-only
  // CSS down below makes Week + Month + Agenda actually usable on a phone.
  const allViews: View[] = [Views.DAY, Views.WEEK, Views.MONTH, Views.AGENDA]
  const viewChoices = allViews

  return (
    <div className={cn('calendar-page p-4 sm:p-6 h-full flex gap-4', showSidePanel ? 'calendar-page-with-panel' : 'flex-col')}>
      <div className='min-h-0 flex-1 flex flex-col gap-3 sm:gap-4'>
        <div className='calendar-toolbar flex items-center gap-1.5 sm:gap-2 flex-wrap'>
          <button className='btn btn-secondary !h-9 !px-3 text-xs sm:text-sm' onClick={() => setDate(new Date())}>Today</button>
          <button className='btn btn-ghost !h-9 !px-2' onClick={() => setDate(addDays(date, view === Views.DAY ? -1 : view === Views.WEEK ? -7 : -30))} aria-label='Previous'><ChevronLeft className='h-4 w-4' /></button>
          <button className='btn btn-ghost !h-9 !px-2' onClick={() => setDate(addDays(date, view === Views.DAY ? 1 : view === Views.WEEK ? 7 : 30))} aria-label='Next'><ChevronRight className='h-4 w-4' /></button>
          <div className='text-xs sm:text-sm font-semibold truncate min-w-0 flex-1 sm:flex-initial'>
            {format(date, view === Views.MONTH ? 'MMMM yyyy' : isMobile ? 'EEE, MMM d' : 'MMM d, yyyy')}
          </div>
          {/* Mobile: compact view-switcher as a select to save horizontal space */}
          {isMobile ? (
            <select
              className='input !h-9 !w-auto text-xs ml-auto'
              value={view as string}
              onChange={e => setView(e.target.value as View)}
              aria-label='Calendar view'
            >
              {viewChoices.map(v => (
                <option key={v} value={v as string}>{v === Views.DAY ? 'Day' : (v as string).charAt(0).toUpperCase() + (v as string).slice(1)}</option>
              ))}
            </select>
          ) : (
            <div className='ml-auto flex gap-1 flex-wrap'>
              {viewChoices.map(v => (
                <button key={v} className={cn('btn btn-secondary capitalize !h-9', view === v && 'bg-zinc-200 dark:bg-zinc-700')} onClick={() => setView(v)}>
                  {v === Views.DAY ? 'Day' : v}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className={cn('calendar-surface min-h-0 flex-1', isMobile && 'calendar-surface-mobile', isMobile && `cal-view-${view}`, outsideDragId && 'calendar-drop-active')}>
          {isMobile && view === Views.MONTH ? (
            /* Mobile-only month grid with touch drag-and-drop between day cells.
               Desktop and other mobile views are untouched below. */
            <MobileCalendarMonth
              date={date}
              events={events}
              onMoveTask={moveTaskToDay}
              onOpenTask={(id) => setUI({ selected: id, details: true })}
              onSelectDay={(day) => openSlotChooser(day, day, Views.MONTH)}
            />
          ) : isMobile && view === Views.WEEK ? (
            /* Mobile-only week time-grid with touch drag-and-drop between day
               columns and hour rows (both directions). */
            <MobileCalendarWeek
              date={date}
              events={events}
              onMoveTask={moveTaskToDayHour}
              onOpenTask={(id) => setUI({ selected: id, details: true })}
              onSelectSlot={(day, hour) => {
                const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, 0)
                openSlotChooser(start, new Date(start.getTime() + 60 * 60000), Views.WEEK)
              }}
            />
          ) : isMobile && view === Views.DAY ? (
            /* Mobile-only day time-grid with touch drag-and-drop between hour rows. */
            <MobileCalendarDay
              date={date}
              events={events}
              onMoveTask={moveTaskToHour}
              onOpenTask={(id) => setUI({ selected: id, details: true })}
              onSelectSlot={(hour) => {
                const start = new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, 0)
                openSlotChooser(start, new Date(start.getTime() + 60 * 60000), Views.DAY)
              }}
            />
          ) : (
          <DragAndDropCalendar
            localizer={localizer}
            events={events}
            startAccessor='start'
            endAccessor='end'
            view={view}
            onView={setView}
            date={date}
            onNavigate={setDate}
            views={['day', 'week', 'month', 'agenda']}
            selectable
            resizable={dndEnabled}
            draggableAccessor={() => dndEnabled}
            resizableAccessor={() => dndEnabled}
            popup
            onEventDrop={dndEnabled ? ({ event, start, end, allDay, isAllDay }: any) => {
              const task = (event as Event & { resource: Task }).resource
              // react-big-calendar reports a drop onto the all-day header via
              // `isAllDay` (the timed-cell drop handler omits it entirely). Treat
              // either flag as "make this an all-day task": clear its time while
              // keeping the same date.
              if (task) syncTaskToSlot(task, start, end, Boolean(allDay || isAllDay))
            } : undefined}
            onEventResize={dndEnabled ? ({ event, start, end }: any) => {
              const task = (event as Event & { resource: Task }).resource
              if (task) syncTaskToSlot(task, start, end, false)
            } : undefined}
            onDropFromOutside={showSidePanel && dndEnabled ? handleDropFromOutside : undefined}
            dragFromOutsideItem={showSidePanel && dndEnabled ? dragFromOutsideItem : undefined}
            style={{ height: '100%' }}
            components={{ event: CalendarEvent }}
            // Click-to-open is handled inside CalendarEvent so we can tell a real
            // click apart from the end of a drag (and ignore checkbox clicks).
            // We intentionally do NOT open details from onSelectEvent because RBC
            // fires it at the end of a drag too, which would re-open details after
            // every reschedule.
            onSelectSlot={(slot: { start: Date; end: Date; action?: string }) => {
              // Open the New/Existing chooser popup for the tapped slot.
              openSlotChooser(slot.start, slot.end, view)
            }}
            eventPropGetter={(e: Event & { resource?: Task }) => {
              // `resource` can be missing for transient events (e.g. the drag
              // preview react-big-calendar synthesizes while dropping a task in
              // from the side panel). Fall back to a safe priority so this
              // getter never throws and takes down the whole calendar view.
              const task = e.resource as Task | undefined
              const meta = task ? priorityMeta[task.priority] : undefined
              const hex = (meta ?? priorityMeta.medium).hex
              const isDark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
              return {
                style: {
                  background: isDark ? hex + '33' : hex + '22',
                  borderLeft: `3px solid ${hex}`,
                  color: 'inherit',
                }
              }
            }}
          />
          )}
        </div>
      </div>
      {/* Desktop-only fixed panel: reuses the exact "Select existing task"
          list. Picking a task schedules it onto the currently viewed date.
          Toggle-able from App Settings → "Calendar side panel". */}
      {showSidePanel && (
        <aside className='calendar-side-panel panel p-0 flex flex-col'>
          <div className='p-4 border-b flex items-center gap-2'>
            <div className='flex-1 min-w-0'>
              <div className='text-sm font-semibold flex items-center gap-2'>
                <ListChecks className='h-4 w-4' /> Select existing task
              </div>
              <div className='mt-0.5 text-xs text-zinc-500'>
                Schedule to {format(date, view === Views.MONTH ? 'MMM yyyy' : 'EEE, MMM d')}
              </div>
            </div>
            <button
              className='btn btn-ghost !h-8 !px-2'
              onClick={() => setUI({ calendarSidePanel: false })}
              aria-label='Hide panel'
              title='Hide panel (re-enable in Settings)'
            >
              <X className='h-4 w-4' />
            </button>
          </div>
          <ExistingTaskList
            tasks={tasks}
            onPick={attachExistingToView}
            draggable={dndEnabled}
            onDragTask={setOutsideDrag}
            onDragTaskEnd={() => setOutsideDrag(null)}
          />
        </aside>
      )}
      {/* Slot chooser: after tapping a calendar slot, pick New or Existing task. */}
      {slotDraft && slotStep === 'choose' && (
        <SlotChoicePrompt
          slot={slotDraft}
          onClose={() => setSlotDraft(null)}
          onNew={() => setSlotStep('new')}
          onExisting={() => setSlotStep('existing')}
        />
      )}

      {/* New task: themed name prompt that schedules into the tapped slot. */}
      {slotDraft && slotStep === 'new' && (
        <NamePrompt
          title='New task'
          initial=''
          label={`Task title · ${format(slotDraft.start, slotDraft.view === Views.MONTH ? 'MMM d' : 'MMM d, HH:mm')}`}
          onClose={() => setSlotDraft(null)}
          onSave={(v) => {
            const s = slotDraft
            addTask({
              title: v,
              dueDate: format(s.start, 'yyyy-MM-dd'),
              time: s.view === Views.MONTH ? undefined : format(s.start, 'HH:mm'),
              estimatedMinutes: Math.max(30, Math.round((s.end.getTime() - s.start.getTime()) / 60000) || 60),
            })
          }}
        />
      )}

      {/* Existing task: searchable, newest-first picker that schedules the pick. */}
      {slotDraft && slotStep === 'existing' && (
        <ExistingTaskPicker
          slot={slotDraft}
          tasks={tasks}
          onClose={() => setSlotDraft(null)}
          onBack={() => setSlotStep('choose')}
          onPick={attachExistingTask}
        />
      )}
    </div>
  )
}

/* ============================================================
   Calendar slot flow — choose New vs Existing, then act.
   Rendered when a calendar cell/slot is tapped.
   ============================================================ */
function SlotChoicePrompt({
  slot, onClose, onNew, onExisting,
}: {
  slot: { start: Date; end: Date; view: View }
  onClose: () => void
  onNew: () => void
  onExisting: () => void
}) {
  const when = slot.view === Views.MONTH
    ? format(slot.start, 'EEEE, MMM d')
    : format(slot.start, 'EEEE, MMM d · HH:mm')
  return createPortal(
    <>
      <div className='popup-overlay' onClick={onClose} />
      <div className='popup-shell panel p-0' style={{ maxWidth: 420 }}>
        <div className='p-4 border-b'>
          <div className='text-sm font-semibold'>Add to calendar</div>
          <div className='mt-0.5 text-xs text-zinc-500'>{when}</div>
        </div>
        <div className='p-4 grid grid-cols-1 gap-2'>
          <button className='slot-choice' onClick={onNew}>
            <span className='slot-choice-icon'><Plus className='h-4 w-4' /></span>
            <span className='min-w-0'>
              <span className='slot-choice-title'>New Task</span>
              <span className='slot-choice-desc'>Create a brand-new task on this slot.</span>
            </span>
          </button>
          <button className='slot-choice' onClick={onExisting}>
            <span className='slot-choice-icon'><ListChecks className='h-4 w-4' /></span>
            <span className='min-w-0'>
              <span className='slot-choice-title'>Existing Task</span>
              <span className='slot-choice-desc'>Attach one of your existing tasks here.</span>
            </span>
          </button>
        </div>
        <div className='flex items-center justify-end gap-2 px-4 py-3 border-t bg-zinc-50 dark:bg-zinc-900'>
          <button className='btn btn-secondary' onClick={onClose}>Cancel</button>
        </div>
      </div>
    </>,
    document.body,
  )
}

/* Shared searchable task list used by BOTH the modal ExistingTaskPicker and
   the desktop fixed calendar side panel. Keeps the exact same visual language
   (search field + newest-first task cards) so the two surfaces stay in sync.

   `draggable` (desktop side-panel only) turns each card into a native HTML5
   drag source. react-big-calendar's DnD addon listens to native drag/drop
   events, so we advertise the dragged task id via dataTransfer AND via the
   onDragTask callback (which the calendar reads through dragFromOutsideItem). */
function ExistingTaskList({
  tasks, onPick, autoFocus = false, className, draggable = false, onDragTask, onDragTaskEnd,
}: {
  tasks: Task[]
  onPick: (taskId: string) => void
  autoFocus?: boolean
  className?: string
  draggable?: boolean
  onDragTask?: (taskId: string) => void
  onDragTaskEnd?: () => void
}) {
  const [query, setQuery] = useState('')
  // Newest first: sort by createdAt descending (fall back to id order).
  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    return tasks
      .filter(t => !t.archived)
      .filter(t => !q || t.title.toLowerCase().includes(q) || (t.description || '').toLowerCase().includes(q))
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
  }, [tasks, query])
  return (
    <div className={cn('flex flex-col min-h-0 flex-1', className)}>
      <div className='p-3 border-b'>
        <div className='search-field'>
          <Search className='search-field-icon' />
          <input autoFocus={autoFocus} value={query} onChange={e => setQuery(e.target.value)} className='search-field-input' placeholder='Search tasks…' aria-label='Search tasks' />
        </div>
        {draggable && (
          <div className='mt-2 text-[11px] text-zinc-400 flex items-center gap-1'>
            <Move className='h-3 w-3' /> Drag a task onto the calendar, or click to schedule.
          </div>
        )}
      </div>
      <div className='min-h-0 flex-1 overflow-y-auto p-3 space-y-2 scrollbar-thin'>
        {results.length === 0 && <Empty title='No tasks found' desc='Try a different search, or create a new task.' icon={ListChecks} />}
        {results.map(task => (
          <button
            key={task.id}
            type='button'
            draggable={draggable}
            onDragStart={draggable ? (e) => {
              // Native HTML5 drag payload — react-big-calendar's DnD addon
              // fires on native `dragover`/`drop`, so we also flag the task via
              // the callback so the calendar's dragFromOutsideItem can read it.
              e.dataTransfer.effectAllowed = 'move'
              try { e.dataTransfer.setData('text/plain', task.id) } catch { /* older browsers */ }
              onDragTask?.(task.id)
            } : undefined}
            onDragEnd={draggable ? () => onDragTaskEnd?.() : undefined}
            onClick={() => onPick(task.id)}
            className={cn(
              'panel p-3 w-full text-left hover:shadow-sm transition hover:ring-2 hover:ring-indigo-500/30',
              draggable && 'existing-task-draggable cursor-grab active:cursor-grabbing',
            )}
          >
            <div className='flex items-start gap-2'>
              {draggable && <GripVertical className='h-3.5 w-3.5 mt-0.5 shrink-0 text-zinc-400' aria-hidden='true' />}
              <div className='min-w-0 flex-1'>
                <div className='text-sm font-medium truncate'>{task.title}</div>
                <div className='mt-1 flex flex-wrap items-center gap-2 text-[11px] text-zinc-500'>
                  {statusBadge(task.status)}
                  {priorityBadge(task.priority, 'compact-meta compact-meta-priority')}
                  {task.dueDate && <span className='inline-flex items-center gap-1'><CalendarDays className='h-3 w-3' />{format(parseISO(task.dueDate), 'MMM d')}{task.time && ` · ${task.time}`}</span>}
                </div>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

function ExistingTaskPicker({
  slot, tasks, onClose, onBack, onPick,
}: {
  slot: { start: Date; end: Date; view: View }
  tasks: Task[]
  onClose: () => void
  onBack: () => void
  onPick: (taskId: string) => void
}) {
  const when = slot.view === Views.MONTH
    ? format(slot.start, 'MMM d')
    : format(slot.start, 'MMM d · HH:mm')
  return createPortal(
    <>
      <div className='popup-overlay' onClick={onClose} />
      <div className='popup-shell panel p-0 flex flex-col' style={{ maxWidth: 460, maxHeight: '80vh' }}>
        <div className='p-4 border-b flex items-center gap-2'>
          <button className='btn btn-ghost !h-8 !px-2' onClick={onBack} aria-label='Back'>
            <ChevronLeft className='h-4 w-4' />
          </button>
          <div className='flex-1 min-w-0'>
            <div className='text-sm font-semibold'>Select existing task</div>
            <div className='mt-0.5 text-xs text-zinc-500'>Schedule to {when}</div>
          </div>
          <button className='btn btn-ghost !h-8 !px-2' onClick={onClose} aria-label='Close'>
            <X className='h-4 w-4' />
          </button>
        </div>
        <ExistingTaskList tasks={tasks} onPick={onPick} autoFocus />
      </div>
    </>,
    document.body,
  )
}


/* ============================================================
   Quick Add / Command / Filters (popup fix)
   ============================================================ */
const schema = z.object({
  title: z.string().min(1),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
  projectId: z.string().optional(),
  dueDate: z.string().optional(),
  time: z.string().optional(),
})
type QuickForm = z.infer<typeof schema>

function QuickAdd() {
  const ui = useUI()
  const addTask = useData(s => s.addTask)
  const projects = useData(s => s.projects)
  const { control, register, handleSubmit, watch, setValue, reset } = useForm<QuickForm>({ resolver: zodResolver(schema), defaultValues: { title: '', priority: 'medium', projectId: '' } })
  const title = watch('title')
  const parsed = parseNL(title || '')
  useEffect(() => { if (ui.quick) reset() }, [ui.quick, reset])

  return (
    <AnimatePresence>
      {ui.quick && (
        <>
          <motion.div className='popup-overlay' initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => ui.set({ quick: false })} />
          <motion.div
            className='popup-shell popup-shell-quick panel p-0'
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
          >
            <form onSubmit={handleSubmit(v => {
              const nl = parseNL(v.title)
              addTask({ title: nl.title, dueDate: v.dueDate || nl.dueDate, time: v.time || nl.time, priority: v.priority || nl.priority, projectId: v.projectId || undefined })
              ui.set({ quick: false })
            })}>
              <div className='p-4 border-b'>
                <input {...register('title')} autoFocus className='w-full bg-transparent text-base font-semibold outline-none' placeholder='Design homepage tomorrow 2pm !high' />
              </div>
              {(parsed.dueDate || parsed.time || parsed.priority) && (
                <div className='px-4 py-2 text-xs text-zinc-500 flex flex-wrap gap-3 border-b bg-zinc-50 dark:bg-zinc-900'>
                  <span className='inline-flex items-center gap-1'><Sparkles className='h-3 w-3' /> Parsed</span>
                  {parsed.dueDate && <span>{parsed.dueDate}</span>}
                  {parsed.time && <span>{parsed.time}</span>}
                  {parsed.priority && <span className={priorityMeta[parsed.priority].color}>{priorityMeta[parsed.priority].label}</span>}
                  <button type='button' className='ml-auto text-indigo-600' onClick={() => {
                    if (parsed.dueDate) setValue('dueDate', parsed.dueDate)
                    if (parsed.time) setValue('time', parsed.time)
                    if (parsed.priority) setValue('priority', parsed.priority)
                  }}>Apply</button>
                </div>
              )}
              <div className='popup-body grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 p-4'>
                <input type='date' className='input' {...register('dueDate')} />
                <input type='time' className='input' {...register('time')} />
                <Controller control={control} name='priority' render={({ field }) => (
                  <select className='input' {...field}>
                    <option value='low'>Low</option>
                    <option value='medium'>Medium</option>
                    <option value='high'>High</option>
                    <option value='urgent'>Urgent</option>
                  </select>
                )} />
                <Controller control={control} name='projectId' render={({ field }) => (
                  <select className='input' {...field}>
                    <option value=''>No project</option>
                    {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                )} />
              </div>
              <div className='flex items-center justify-between gap-2 px-4 py-3 border-t bg-zinc-50 dark:bg-zinc-900'>
                <div className='text-xs text-zinc-500 hidden sm:block'>Natural language enabled</div>
                <div className='flex gap-2 ml-auto'>
                  <button type='button' className='btn btn-secondary' onClick={() => ui.set({ quick: false })}>Cancel</button>
                  <button className='btn btn-primary'>Add task</button>
                </div>
              </div>
            </form>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

function CommandPalette() {
  const ui = useUI()
  const tasks = useData(s => s.tasks)
  const projects = useData(s => s.projects)
  const [q, setQ] = useState('')
  const nav = useNavigate()
  const matches = tasks.filter(t => !q || t.title.toLowerCase().includes(q.toLowerCase()) || (t.description || '').toLowerCase().includes(q.toLowerCase())).slice(0, 6)
  const projectMatches = projects.filter(p => !q || p.name.toLowerCase().includes(q.toLowerCase())).slice(0, 6)

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); ui.set({ command: !ui.command }) }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'n') { e.preventDefault(); ui.set({ quick: true }) }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') { e.preventDefault(); ui.set({ sidebar: !ui.sidebar }) }
      if (e.key === 'Escape') { ui.set({ command: false, quick: false, filters: false }) }
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [ui])

  return (
    <AnimatePresence>
      {ui.command && (
        <>
          <motion.div className='popup-overlay' initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => ui.set({ command: false })} />
          <motion.div
            className='popup-shell panel p-0'
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
          >
            <div className='border-b'>
              <div className='search-field search-field-in-popup'>
                <Search className='search-field-icon' />
                <input
                  autoFocus
                  value={q}
                  onChange={e => setQ(e.target.value)}
                  className='search-field-input'
                  placeholder='Search tasks, projects, tags…'
                  aria-label='Search'
                />
                <span className='search-field-kbd'>esc</span>
              </div>
            </div>
            <div className='popup-body p-2 scrollbar-thin'>
              <div className='px-2 py-1 text-[10px] uppercase tracking-wider text-zinc-500'>Actions</div>
              <button className='w-full text-left rounded-xl px-3 py-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-sm' onClick={() => ui.set({ command: false, quick: true })}>New task</button>
              <div className='px-2 py-1 mt-2 text-[10px] uppercase tracking-wider text-zinc-500'>Tasks</div>
              {matches.length === 0 && <div className='px-3 py-2 text-xs text-zinc-500'>No matches</div>}
              {matches.map(t => (
                <button key={t.id} className='w-full text-left rounded-xl px-3 py-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-sm flex items-center gap-2' onClick={() => ui.set({ command: false, selected: t.id, details: true })}>
                  <ListChecks className='h-4 w-4 text-zinc-500' />
                  <span className='flex-1 truncate'>{t.title}</span>
                </button>
              ))}
              <div className='px-2 py-1 mt-2 text-[10px] uppercase tracking-wider text-zinc-500'>Projects</div>
              {projectMatches.map(p => (
                <button key={p.id} className='w-full text-left rounded-xl px-3 py-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-sm flex items-center gap-2' onClick={() => { nav(`/projects/${p.id}`); ui.set({ command: false }) }}>
                  <span className='h-2 w-2 rounded-full' style={{ background: p.color }} />
                  <span className='flex-1 truncate'>{p.name}</span>
                </button>
              ))}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

/* Global task filter + sort. Redesigned as a clean, modern, compact rounded
   card that slides in from the right. Everything applies INSTANTLY (no Apply
   button) and the same filter/sort state drives task lists across the whole
   app for full consistency. */
function FiltersPanel() {
  const ui = useUI()
  const data = useData()
  const f = data.filters

  // Count of active constraints (search + any selected chip). Sort is not
  // counted here since a sort is always applied.
  const activeCount =
    (f.search.trim() ? 1 : 0) +
    (f.favoriteOnly ? 1 : 0) +
    f.statuses.length + f.priorities.length + f.projectIds.length + f.tags.length

  const toggle = <T,>(arr: T[], v: T): T[] => arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v]

  return (
    <AnimatePresence>
      {ui.filters && (
        <>
          <motion.div className='popup-overlay filter-overlay' initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => ui.set({ filters: false })} />
          <motion.div
            className='filter-drawer'
            initial={{ x: '110%', opacity: 0.6 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: '110%', opacity: 0.6 }}
            transition={{ type: 'spring', stiffness: 420, damping: 40 }}
            role='dialog'
            aria-label='Filter and sort tasks'
          >
            <div className='filter-card'>
              {/* Header */}
              <div className='filter-card-head'>
                <div className='flex items-center gap-2 min-w-0'>
                  <span className='filter-head-icon'><SlidersHorizontal className='h-4 w-4' /></span>
                  <div className='min-w-0'>
                    <div className='text-sm font-semibold leading-tight'>Filters &amp; Sort</div>
                    <div className='text-[11px] text-zinc-500 leading-tight'>
                      {activeCount > 0 ? `${activeCount} active` : 'Changes apply instantly'}
                    </div>
                  </div>
                </div>
                <div className='flex items-center gap-1'>
                  {activeCount > 0 && (
                    <button className='btn btn-ghost !h-8 !px-2 text-xs' onClick={() => data.resetFilters()}>Reset</button>
                  )}
                  <button className='btn btn-ghost !h-8 !w-8 !px-0 inline-flex items-center justify-center' onClick={() => ui.set({ filters: false })} aria-label='Close'>
                    <X className='h-4 w-4' />
                  </button>
                </div>
              </div>

              {/* Body */}
              <div className='filter-card-body'>
                {/* Full-width search bar */}
                <div className='search-field w-full'>
                  <Search className='search-field-icon' />
                  <input
                    value={f.search}
                    onChange={e => data.setFilters({ search: e.target.value })}
                    className='search-field-input'
                    placeholder='Search tasks…'
                    aria-label='Search tasks'
                  />
                  {f.search && (
                    <button className='filter-search-clear' onClick={() => data.setFilters({ search: '' })} aria-label='Clear search'>
                      <X className='h-3.5 w-3.5' />
                    </button>
                  )}
                </div>

                {/* Sort */}
                <section className='filter-section'>
                  <div className='filter-section-label'>Sort by</div>
                  <div className='filter-chip-row'>
                    {SORT_OPTIONS.map(o => (
                      <button
                        key={o.key}
                        className={cn('filter-pill', f.sort === o.key && 'filter-pill-on')}
                        aria-pressed={f.sort === o.key}
                        onClick={() => data.setFilters({ sort: o.key })}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                  <div className='mt-2 flex items-center gap-1.5'>
                    <button
                      className={cn('filter-pill flex-1 justify-center', f.sortDir === 'desc' && 'filter-pill-on')}
                      aria-pressed={f.sortDir === 'desc'}
                      onClick={() => data.setFilters({ sortDir: 'desc' })}
                    >
                      <ArrowDown className='h-3.5 w-3.5' /> Descending
                    </button>
                    <button
                      className={cn('filter-pill flex-1 justify-center', f.sortDir === 'asc' && 'filter-pill-on')}
                      aria-pressed={f.sortDir === 'asc'}
                      onClick={() => data.setFilters({ sortDir: 'asc' })}
                    >
                      <ArrowUp className='h-3.5 w-3.5' /> Ascending
                    </button>
                  </div>
                </section>

                {/* Favorites */}
                <section className='filter-section'>
                  <div className='filter-section-label'>Favorites</div>
                  <button
                    className={cn('filter-pill', f.favoriteOnly && 'filter-pill-on')}
                    aria-pressed={f.favoriteOnly}
                    onClick={() => data.setFilters({ favoriteOnly: !f.favoriteOnly })}
                  >
                    <Star className={cn('h-3.5 w-3.5', f.favoriteOnly && 'fill-current')} /> Favorited only
                  </button>
                </section>

                {/* Status */}
                <section className='filter-section'>
                  <div className='filter-section-label'>Status</div>
                  <div className='filter-chip-row'>
                    {(Object.keys(statusMeta) as Status[]).map(s => (
                      <button
                        key={s}
                        className={cn('filter-pill', f.statuses.includes(s) && 'filter-pill-on')}
                        aria-pressed={f.statuses.includes(s)}
                        onClick={() => data.setFilters({ statuses: toggle(f.statuses, s) })}
                      >
                        <span className={cn('h-1.5 w-1.5 rounded-full', statusMeta[s].dot)} /> {statusMeta[s].label}
                      </button>
                    ))}
                  </div>
                </section>

                {/* Priority */}
                <section className='filter-section'>
                  <div className='filter-section-label'>Priority</div>
                  <div className='filter-chip-row'>
                    {(Object.keys(priorityMeta) as Priority[]).map(p => (
                      <button
                        key={p}
                        className={cn('filter-pill', f.priorities.includes(p) && 'filter-pill-on')}
                        aria-pressed={f.priorities.includes(p)}
                        onClick={() => data.setFilters({ priorities: toggle(f.priorities, p) })}
                      >
                        <span className='h-1.5 w-1.5 rounded-full' style={{ background: priorityMeta[p].hex }} /> {priorityMeta[p].label}
                      </button>
                    ))}
                  </div>
                </section>

                {/* Projects */}
                {data.projects.length > 0 && (
                  <section className='filter-section'>
                    <div className='filter-section-label'>Projects</div>
                    <div className='filter-chip-row'>
                      {data.projects.map(p => (
                        <button
                          key={p.id}
                          className={cn('filter-pill', f.projectIds.includes(p.id) && 'filter-pill-on')}
                          aria-pressed={f.projectIds.includes(p.id)}
                          onClick={() => data.setFilters({ projectIds: toggle(f.projectIds, p.id) })}
                        >
                          <span className='h-2 w-2 rounded-full' style={{ background: p.color }} /> {p.name}
                        </button>
                      ))}
                    </div>
                  </section>
                )}

                {/* Tags */}
                {data.tags.length > 0 && (
                  <section className='filter-section'>
                    <div className='filter-section-label'>Tags</div>
                    <div className='filter-chip-row'>
                      {data.tags.map(t => (
                        <button
                          key={t.id}
                          className={cn('filter-pill', f.tags.includes(t.id) && 'filter-pill-on')}
                          aria-pressed={f.tags.includes(t.id)}
                          onClick={() => data.setFilters({ tags: toggle(f.tags, t.id) })}
                        >
                          <span className='h-2 w-2 rounded-full' style={{ background: t.color }} /> {t.name}
                        </button>
                      ))}
                    </div>
                  </section>
                )}
              </div>

              {/* Footer */}
              <div className='filter-card-foot'>
                <button className='btn btn-ghost !h-9 text-xs' onClick={() => data.resetFilters()} disabled={activeCount === 0}>
                  Clear all
                </button>
                <button className='btn btn-primary !h-9 text-xs flex-1 justify-center' onClick={() => ui.set({ filters: false })}>
                  Done
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

/* ============================================================
   Task Description Editor — Linear / Todoist style: collapsed
   compact view by default, expands to a rich editor on focus.
   Includes inline formatting toolbar, live placeholder, and a
   tasteful "empty" affordance.
   ============================================================ */
function TaskDescriptionEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [focused, setFocused] = useState(false)
  const [preview, setPreview] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)
  // Auto-grow height to fit content (max ~ 50vh).
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, Math.max(96, Math.round(window.innerHeight * 0.5))) + 'px'
  }, [value, focused, preview])

  const wrap = (before: string, after = before, placeholder = '') => {
    const el = ref.current; if (!el) return
    const start = el.selectionStart ?? 0
    const end = el.selectionEnd ?? 0
    const selected = value.slice(start, end) || placeholder
    const next = value.slice(0, start) + before + selected + after + value.slice(end)
    onChange(next)
    requestAnimationFrame(() => {
      el.focus()
      const pos = start + before.length + selected.length
      el.setSelectionRange(pos, pos)
    })
  }
  const insertLine = (prefix: string, placeholder = '') => {
    const el = ref.current; if (!el) return
    const start = el.selectionStart ?? 0
    const lineStart = value.lastIndexOf('\n', start - 1) + 1
    const isEmpty = value.slice(lineStart, start).trim() === ''
    const insertion = (isEmpty ? '' : '\n') + prefix + placeholder
    const next = value.slice(0, start) + insertion + value.slice(start)
    onChange(next)
    requestAnimationFrame(() => { el.focus(); const p = start + insertion.length; el.setSelectionRange(p, p) })
  }

  const isEmpty = !value.trim()

  return (
    <div className={cn('task-desc', focused && 'is-focused', isEmpty && !focused && 'is-empty')}>
      <div className='task-desc-label'>
        <MessageSquare className='h-3.5 w-3.5' />
        <span>Description</span>
        {!isEmpty && (
          <div className='ml-auto flex items-center gap-1'>
            <button
              type='button'
              className={cn('task-desc-mode', !preview && 'is-active')}
              onClick={() => setPreview(false)}
            >Write</button>
            <button
              type='button'
              className={cn('task-desc-mode', preview && 'is-active')}
              onClick={() => setPreview(true)}
            >Preview</button>
          </div>
        )}
      </div>

      {preview ? (
        <div className='task-desc-preview'>
          <MarkdownPreview text={value} />
        </div>
      ) : (
        <>
          {(focused || !isEmpty) && (
            <div className='task-desc-toolbar' role='toolbar' aria-label='Formatting'>
              <button type='button' className='doc-tool' onMouseDown={e => e.preventDefault()} onClick={() => wrap('**', '**', 'bold')} title='Bold'><strong>B</strong></button>
              <button type='button' className='doc-tool' onMouseDown={e => e.preventDefault()} onClick={() => wrap('*', '*', 'italic')} title='Italic'><em>I</em></button>
              <button type='button' className='doc-tool' onMouseDown={e => e.preventDefault()} onClick={() => wrap('`', '`', 'code')} title='Code'><code>{'<>'}</code></button>
              <div className='doc-tool-sep' />
              <button type='button' className='doc-tool' onMouseDown={e => e.preventDefault()} onClick={() => insertLine('## ', 'Heading')} title='Heading'><span className='doc-tool-h'>H</span></button>
              <button type='button' className='doc-tool' onMouseDown={e => e.preventDefault()} onClick={() => insertLine('- ', 'Item')} title='Bulleted list'>•</button>
              <button type='button' className='doc-tool' onMouseDown={e => e.preventDefault()} onClick={() => insertLine('- [ ] ', 'Task')} title='Task list'><CheckCircle2 className='h-3.5 w-3.5' /></button>
              <button type='button' className='doc-tool' onMouseDown={e => e.preventDefault()} onClick={() => insertLine('> ', 'Quote')} title='Quote'>”</button>
              <button type='button' className='doc-tool' onMouseDown={e => e.preventDefault()} onClick={() => wrap('[', '](https://)', 'link')} title='Link'><LinkIcon className='h-3.5 w-3.5' /></button>
            </div>
          )}
          <textarea
            ref={ref}
            value={value}
            onChange={e => onChange(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onKeyDown={e => {
              if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') { e.preventDefault(); wrap('**', '**', 'bold') }
              if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'i') { e.preventDefault(); wrap('*', '*', 'italic') }
            }}
            placeholder={isEmpty ? 'Add a description, notes, or links… (Markdown supported)' : ''}
            className='task-desc-textarea'
            spellCheck
          />
          {isEmpty && !focused && (
            <div className='task-desc-hint'>Click to add a description. Supports **bold**, lists, code, and [links](url).</div>
          )}
        </>
      )}
    </div>
  )
}

/* ============================================================
   Task Details (full preserved)
   ============================================================ */
function TaskDetails() {
  const ui = useUI()
  const data = useData()
  const navigate = useNavigate()
  const task = data.tasks.find(t => t.id === ui.selected)
  const ctx = useContextMenu()
  const [renaming, setRenaming] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [tagPickerOpen, setTagPickerOpen] = useState(false)
  // Replaces the two prior `window.prompt('Subtask title')` calls (context
  // menu "Add subtask" and the inline "+ Add subtask" button) with the
  // themed NamePrompt modal so alerts / prompts feel native to the app.
  const [addingSubtask, setAddingSubtask] = useState(false)
  if (!task) return <div className='h-full flex items-center justify-center text-sm text-zinc-500'>Select a task</div>
  const project = data.projects.find(p => p.id === task.projectId)
  const subs = subTasks(data.tasks, task.id)
  const openMenu = (e: React.MouseEvent) => {
    ctx.open(e, buildTaskMenu(task, {
      projects: data.projects, navigate,
      onRename: () => setRenaming(true),
      onCopyLink: () => { try { navigator.clipboard?.writeText(window.location.origin + '/?task=' + task.id) } catch {} },
      onOpenNewTab: () => window.open(window.location.origin + '/?task=' + task.id, '_blank'),
      onLocateCalendar: () => { useUI.getState().set({ calendarTarget: task.id }); navigate('/calendar') },
      onDelete: () => setConfirming(true),
      onAddSubtask: () => {
        // Open the themed NamePrompt modal so the styling matches the rest
        // of the app instead of using the raw browser prompt dialog.
        setAddingSubtask(true)
      },
    }))
  }
  return (
    <div className='h-full flex flex-col'>
      {ctx.node}
      {renaming && <NamePrompt title='Rename task' initial={task.title} label='Title' onClose={() => setRenaming(false)} onSave={(v) => data.updateTask(task.id, { title: v })} />}
      {confirming && <DeleteConfirm title='Delete task' name={task.title} onClose={() => setConfirming(false)} onConfirm={() => { data.deleteTask(task.id); ui.set({ details: false, selected: null }) }} />}
      {addingSubtask && (
        <NamePrompt
          title='New subtask'
          initial=''
          label='Subtask title'
          onClose={() => setAddingSubtask(false)}
          onSave={(v) => data.addTask({ title: v, parentId: task.id, projectId: task.projectId })}
        />
      )}
      <div className='h-14 border-b px-4 flex items-center gap-2'>
        <StatusDot status={task.status} />
        {statusBadge(task.status)}
        {task.dueDate && <button className='btn btn-ghost !px-2 !py-1 !text-xs' onClick={() => { ui.set({ calendarTarget: task.id }); navigate('/calendar') }}><MapPinned className='h-3.5 w-3.5' /> Locate</button>}
        <div className='ml-auto flex gap-1'>
          <button className='btn btn-ghost' onClick={openMenu}><MoreHorizontal className='h-4 w-4' /></button>
          <button className='btn btn-ghost' onClick={() => ui.set({ details: false, selected: null })}><X className='h-4 w-4' /></button>
        </div>
      </div>
      <div className='p-4 space-y-5 overflow-y-auto h-full scrollbar-thin'>
        <input className='w-full bg-transparent text-lg sm:text-xl font-semibold outline-none task-details-title' value={task.title} onChange={e => data.updateTask(task.id, { title: e.target.value })} placeholder='Task title' />
        <TaskDescriptionEditor
          value={task.description || ''}
          onChange={(v) => data.updateTask(task.id, { description: v })}
        />
        <div className='grid grid-cols-2 gap-3 text-sm'>
          <label className='space-y-1'>
            <div className='text-[11px] uppercase tracking-wider text-zinc-500'>Status</div>
            <select className='input' value={task.status} onChange={e => data.updateTask(task.id, { status: e.target.value as Status })}>
              {(Object.keys(statusMeta) as Status[]).map(s => <option key={s} value={s}>{statusMeta[s].label}</option>)}
            </select>
          </label>
          <label className='space-y-1'>
            <div className='text-[11px] uppercase tracking-wider text-zinc-500'>Priority</div>
            <select className='input' value={task.priority} onChange={e => data.updateTask(task.id, { priority: e.target.value as Priority })}>
              {(Object.keys(priorityMeta) as Priority[]).map(p => <option key={p} value={p}>{priorityMeta[p].label}</option>)}
            </select>
          </label>
          <label className='space-y-1'>
            <div className='text-[11px] uppercase tracking-wider text-zinc-500'>Project</div>
            <select className='input' value={task.projectId || ''} onChange={e => data.updateTask(task.id, { projectId: e.target.value || undefined })}>
              <option value=''>None</option>
              {data.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label className='space-y-1'>
            <div className='text-[11px] uppercase tracking-wider text-zinc-500'>Due date</div>
            <input type='date' className='input' value={task.dueDate || ''} onChange={e => data.updateTask(task.id, { dueDate: e.target.value || undefined })} />
          </label>
          <label className='space-y-1'>
            <div className='text-[11px] uppercase tracking-wider text-zinc-500'>Time</div>
            <input type='time' className='input' value={task.time || ''} onChange={e => data.updateTask(task.id, { time: e.target.value || undefined })} />
          </label>
          <label className='space-y-1'>
            <div className='text-[11px] uppercase tracking-wider text-zinc-500'>Estimate (min)</div>
            <input type='number' min={0} className='input' value={task.estimatedMinutes || 0} onChange={e => data.updateTask(task.id, { estimatedMinutes: +e.target.value })} />
          </label>
        </div>

        {/* Tags */}
        <div>
          <div className='mb-2 text-[11px] uppercase tracking-wider text-zinc-500 flex items-center justify-between'>
            <span>Tags</span>
            <button className='text-indigo-600 text-xs' onClick={() => setTagPickerOpen(s => !s)}>+ Add tag</button>
          </div>
          <div className='flex flex-wrap gap-2'>
            {task.tags.map(tid => {
              const tg = data.tags.find(t => t.id === tid); if (!tg) return null
              return <span key={tid} className='badge bg-black/5 dark:bg-white/5 inline-flex items-center'>
                <span className='h-1.5 w-1.5 rounded-full' style={{ background: tg.color }} />
                {tg.name}
                <button className='ml-1 text-zinc-400 hover:text-rose-500' onClick={() => data.updateTask(task.id, { tags: task.tags.filter(x => x !== tid) })}>
                  <X className='h-3 w-3' />
                </button>
              </span>
            })}
            {task.tags.length === 0 && <span className='text-xs text-zinc-500'>No tags yet</span>}
          </div>
          {tagPickerOpen && (
            <div className='mt-2 panel p-2 flex flex-wrap gap-1'>
              {data.tags.filter(t => !task.tags.includes(t.id)).map(t => (
                <button key={t.id} onClick={() => { data.updateTask(task.id, { tags: [...task.tags, t.id] }); setTagPickerOpen(false) }}
                  className='inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs hover:bg-[hsl(var(--accent))]'>
                  <span className='h-1.5 w-1.5 rounded-full' style={{ background: t.color }} />
                  {t.name}
                </button>
              ))}
              {data.tags.filter(t => !task.tags.includes(t.id)).length === 0 && (
                <span className='text-xs text-zinc-500 px-1.5'>All tags added. Manage tags from the Tags page.</span>
              )}
            </div>
          )}
        </div>

        {/* Checklist */}
        <div>
          <div className='mb-2 text-[11px] uppercase tracking-wider text-zinc-500 flex items-center justify-between'>
            <span>Checklist</span>
            <button className='text-indigo-600 text-xs' onClick={() => data.updateTask(task.id, { checklist: [...task.checklist, { id: 'cl' + Date.now(), text: 'New item', done: false }] })}>+ Add</button>
          </div>
          <div className='space-y-1'>
            {task.checklist.map(c => (
              <div key={c.id} className='flex items-center gap-2'>
                <input type='checkbox' checked={c.done} onChange={e => data.updateTask(task.id, { checklist: task.checklist.map(x => x.id === c.id ? { ...x, done: e.target.checked } : x) })} />
                <input className='input h-9' value={c.text} onChange={e => data.updateTask(task.id, { checklist: task.checklist.map(x => x.id === c.id ? { ...x, text: e.target.value } : x) })} />
                <button onClick={() => data.updateTask(task.id, { checklist: task.checklist.filter(x => x.id !== c.id) })}><Trash2 className='h-4 w-4 text-zinc-400' /></button>
              </div>
            ))}
            {task.checklist.length === 0 && <div className='text-xs text-zinc-500'>No checklist items yet</div>}
          </div>
        </div>

        {/* Subtasks — always rendered with an inline "Add subtask" affordance,
            so users can build a hierarchy without leaving the details panel. */}
        <div>
          <div className='mb-2 text-[11px] uppercase tracking-wider text-zinc-500 flex items-center justify-between'>
            <span>Subtasks {subs.length > 0 && <span className='text-zinc-400 normal-case tracking-normal'>· {subs.filter(s => s.status === 'done').length}/{subs.length}</span>}</span>
            <button
              className='text-indigo-600 text-xs'
              onClick={() => setAddingSubtask(true)}
            >+ Add subtask</button>
          </div>
          {subs.length > 0
            ? <TaskList tasks={subs} showProject={false} />
            : <div className='text-xs text-zinc-500'>No subtasks yet. Break this task into smaller steps.</div>
          }
        </div>

        {/* Images */}
        <div>
          <div className='mb-2 text-[11px] uppercase tracking-wider text-zinc-500 flex items-center justify-between'>
            <span>Images</span>
            <label className='text-indigo-600 text-xs cursor-pointer inline-flex items-center gap-1'>
              <ImageIcon className='h-3.5 w-3.5' /> Add image
              <input
                type='file'
                accept='image/*'
                multiple
                className='hidden'
                onChange={async (e) => {
                  const files = Array.from(e.target.files || [])
                  if (!files.length) return
                  const uploaded = await Promise.all(files.map(async (file) => ({ id: 'img' + Date.now() + Math.random().toString(36).slice(2, 6), url: await readFileAsDataUrl(file), name: file.name })))
                  data.updateTask(task.id, { images: [...(task.images || []), ...uploaded] })
                  e.currentTarget.value = ''
                }}
              />
            </label>
          </div>
          <div className='space-y-3'>
            <div className='flex flex-wrap gap-3'>
              {(task.images || []).map(img => (
                <div key={img.id} className='panel p-2 w-[140px]'>
                  <img src={img.url} alt={img.name || task.title} className='h-24 w-full rounded-xl object-cover' />
                  <div className='mt-2 text-[11px] text-zinc-500 truncate'>{img.name || 'Task image'}</div>
                  <div className='mt-2 flex items-center gap-1'>
                    <button className='btn btn-secondary !h-8 !px-2 text-xs' onClick={() => window.open(img.url, '_blank')}>Open</button>
                    <button className='btn btn-ghost !h-8 !px-2 text-xs text-rose-600' onClick={() => data.updateTask(task.id, { images: (task.images || []).filter(x => x.id !== img.id) })}>Remove</button>
                  </div>
                </div>
              ))}
            </div>
            {(task.images || []).length === 0 && <div className='text-xs text-zinc-500'>Upload task screenshots, mockups, receipts, or any supporting image.</div>}
            <div className='flex gap-2'>
              <input id='task-image-url' className='input' placeholder='Or paste an image URL and press Enter' onKeyDown={(e) => {
                if (e.key !== 'Enter') return
                const value = (e.currentTarget.value || '').trim()
                if (!value) return
                data.updateTask(task.id, { images: [...(task.images || []), { id: 'img' + Date.now(), url: value, name: value.split('/').pop() }] })
                e.currentTarget.value = ''
              }} />
            </div>
          </div>
        </div>

        {/* Comments */}
        <div>
          <div className='mb-2 text-[11px] uppercase tracking-wider text-zinc-500'>Comments</div>
          <div className='space-y-2'>
            {task.comments.map(c => (
              <div key={c.id} className='panel p-3 text-sm'>
                <div className='text-xs text-zinc-500'>{c.author}</div>
                <div>{c.text}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Danger zone */}
        <div className='pt-2'>
          <button className='btn btn-secondary text-rose-600' onClick={() => { data.deleteTask(task.id); ui.set({ details: false, selected: null }) }}>
            <Trash2 className='h-4 w-4' /> Delete task
          </button>
        </div>
      </div>
    </div>
  )
}

/* ============================================================
   Layout — mobile navigation + URL routing fixes
   ============================================================ */
function Layout() {
  const ui = useUI()
  const mobile = useMedia('(max-width: 768px)')
  const location = useLocation()
  const navigate = useNavigate()

  /* Publish the visible-sidebar width to CSS as `--app-sidebar-w` so the
     command palette / search popup can center itself inside the CONTENT
     area (right of the sidebar) instead of the whole viewport. On mobile
     the sidebar becomes a drawer so its layout width is 0. */
  useEffect(() => {
    const root = document.documentElement
    const w = (!mobile && ui.sidebar) ? ui.sidebarW : 0
    root.style.setProperty('--app-sidebar-w', `${w}px`)
  }, [mobile, ui.sidebar, ui.sidebarW])

  /* ---- Keyboard shortcuts: duplicate (Ctrl/Cmd+D) & delete (Delete key) ----
     Duplicate: uses the currently-focused task (ui.selected) as target.
     Delete: prefers the selected task; falls back to the currently-viewed
     project when the user is on /projects/:id and no task is selected.
     Both are guarded so they never fire while typing in form fields. */
  const [pendingDelete, setPendingDelete] = useState<null | { kind: 'task' | 'project'; id: string; name: string }>(null)

  useEffect(() => {
    const isTypingTarget = (el: EventTarget | null) => {
      if (!(el instanceof HTMLElement)) return false
      const tag = el.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
      if (el.isContentEditable) return true
      return false
    }
    const on = (e: KeyboardEvent) => {
      // Never intercept while the user is editing text — that would break
      // normal Backspace / Delete behavior in inputs and prevent Cmd+D from
      // reaching any custom editor shortcut in the future.
      if (isTypingTarget(e.target)) return

      // Duplicate the currently-selected task.
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'd') {
        const sel = useUI.getState().selected
        if (!sel) return
        e.preventDefault()
        useData.getState().duplicateTask(sel)
        return
      }

      // Delete selected task OR the current project (with confirmation).
      // We accept both the dedicated Delete key and Backspace so it works on
      // laptops that ship without a real Delete key.
      if (e.key === 'Delete' || e.key === 'Backspace') {
        // Skip when a modal/popup is already open to avoid double-actions.
        const s = useUI.getState()
        if (s.command || s.quick || s.filters) return
        // Prefer the selected task.
        const selId = s.selected
        if (selId) {
          const task = useData.getState().tasks.find(t => t.id === selId)
          if (task) {
            e.preventDefault()
            setPendingDelete({ kind: 'task', id: task.id, name: task.title })
            return
          }
        }
        // Fallback: on /projects/:id with no task selected, delete the project.
        const m = location.pathname.match(/^\/projects\/(.+)$/)
        if (m) {
          const projId = m[1]
          const proj = useData.getState().projects.find(p => p.id === projId)
          if (proj) {
            e.preventDefault()
            setPendingDelete({ kind: 'project', id: proj.id, name: proj.name })
          }
        }
      }
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [location.pathname])

  /* ---- BUG FIX: mobile "Select a task" full-screen panel hides app ----
     When viewport switches to desktop (or window resizes wide), make sure
     the mobile-only full-screen details overlay closes itself so the rest
     of the UI is visible. Also auto-close details when navigating routes
     on mobile so it never lingers across pages. */
  useEffect(() => {
    if (!mobile && ui.details && !ui.selected) ui.set({ details: false })
  }, [mobile, ui.details, ui.selected])

  useEffect(() => {
    // Close transient overlays whenever the route changes (prevents stuck
    // full-screen panel after deep-linking or back-navigation on mobile).
    ui.set({ mobileNav: false, command: false, filters: false, quick: false, details: false, selected: null })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname])

  /* ---- BUG FIX: mobile Back should return to previous in-app page ----
     Push a synthetic history state when overlays open, and intercept the
     popstate so the back gesture closes them first, then navigates within
     the app rather than exiting it.

     IMPORTANT (multi-task open bug):
     Previously, opening a task pushed a fake state, but closing via the X
     button only flipped `ui.details = false` WITHOUT calling history.back().
     That left orphan synthetic states on the stack. Opening another task
     pushed YET ANOTHER state. Over time, especially when a task had subtasks
     (which mount a nested TaskList that re-runs many effects), the
     pushed-state churn confused popstate listeners and subsequent taps on
     other tasks could be silently swallowed.

     Fix: track whether THIS overlay session has a pushed state, and when the
     overlay closes by ANY means (button, overlay tap, ESC) we replay one
     history.back() so the stack stays balanced. We also short-circuit a
     popstate that we triggered ourselves to avoid double-clearing. */
  const overlayPushRef = useRef<{ pushed: boolean }>({ pushed: false })
  const hasOverlay = ui.mobileNav || ui.command || ui.filters || ui.quick || (mobile && ui.details)
  useEffect(() => {
    if (hasOverlay && !overlayPushRef.current.pushed) {
      // Overlay just opened — push exactly ONE synthetic state, so the system
      // back gesture closes it instead of leaving the app. We push at most
      // one entry no matter how many overlays open/close in succession — this
      // was the root cause of the “multi-task tap stops opening” bug: the
      // previous build pushed a new state on every overlay flip, building a
      // huge stack that confused popstate handlers and click delivery.
      overlayPushRef.current.pushed = true
      try { window.history.pushState({ orbitOverlay: true }, '') } catch {}
    }
  }, [hasOverlay])

  useEffect(() => {
    const onPop = () => {
      if (overlayPushRef.current.pushed) {
        // The synthetic state was consumed by the back gesture. Reset our
        // tracking flag and close any overlays that are still open.
        overlayPushRef.current.pushed = false
        ui.set({ mobileNav: false, command: false, filters: false, quick: false, details: false, selected: null })
      }
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className='h-full flex overflow-hidden'>
      {!mobile && ui.sidebar && <div style={{ width: ui.sidebarW }} className='border-r shrink-0'><Sidebar /></div>}
      <div className='flex-1 min-w-0 flex flex-col'>
        <Topbar />
        <div className='flex-1 min-h-0'>
          <Routes>
            <Route path='/' element={<Navigate to='/today' replace />} />
            <Route path='/dashboard' element={<Dashboard />} />
            <Route path='/today' element={<TodayPage />} />
            <Route path='/upcoming' element={<UpcomingPage />} />
            <Route path='/calendar' element={<CalendarPage />} />
            <Route path='/projects' element={<ProjectsPage />} />
            <Route path='/projects/:id' element={<ProjectPage />} />
            <Route path='/all-tasks' element={<AllTasksPage />} />
            <Route path='/favorites' element={<FavoritesPage />} />
            <Route path='/completed' element={<CompletedPage />} />
            <Route path='/archive' element={<ArchivePage />} />
            <Route path='/tags' element={<TagsPage />} />
            <Route path='/settings' element={<SettingsPage />} />
            {/* Catch-all → never show a 404; route to /today */}
            <Route path='*' element={<Navigate to='/today' replace />} />
          </Routes>
        </div>
      </div>

      {/* Desktop details panel — only render when a task is selected so it
          never appears as a stale "Select a task" placeholder. */}
      {!mobile && ui.details && ui.selected && (
        <div style={{ width: ui.detailsW }} className='border-l shrink-0'><TaskDetails /></div>
      )}

      {/* Mobile nav overlay */}
      <AnimatePresence>
        {mobile && ui.mobileNav && (
          <>
            <motion.div className='fixed inset-0 bg-black/20 z-40' initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => ui.set({ mobileNav: false })} />
            <motion.div className='fixed left-0 top-0 bottom-0 w-72 max-w-[85vw] bg-[hsl(var(--background))] z-50 border-r' initial={{ x: -320 }} animate={{ x: 0 }} exit={{ x: -320 }}>
              <Sidebar />
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Mobile task details — full screen, but only when a task IS selected.
          mode='wait' guarantees the previous panel finishes its exit BEFORE
          a new panel mounts. This was the second half of the multi-task bug:
          two panels overlapping in the DOM caused the second one to be
          unclickable because pointer events landed on the exiting one. */}
      <AnimatePresence mode='wait'>
        {mobile && ui.details && ui.selected && (
          <motion.div
            key={ui.selected}
            className='fixed inset-0 z-40'
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, pointerEvents: 'none' }}
            transition={{ duration: 0.18 }}
          >
            <div className='absolute inset-0 bg-black/20' onClick={() => ui.set({ details: false, selected: null })} />
            <motion.div
              className='absolute inset-0 bg-[hsl(var(--background))]'
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'tween', duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
            >
              <TaskDetails />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <QuickAdd />
      <CommandPalette />
      <FiltersPanel />
      <QuickSettingsPopup />

      {/* Keyboard-shortcut delete confirmation (Delete / Backspace on a
          selected task, or on the currently-viewed project). Reuses the
          same visual language as DeleteConfirm but with a simple
          Cancel / Delete choice — no name-typing required, matching the
          low-friction expectation of a keyboard shortcut. */}
      {pendingDelete && createPortal(
        <>
          <div className='popup-overlay' onClick={() => setPendingDelete(null)} />
          <div className='popup-shell panel p-0' style={{ maxWidth: 420 }}>
            <div className='p-4 border-b'>
              <div className='text-sm font-semibold'>
                Delete {pendingDelete.kind === 'task' ? 'task' : 'project'}?
              </div>
              <div className='mt-1 text-xs text-zinc-500'>
                <span className='font-medium text-[hsl(var(--foreground))]'>{pendingDelete.name}</span>
                {pendingDelete.kind === 'task'
                  ? ' and all of its subtasks will be permanently removed.'
                  : ' will be permanently removed. Its tasks will be un-assigned but kept.'}
              </div>
            </div>
            <div className='flex items-center justify-end gap-2 px-4 py-3 border-t bg-zinc-50 dark:bg-zinc-900'>
              <button className='btn btn-secondary' onClick={() => setPendingDelete(null)}>Cancel</button>
              <button
                className='btn btn-primary'
                style={{ background: '#dc2626' }}
                onClick={() => {
                  const d = useData.getState()
                  if (pendingDelete.kind === 'task') {
                    d.deleteTask(pendingDelete.id)
                    ui.set({ selected: null, details: false })
                  } else {
                    d.deleteProject(pendingDelete.id)
                    navigate('/projects')
                  }
                  setPendingDelete(null)
                }}
              >
                <Trash2 className='h-4 w-4' /> Delete
              </button>
            </div>
          </div>
        </>,
        document.body
      )}
    </div>
  )
}

/** Install a one-time global override so any legacy `window.alert(msg)`
 *  call anywhere in the app (including future code, third-party libs, or
 *  paste-in snippets) is transparently routed through the themed
 *  AlertDialog instead of showing the raw browser popup. */
function useInstallGlobalAlert() {
  useEffect(() => {
    if (typeof window === 'undefined') return
    const w = window as unknown as { alert: (msg?: unknown) => void; __themedAlertInstalled?: boolean }
    if (w.__themedAlertInstalled) return
    w.__themedAlertInstalled = true
    w.alert = (msg?: unknown) => {
      const text = msg == null ? '' : String(msg)
      // Fire-and-forget: legacy alert() is synchronous but the app already
      // handles its "blocking" nature via the modal overlay + await pattern
      // where needed.
      void showAlert({ title: 'Notice', message: text, kind: 'info' })
    }
  }, [])
}

export default function App() {
  useBootstrap()
  useInstallGlobalAlert()
  const booted = useData(s => s.booted)
  if (!booted) return <div className='h-full flex items-center justify-center text-sm text-zinc-500'>Loading…</div>
  return (
    <ErrorBoundary>
      <Layout />
      <AlertHost />
      <UndoRedoShortcuts />
      <UndoToastHost />
    </ErrorBoundary>
  )
}
