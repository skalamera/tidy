import {
  BriefcaseBusiness,
  FileStack,
  Flag,
  HandCoins,
  Landmark,
  MapPinned,
  Printer,
  ShieldCheck,
  TrendingUp,
  UserRound,
  type LucideIcon,
} from 'lucide-react';

/** Section icons are named in src/core/sections.ts; this maps the names to lucide components. */
const ICONS: Record<string, LucideIcon> = {
  BriefcaseBusiness,
  FileStack,
  Flag,
  HandCoins,
  Landmark,
  MapPinned,
  Printer,
  ShieldCheck,
  TrendingUp,
  UserRound,
};

export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const C = ICONS[name] ?? Flag;
  return <C size={size} aria-hidden />;
}
