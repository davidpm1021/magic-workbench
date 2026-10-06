import type { ComponentType } from "react";
import { Info, Layers, Settings, Swords } from "lucide-react";
import { ROUTES } from "@/lib/constants";

export interface NavDestination {
  to: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  external?: boolean;
}

export function isNavDestinationActive(to: string, pathname: string): boolean {
  pathname = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (to === ROUTES.PLAY) {
    return pathname === ROUTES.PLAY || pathname.startsWith("/game/");
  }
  return pathname === to || pathname.startsWith(`${to}/`);
}

export function getTopBarNav(_signedIn = false): NavDestination[] {
  return [
    { to: ROUTES.PLAY, label: "Workbench", icon: Swords },
    { to: ROUTES.DECK_EDITOR, label: "My Decks", icon: Layers },
  ];
}

export function getMoreDestinations(): NavDestination[] {
  return [
    { to: ROUTES.SETTINGS, label: "Settings", icon: Settings },
    { to: ROUTES.ABOUT, label: "About", icon: Info },
  ];
}
