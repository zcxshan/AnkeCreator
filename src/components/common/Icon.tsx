import {
  ArrowLeft, ArrowRight, Bot, BookOpen, BookOpenText, Clock, Copy,
  Dices, Download, FerrisWheel, FileText, FolderOpen, PartyPopper,
  PenLine, RotateCcw, Save, ScrollText, Search, Target, Trash2, Upload,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

const MAP = {
  back: ArrowLeft,
  forward: ArrowRight,
  bot: Bot,
  book: BookOpen,
  bookText: BookOpenText,
  clock: Clock,
  copy: Copy,
  dices: Dices,
  download: Download,
  wheel: FerrisWheel,
  fileText: FileText,
  folder: FolderOpen,
  party: PartyPopper,
  pen: PenLine,
  refresh: RotateCcw,
  save: Save,
  scroll: ScrollText,
  search: Search,
  target: Target,
  trash: Trash2,
  upload: Upload,
} as const

export type IconName = keyof typeof MAP

export function Icon({
  name, size = 16, className,
}: { name: IconName; size?: number; className?: string }) {
  const Cmp: LucideIcon = MAP[name] ?? ArrowRight
  return <Cmp size={size} className={className} strokeWidth={2} aria-hidden="true" />
}