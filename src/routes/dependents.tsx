import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AdminShell } from "@/components/admin/AdminShell";
import { DataTable, PageHeader, StatusPill, type Column } from "@/components/admin/primitives";
import { ProfileSheet, STATUS_OPTIONS, useDirectoryFilter, type FilterDef } from "@/components/admin/directory";
import { listDependents, type DependentRow } from "@/lib/cards.functions";
import { money } from "@/lib/format";

export const Route = createFileRoute("/dependents")({
  head: () => ({
    meta: [
      { title: "Dependents — CBS Core Ledger" },
      { name: "description", content: "Search dependent accounts, their guardians and tagged NFC cards." },
      { property: "og:title", content: "Dependents — CBS Core Ledger" },
      { property: "og:description", content: "Dependent accounts with guardian and NFC card details." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DependentsPage,
});

const TEXT = (r: DependentRow) => `${r.full_name} ${r.user_code} ${r.guardian_name} ${r.guardian_code} ${r.card_uid ?? ""}`;
const FILTERS: FilterDef<DependentRow>[] = [
  { key: "status", label: "Statuses", options: STATUS_OPTIONS, get: (r) => r.status },
  { key: "rel", label: "Relationships", options: ["CHILD", "SPOUSE", "PARENT", "SIBLING", "OTHER"], get: (r) => r.relationship },
  { key: "card", label: "Cards", options: ["TAGGED", "NO CARD"], get: (r) => (r.card_uid ? "TAGGED" : "NO CARD") },
];

function DependentsPage() {
  const fetchList = useServerFn(listDependents);
  const { data, isLoading } = useQuery({ queryKey: ["dependents"], queryFn: () => fetchList() });
  const [openId, setOpenId] = useState<string | null>(null);
  const { filtered, toolbar } = useDirectoryFilter(data, TEXT, FILTERS);

  const columns: Column<DependentRow>[] = [
    { header: "User code", cell: (r) => <span className="figure text-xs">{r.user_code}</span> },
    { header: "Name", cell: (r) => <span className="font-medium">{r.full_name}</span> },
    {
      header: "Parent",
      cell: (r) => (
        <button
          className="text-primary hover:underline"
          onClick={(e) => {
            e.stopPropagation();
            setOpenId(r.guardian_id);
          }}
        >
          {r.guardian_name} <span className="figure text-xs text-muted-foreground">({r.guardian_code})</span>
        </button>
      ),
    },
    { header: "Relationship", cell: (r) => r.relationship },
    { header: "Account no.", cell: (r) => <span className="figure text-xs">{r.account_number ?? "Not assigned"}</span> },
    { header: "Card", cell: (r) => (r.card_uid ? <span className="figure text-xs">{r.card_uid}</span> : <span className="text-muted-foreground">No card</span>) },
    { header: "Status", cell: (r) => <StatusPill value={r.status} /> },
    { header: "Balance", align: "right", cell: (r) => <span className="figure">{money(r.available_balance ?? 0)}</span> },
  ];

  return (
    <AdminShell>
      <PageHeader title="Dependents" subtitle="Child accounts registered under a parent user, with tagged NFC cards." />
      {toolbar}
      <DataTable columns={columns} rows={filtered} onRowClick={(r) => setOpenId(r.id)} loading={isLoading} empty="No dependents registered." />
      <ProfileSheet kind="user" id={openId} onClose={() => setOpenId(null)} onOpenUser={setOpenId} />
    </AdminShell>
  );
}
