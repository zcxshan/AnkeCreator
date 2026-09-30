import {
  AlertTriangle, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, BarChart3,
  Bot, BookOpen, BookOpenText, Camera, Check, Clock, Copy, Dices,
  Download, FerrisWheel, FileText, FolderOpen, Gamepad2, Globe, Hourglass,
  Image, Laptop, LayoutGrid, Lightbulb, Link2, MapPin, Menu, Package,
  Palette, PartyPopper, PenLine, Quote, Rocket, RotateCcw, Save,
  ScrollText, Search, Settings, Sparkles, Table2, Target, Theater, Trash2,
  TrendingUp, Upload, User, X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

const MAP = {
  alert: AlertTriangle,
  arrowDown: ArrowDown,
  arrowUp: ArrowUp,
  back: ArrowLeft,
  forward: ArrowRight,
  bot: Bot,
  book: BookOpen,
  bookText: BookOpenText,
  box: Package,
  camera: Camera,
  chartBar: BarChart3,
  check: Check,
  clock: Clock,
  copy: Copy,
  dices: Dices,
  download: Download,
  wheel: FerrisWheel,
  fileText: FileText,
  folder: FolderOpen,
  gamepad: Gamepad2,
  globe: Globe,
  hourglass: Hourglass,
  image: Image,
  laptop: Laptop,
  layoutGrid: LayoutGrid,
  lightbulb: Lightbulb,
  link: Link2,
  menu: Menu,
  palette: Palette,
  party: PartyPopper,
  pen: PenLine,
  pin: MapPin,
  quote: Quote,
  refresh: RotateCcw,
  rocket: Rocket,
  save: Save,
  scroll: ScrollText,
  search: Search,
  settings: Settings,
  sparkles: Sparkles,
  table: Table2,
  target: Target,
  theater: Theater, // 🎭
  trash: Trash2,
  trendingUp: TrendingUp,
  upload: Upload,
  user: User,
  x: X,
} as const

export type IconName = keyof typeof MAP

export function Icon({
  name, size = 16, className,
}: { name: IconName; size?: number; className?: string }) {
  const Cmp: LucideIcon = MAP[name] ?? ArrowRight
  return <Cmp size={size} className={className} strokeWidth={2} aria-hidden="true" />
}