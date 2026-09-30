import {
  AlertTriangle, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Ban, BarChart3,
  Bot, BookOpen, BookOpenText, Calendar, Camera, Check, ChevronDown, ChevronRight, Clipboard, Clock, Copy, Dices,
  Download, Eye, FerrisWheel, FileText, FolderOpen, Gamepad2, Globe, Hash, Home, Hourglass,
  Image, Inbox, Laptop, LayoutGrid, Lightbulb, Link2, MapPin, Menu, MessageSquare, Monitor,
  Moon, Package, Palette, PartyPopper, Pause, PenLine, Play, Plus, Quote, Rocket, RotateCcw, Save,
  ScrollText, Search, Settings, Smartphone, Sparkles, Sun, Table2, Target, Theater, Trash2,
  TrendingUp, Upload, User, X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

const MAP = {
  alert: AlertTriangle,
  arrowDown: ArrowDown,
  arrowUp: ArrowUp,
  back: ArrowLeft,
  ban: Ban,
  forward: ArrowRight,
  bot: Bot,
  book: BookOpen,
  bookText: BookOpenText,
  box: Package,
  camera: Camera,
  chartBar: BarChart3,
  calendar: Calendar, // 📅
  check: Check,
  chevronDown: ChevronDown,
  chevronRight: ChevronRight,
  clipboard: Clipboard, // 📋
  clock: Clock,
  copy: Copy,
  dices: Dices,
  download: Download,
  eye: Eye, // 👁
  wheel: FerrisWheel,
  fileText: FileText,
  folder: FolderOpen,
  gamepad: Gamepad2,
  globe: Globe,
  hash: Hash,
  hourglass: Hourglass,
  home: Home, // 🏠
  image: Image,
  inbox: Inbox, // 📭
  laptop: Laptop,
  layoutGrid: LayoutGrid,
  lightbulb: Lightbulb,
  link: Link2,
  menu: Menu,
  message: MessageSquare,
  monitor: Monitor, // 🖥️
  moon: Moon, // 🌙
  palette: Palette,
  party: PartyPopper,
  pause: Pause,
  pen: PenLine,
  play: Play,
  plus: Plus,
  pin: MapPin,
  quote: Quote,
  refresh: RotateCcw,
  rocket: Rocket,
  save: Save,
  scroll: ScrollText,
  search: Search,
  settings: Settings,
  smartphone: Smartphone,
  sparkles: Sparkles,
  sun: Sun, // ☀️
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