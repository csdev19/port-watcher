import {
  Search,
  X,
  Lock,
  Settings,
  ExternalLink,
  Copy,
  Folder,
  Plus,
  RotateCcw,
  CircleCheck,
  SearchX,
  TriangleAlert,
  Eye,
  ChevronRight,
  type LucideIcon,
} from "lucide-react";

/** Lucide substitution (spec §10 of DESIGN.md): stroke 1.75, not the
 * library's default 2 — Niway/chapay thins it deliberately. Keeping the
 * whole substitution behind this one wrapper is what the spec asks for. */
const ICONS: Record<string, LucideIcon> = {
  search: Search,
  x: X,
  lock: Lock,
  settings: Settings,
  "external-link": ExternalLink,
  copy: Copy,
  folder: Folder,
  plus: Plus,
  "rotate-ccw": RotateCcw,
  "circle-check": CircleCheck,
  "search-x": SearchX,
  "triangle-alert": TriangleAlert,
  eye: Eye,
  "chevron-right": ChevronRight,
};

export type IconName = keyof typeof ICONS;

interface Props {
  name: IconName;
  size?: number;
}

export function Icon({ name, size = 14 }: Props) {
  const Glyph = ICONS[name];
  return <Glyph size={size} strokeWidth={1.75} aria-hidden />;
}
