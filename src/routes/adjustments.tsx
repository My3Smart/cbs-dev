import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AdminShell } from "@/components/admin/AdminShell";
import { DataTable, PageHeader, StatusPill, type Column } from "@/components/admin/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { adjustBalance, searchHolders, type Holder } from "@/lib/adjustments.functions";
import { useRoles } from "@/hooks/useAuth";
import { useTable } from "@/lib/queries";
import { amount, dateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/adjustments")({
  head: () => ({
    meta: [
      { title: "Debit & Credit from System — CBS Core Ledger" },
      { name: "description", content: "Admins search users and merchants by name and debit or credit their wallet balance." },
      { property: "og:title", content: "Debit & Credit from System — CBS Core Ledger" },
      { property: "og:description", content: "Search account holders by name and post system debits or credits." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AdjustmentsPage,
});

type Txn = { reference: string; transaction_type: string; status: string; amount: string; currency: string; description: string | null; created_at: string };

const txnColumns: Column<Txn>[] = [
  { header: "Reference", cell: (r) => <span className="figure text-xs">{r.reference}</span> },
  {
    header: "Type",
    cell: (r) => (
      <span className={cn("text-xs font-medium", r.transaction_type === "CREDIT_FROM_SYSTEM" ? "text-credit" : "text-debit")}>
        {r.transaction_type === "CREDIT_FROM_SYSTEM" ? "Credit from system" : "Debit from system"}
      </span>
    ),
  },
  { header: "Description", cell: (r) => <span className="text-xs text-muted-foreground">{r.description}</span> },
  { header: "Amount", align: "right", cell: (r) => <span className="figure">{r.currency} {amount(r.amount)}</span> },
  { header: "Status", cell: (r) => <StatusPill value={r.status} /> },
  { header: "Posted", cell: (r) => <span className="text-xs">{dateTime(r.created_at)}</span> },
];

function AdjustmentsPage() {
  const qc = useQueryClient();
  const { data: roles } = useRoles();
  const isAdmin = roles?.includes("admin") ?? false;
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Holder | null>(null);
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const search = useServerFn(searchHolders);
  const adjust = useServerFn(adjustBalance);

  const holders = useQuery({ queryKey: ["holders", q], queryFn: () => search({ data: { q } }) });
  const txns = useTable<Txn>("transactions", {
    select: "reference,transaction_type,status,amount,currency,description,created_at",
    limit: 300,
  });
  const recent = (txns.data ?? []).filter((t) => t.transaction_type.endsWith("_FROM_SYSTEM")).slice(0, 20);
  const current = selected ? (holders.data?.find((h) => h.party_id === selected.party_id) ?? selected) : null;

  async function run(direction: "DEBIT" | "CREDIT") {
    if (!current) return;
    const n = Number(value);
    if (!(n > 0)) {
      toast.error("Enter an amount greater than 0.");
      return;
    }
    setBusy(true);
    try {
      const res = await adjust({ data: { partyId: current.party_id, amount: n, direction, ...(note ? { note } : {}) } });
      toast.success(`${res.label}: ${res.currency} ${amount(n)}. New balance ${res.currency} ${amount(res.balance)}`);
      setValue("");
      setNote("");
      await Promise.all([qc.invalidateQueries({ queryKey: ["holders"] }), qc.invalidateQueries({ queryKey: ["table"] })]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not post.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminShell>
      <PageHeader title="Debit / Credit from system" subtitle="Search a user or merchant by name, pick them, then debit or credit their wallet." />
      {!isAdmin && roles ? (
        <div className="rounded-md border border-warning/30 bg-warning/10 p-4 text-sm text-warning">Administrator access is required.</div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="panel p-4">
          <Label htmlFor="q">Search by name</Label>
          <Input id="q" className="mt-1.5" placeholder="e.g. Aisyah" value={q} onChange={(e) => setQ(e.target.value)} />
          <ul className="mt-3 max-h-[420px] divide-y divide-border overflow-y-auto">
            {holders.isLoading ? <li className="py-3 text-sm text-muted-foreground">Searching…</li> : null}
            {holders.error ? <li className="py-3 text-sm text-warning">{(holders.error as Error).message}</li> : null}
            {holders.data?.length === 0 ? <li className="py-3 text-sm text-muted-foreground">No one matches that name.</li> : null}
            {holders.data?.map((h) => (
              <li key={h.party_id}>
                <button
                  type="button"
                  onClick={() => setSelected(h)}
                  className={cn(
                    "flex w-full items-center justify-between gap-3 px-2 py-2.5 text-left text-sm hover:bg-accent/50",
                    current?.party_id === h.party_id && "bg-accent",
                  )}
                >
                  <span>
                    <span className="font-medium">{h.name}</span>
                    <span className="ml-2 label-caps">{h.party_type === "USER" ? "User" : "Merchant"}</span>
                    <span className="block figure text-xs text-muted-foreground">{h.account_number ?? "No account yet"}</span>
                  </span>
                  <span className="figure text-xs">{h.currency ?? "MYR"} {amount(h.available_balance ?? 0)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="panel p-5">
          {current ? (
            <div className="space-y-4">
              <div>
                <p className="label-caps">{current.party_type === "USER" ? "User" : "Merchant"} · {current.code}</p>
                <p className="text-lg font-semibold">{current.name}</p>
                <p className="figure text-xs text-muted-foreground">
                  {current.account_number ?? "Account will be created on first posting"}
                  {current.wallet_number ? ` · ${current.wallet_number}` : ""}
                </p>
              </div>
              <div className="rounded-md border border-border p-4">
                <p className="label-caps">Available balance</p>
                <p className="figure text-2xl font-semibold">{current.currency ?? "MYR"} {amount(current.available_balance ?? 0)}</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="amt">Amount</Label>
                <Input id="amt" type="number" min="0.01" step="0.01" value={value} onChange={(e) => setValue(e.target.value)} placeholder="0.00" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="note">Note (optional)</Label>
                <Input id="note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Button variant="destructive" disabled={busy || !isAdmin} onClick={() => run("DEBIT")}>Debit</Button>
                <Button disabled={busy || !isAdmin} onClick={() => run("CREDIT")}>Credit</Button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Pick a user or merchant from the list to see their balance.</p>
          )}
        </div>
      </div>

      <div>
        <h2 className="mb-3 text-sm font-semibold">Recent system debits & credits</h2>
        <DataTable columns={txnColumns} rows={recent} loading={txns.isLoading} empty="No system postings yet." />
      </div>
    </AdminShell>
  );
}
