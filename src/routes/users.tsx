import { createFileRoute } from "@tanstack/react-router";
import { AdminShell } from "@/components/admin/AdminShell";
import { DataTable, PageHeader, StatusPill, type Column } from "@/components/admin/primitives";
import { useState } from "react";
import { useTable } from "@/lib/queries";
import { ProfileSheet, STATUS_OPTIONS, useDirectoryFilter, type FilterDef } from "@/components/admin/directory";
import { shortDate } from "@/lib/format";

export const Route = createFileRoute("/users")({
  head: () => ({
    meta: [
      { title: "Users — CBS Core Ledger" },
      {
        name: "description",
        content: "Wallet holders with KYC state, cluster assignment and account status.",
      },
      { property: "og:title", content: "Users — CBS Core Ledger" },
      { property: "og:description", content: "Wallet holders with KYC state and account status." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: UsersPage,
});

type PartyRow = {
  accounts: { account_number: string; account_type: string; wallets: { wallet_number: string }[] | null }[] | null;
};

type Row = {
  id: string;
  user_code: string;
  full_name: string;
  email: string | null;
  mobile: string | null;
  kyc_status: string;
  status: string;
  created_at: string;
  clusters: { name: string } | null;
  parties: PartyRow[] | null;
};

function accountsOf(parties: PartyRow[] | null) {
  return (parties ?? []).flatMap((p) => p.accounts ?? []);
}

function AccountCell({ parties }: { parties: PartyRow[] | null }) {
  const accounts = accountsOf(parties);
  if (!accounts.length) return <span className="text-muted-foreground">Not assigned</span>;
  return (
    <div className="space-y-1">
      {accounts.map((a) => (
        <div key={a.account_number}>
          <p className="figure text-xs">{a.account_number}</p>
          <p className="text-[11px] text-muted-foreground">
            {a.account_type}
            {a.wallets?.length ? ` · ${a.wallets[0]!.wallet_number}` : ""}
          </p>
        </div>
      ))}
    </div>
  );
}

const columns: Column<Row>[] = [
  { header: "User code", cell: (r) => <span className="figure text-xs">{r.user_code}</span> },
  { header: "Name", cell: (r) => <span className="font-medium">{r.full_name}</span> },
  { header: "Account no.", cell: (r) => <AccountCell parties={r.parties} /> },
  {
    header: "Contact",
    cell: (r) => (
      <div>
        <p>{r.email ?? "—"}</p>
        <p className="figure text-xs text-muted-foreground">{r.mobile ?? "—"}</p>
      </div>
    ),
  },
  { header: "Cluster", cell: (r) => r.clusters?.name ?? "—" },
  { header: "KYC", cell: (r) => <StatusPill value={r.kyc_status} /> },
  { header: "Status", cell: (r) => <StatusPill value={r.status} /> },
  { header: "Registered", align: "right", cell: (r) => shortDate(r.created_at) },
];

function UsersPage() {
  const { data, isLoading } = useTable<Row>("users", {
    select:
      "id,user_code,full_name,email,mobile,kyc_status,status,created_at,clusters(name),parties(accounts(account_number,account_type,wallets(wallet_number)))",
  });
  const [openId, setOpenId] = useState<string | null>(null);
  const { filtered, toolbar } = useDirectoryFilter(data, TEXT, FILTERS);
  return (
    <AdminShell>
      <PageHeader title="Users" subtitle="Individual wallet holders registered under an organization and cluster." />
      {toolbar}
      <DataTable columns={columns} rows={filtered} onRowClick={(r) => setOpenId(r.id)} loading={isLoading} empty="No users registered." />
      <ProfileSheet kind="user" id={openId} onClose={() => setOpenId(null)} onOpenUser={setOpenId} />
    </AdminShell>
  );
}

const TEXT = (r: Row) => `${r.full_name} ${r.user_code} ${r.email ?? ""} ${r.mobile ?? ""}`;
const FILTERS: FilterDef<Row>[] = [{ key: "status", label: "Statuses", options: STATUS_OPTIONS, get: (r) => r.status }, { key: "kyc", label: "KYC", options: ["VERIFIED", "PENDING", "UNVERIFIED"], get: (r) => r.kyc_status }];
