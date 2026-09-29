import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-5">
      <div>
        <h1 className="text-xl font-semibold text-foreground">{title}</h1>
        {subtitle ? <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function StatCard({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "credit" | "debit" | "primary";
}) {
  const toneClass =
    tone === "credit"
      ? "text-credit"
      : tone === "debit"
        ? "text-debit"
        : tone === "primary"
          ? "text-primary"
          : "text-foreground";
  return (
    <div className="panel p-4">
      <p className="label-caps">{label}</p>
      <p className={cn("figure mt-2 text-2xl font-semibold", toneClass)}>{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

const statusTones: Record<string, string> = {
  ACTIVE: "bg-success/15 text-success border-success/30",
  POSTED: "bg-success/15 text-success border-success/30",
  VERIFIED: "bg-success/15 text-success border-success/30",
  PENDING: "bg-warning/15 text-warning border-warning/30",
  UNVERIFIED: "bg-warning/15 text-warning border-warning/30",
  SUSPENDED: "bg-destructive/15 text-destructive border-destructive/30",
  FAILED: "bg-destructive/15 text-destructive border-destructive/30",
  CLOSED: "bg-muted text-muted-foreground border-border",
  REVERSED: "bg-muted text-muted-foreground border-border",
};

export function StatusPill({ value }: { value?: string | null }) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold tracking-wide",
        statusTones[value] ?? "bg-secondary text-secondary-foreground border-border",
      )}
    >
      {value}
    </span>
  );
}

export type Column<T> = {
  header: string;
  cell: (row: T) => ReactNode;
  align?: "left" | "right";
  className?: string;
};

export function DataTable<T>({
  columns,
  rows,
  empty = "No records yet.",
  loading = false,
  onRowClick,
}: {
  columns: Column<T>[];
  rows: T[] | undefined;
  empty?: string;
  loading?: boolean;
  onRowClick?: (row: T) => void;
}) {
  return (
    <div className="panel overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-background/40">
              {columns.map((col) => (
                <th
                  key={col.header}
                  className={cn(
                    "label-caps px-4 py-3 text-left whitespace-nowrap",
                    col.align === "right" && "text-right",
                  )}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-10 text-center text-muted-foreground">
                  Loading…
                </td>
              </tr>
            ) : !rows?.length ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-10 text-center text-muted-foreground">
                  {empty}
                </td>
              </tr>
            ) : (
              rows.map((row, index) => (
                <tr
                  key={index}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={cn(
                    "border-b border-border/60 last:border-0 transition-colors hover:bg-accent/40",
                    onRowClick && "cursor-pointer",
                  )}
                >
                  {columns.map((col) => (
                    <td
                      key={col.header}
                      className={cn(
                        "px-4 py-3 align-middle",
                        col.align === "right" && "text-right",
                        col.className,
                      )}
                    >
                      {col.cell(row)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
