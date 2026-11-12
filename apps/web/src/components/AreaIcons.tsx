import { AREA_COLORS, type AreaColorId, type AreaIconId } from '@dingen/core'
import {
  Archive,
  Baby,
  Bike,
  Bitcoin,
  BookOpen,
  Bot,
  Briefcase,
  Building,
  Calendar,
  Camera,
  Car,
  ClipboardList,
  Code,
  Coffee,
  Cpu,
  Dog,
  Dumbbell,
  Flag,
  Folder,
  Gamepad2,
  Gift,
  Globe,
  GraduationCap,
  Guitar,
  Hammer,
  Heart,
  HeartPulse,
  House,
  Landmark,
  Laptop,
  Lightbulb,
  type LucideIcon,
  Palette,
  PenLine,
  PiggyBank,
  Plane,
  Receipt,
  Server,
  Shield,
  ShoppingCart,
  Sprout,
  Star,
  Sun,
  Trees,
  Users,
  Utensils,
  Wallet,
  Wrench,
  Zap,
} from 'lucide-react'
import { AreaIcon as DefaultAreaIcon } from './Icons.js'

/** Drawing per icon id from `AREA_ICONS` in core. */
export const AREA_ICON_COMPONENTS: Record<AreaIconId, LucideIcon> = {
  home: House,
  briefcase: Briefcase,
  building: Building,
  heart: Heart,
  'heart-pulse': HeartPulse,
  dumbbell: Dumbbell,
  wrench: Wrench,
  hammer: Hammer,
  server: Server,
  cpu: Cpu,
  bot: Bot,
  code: Code,
  laptop: Laptop,
  wallet: Wallet,
  'piggy-bank': PiggyBank,
  bitcoin: Bitcoin,
  landmark: Landmark,
  receipt: Receipt,
  'book-open': BookOpen,
  'graduation-cap': GraduationCap,
  'pen-line': PenLine,
  palette: Palette,
  camera: Camera,
  music: Guitar,
  gamepad: Gamepad2,
  plane: Plane,
  car: Car,
  bike: Bike,
  trees: Trees,
  sprout: Sprout,
  sun: Sun,
  dog: Dog,
  baby: Baby,
  users: Users,
  'shopping-cart': ShoppingCart,
  utensils: Utensils,
  coffee: Coffee,
  gift: Gift,
  calendar: Calendar,
  'clipboard-list': ClipboardList,
  folder: Folder,
  archive: Archive,
  globe: Globe,
  zap: Zap,
  shield: Shield,
  lightbulb: Lightbulb,
  star: Star,
  flag: Flag,
}

/** Returns the id when it is a known colour, otherwise null (the default). */
export function knownColor(color: string | null): AreaColorId | null {
  return AREA_COLORS.find((c) => c === color) ?? null
}

/** CSS colour for an area colour id; unknown ids and null are the muted default. */
export function areaColorVar(color: string | null): string {
  const id = knownColor(color)
  return id === null || id === 'gray' ? 'var(--muted)' : `var(--area-${id})`
}

interface Props {
  icon: string | null
  color: string | null
  size?: number
  className?: string
}

/** An area's icon in its colour; unknown icons render as the default one. */
export function AreaGlyph({ icon, color, size = 18, className }: Props) {
  const Icon = icon === null ? undefined : AREA_ICON_COMPONENTS[icon as AreaIconId]
  return (
    <span className={className} style={{ color: areaColorVar(color), display: 'inline-flex' }}>
      {Icon ? (
        <Icon size={size} strokeWidth={1.8} aria-hidden="true" />
      ) : (
        <DefaultAreaIcon size={size} />
      )}
    </span>
  )
}
