import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { ROUTES } from "@/lib/constants";

interface OfflinePlayShellProps {
  children: ReactNode;
}

export function OfflinePlayShell({ children }: OfflinePlayShellProps) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-3 border-b border-border/60 px-4 py-2 sm:px-6">
        <Link
          to={ROUTES.PLAY}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Workbench
        </Link>
        <span className="text-xs font-semibold">Test setup</span>
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}
