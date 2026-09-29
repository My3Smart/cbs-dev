import { useMemo, useState, type ReactNode } from "react";
import { Search } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { StatusPill } from "@/components/admin/primitives";
import { addDependent, getProfile, type ProfileKind } from "@/lib/profiles.functions";
import { dateTime, money } from "@/lib/format";

/* ---------- Search + filter ---------- */

export type FilterDef<T> = { key: string; label: string; options: string[]; get: (row: T) => string | null | undefined };

export function useDirectoryFilter<T>(rows: T[] | undefined, text: (row: T) => string, filters: FilterDef<T>[]) {
  const [q, setQ] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (rows ?? []).filter(
      (r) =>
        (!needle || text(r).toLowerCase().includes(needle)) &&
        filters.every((f) => !values[f.key] || f.get(r) === values[f.key]),
    );
  }, [rows, q, values, text, filters]);

  const toolbar = (
    <div className="panel flex flex-wrap items-center gap-3 p-3">
      <div className="relative min-w-[240px] flex-1">
        <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or code…" className="pl-8" />
      </div>
      {filters.map((f) => (
        <select
          key={f.key}
          value={values[f.key] ?? ""}
          onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
          className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground"
          aria-label={f.label}
        >
          <option value="">All {f.label.toLowerCase()}</option>
          {f.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      ))}
      <span className="text-xs text-muted-foreground">
        {filtered.length} of {rows?.length ?? 0}
      </span>
    </div>
  );
  return { filtered, toolbar };
}

export const STATUS_OPTIONS = ["ACTIVE", "PENDING", "SUSPENDED", "CLOSED"];

/* ---------- Profile sheet ---------- */

const HIDDEN = new Set(["id", "organization_id", "cluster_id", "parties", "clusters", "organizations"]);

function label(key: string) {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function Field({ k, v }: { k: string; v: unknown }) {
  let display: ReactNode = v == null || v === "" ? "—" : String(v);
  if (k === "status" || k === "kyc_status") display = <StatusPill value={v as string} />;
  else if (k.endsWith("_at") && v) display = dateTime(v as string);
  return (
    <div className="border-b border-border/60 py-2">
      <p className="label-caps">{label(k)}</p>
      <div className="mt-0.5 text-sm text-foreground break-words">{display}</div>
    </div>
  );
}

export function ProfileSheet({
  kind,
  id,
  onClose,
  onOpenUser,
}: {
  kind: ProfileKind;
  id: string | null;
  onClose: () => void;
  onOpenUser?: (id: string) => void;
}) {
  const fetchProfile = useServerFn(getProfile);
  const [addOpen, setAddOpen] = useState(false);
  const { data, isLoading, error } = useQuery({
    queryKey: ["profile", kind, id],
    queryFn: () => fetchProfile({ data: { kind, id: id! } }),
    enabled: !!id,
  });
  const rec = data?.record ?? {};
  const title =
    (rec["full_name"] as string) || (rec["business_name"] as string) || (rec["name"] as string) || "Profile";

  return (
    <Sheet open={!!id} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription className="capitalize">{kind} profile</SheetDescription>
        </SheetHeader>

        {isLoading ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>
        ) : error ? (
          <p className="py-10 text-center text-sm text-destructive">{(error as Error).message}</p>
        ) : data ? (
          <div className="mt-4 space-y-6 px-4 pb-8">
            {data.guardian ? (
              <div className="panel p-3 text-sm">
                <p className="label-caps">Dependent of</p>
                <button className="mt-1 font-medium text-primary hover:underline" onClick={() => onOpenUser?.(data.guardian!.id)}>
                  {data.guardian.full_name} ({data.guardian.user_code})
                </button>
                <span className="ml-2 text-xs text-muted-foreground">{data.guardian.relationship}</span>
              </div>
            ) : null}

            {data.stats.length ? (
              <div className="grid grid-cols-3 gap-3">
                {data.stats.map((s) => (
                  <div key={s.label} className="panel p-3">
                    <p className="label-caps">{s.label}</p>
                    <p className="figure mt-1 text-xl font-semibold">{s.value}</p>
                  </div>
                ))}
              </div>
            ) : null}

            {kind !== "cluster" ? (
              <section>
                <h3 className="mb-2 text-sm font-semibold">Accounts & balance</h3>
                {data.accounts.length ? (
                  data.accounts.map((a) => (
                    <div key={a.account_number} className="panel mb-2 p-3">
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span className="figure">{a.account_number}</span>
                        <span>
                          {a.account_type}
                          {a.wallet_number ? ` · ${a.wallet_number}` : ""}
                        </span>
                      </div>
                      <p className="figure mt-2 text-2xl font-semibold text-primary">
                        {money(a.available_balance ?? 0, a.currency ?? "MYR")}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Pending {money(a.pending_balance ?? 0, a.currency ?? "MYR")} · Held{" "}
                        {money(a.held_balance ?? 0, a.currency ?? "MYR")}
                      </p>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">No account assigned.</p>
                )}
              </section>
            ) : null}

            {kind === "user" && !data.guardian ? (
              <section>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-sm font-semibold">Dependents ({data.dependents.length})</h3>
                  <Button size="sm" onClick={() => setAddOpen(true)}>
                    Add dependency
                  </Button>
                </div>
                {data.dependents.length ? (
                  <div className="panel divide-y divide-border/60">
                    {data.dependents.map((d) => (
                      <button
                        key={d.id}
                        onClick={() => onOpenUser?.(d.id)}
                        className="flex w-full items-center justify-between p-3 text-left text-sm hover:bg-accent/40"
                      >
                        <div>
                          <p className="font-medium">{d.full_name}</p>
                          <p className="text-xs text-muted-foreground">
                            {d.user_code} · {d.relationship}
                            {d.date_of_birth ? ` · born ${String(d.date_of_birth).slice(0, 10)}` : ""}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="figure">{money(d.available_balance ?? 0)}</p>
                          <p className="figure text-[11px] text-muted-foreground">{d.wallet_number ?? "No wallet"}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No dependents registered under this user.</p>
                )}
              </section>
            ) : null}

            <section>
              <h3 className="mb-1 text-sm font-semibold">Details</h3>
              {Object.entries(rec)
                .filter(([k, v]) => !HIDDEN.has(k) && typeof v !== "object")
                .map(([k, v]) => (
                  <Field key={k} k={k} v={v} />
                ))}
            </section>
          </div>
        ) : null}

        {kind === "user" && id ? (
          <AddDependentDialog guardianId={id} open={addOpen} onOpenChange={setAddOpen} />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function AddDependentDialog({
  guardianId,
  open,
  onOpenChange,
}: {
  guardianId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const add = useServerFn(addDependent);
  const qc = useQueryClient();
  const empty = { userCode: "", fullName: "", relationship: "CHILD", dateOfBirth: "", email: "", mobile: "", kycStatus: "UNVERIFIED" };
  const [form, setForm] = useState(empty);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof empty) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await add({ data: { guardianId, ...form } as never });
      toast.success(`Dependent registered · ${r.accountNumber}`);
      setForm(empty);
      onOpenChange(false);
      qc.invalidateQueries({ queryKey: ["profile"] });
      qc.invalidateQueries({ queryKey: ["table"] });
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const input = "h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Register dependent</DialogTitle>
          <DialogDescription>
            Creates a child account under this user, with its own account number and wallet.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid grid-cols-2 gap-3">
          <label className="col-span-2 text-sm">
            Full name *
            <Input required value={form.fullName} onChange={set("fullName")} />
          </label>
          <label className="text-sm">
            User code *
            <Input required value={form.userCode} onChange={set("userCode")} placeholder="e.g. U1-D2" />
          </label>
          <label className="text-sm">
            Relationship
            <select className={input} value={form.relationship} onChange={set("relationship")}>
              {["CHILD", "SPOUSE", "PARENT", "SIBLING", "OTHER"].map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Date of birth
            <Input type="date" value={form.dateOfBirth} onChange={set("dateOfBirth")} />
          </label>
          <label className="text-sm">
            KYC status
            <select className={input} value={form.kycStatus} onChange={set("kycStatus")}>
              {["UNVERIFIED", "PENDING", "VERIFIED"].map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Email
            <Input type="email" value={form.email} onChange={set("email")} />
          </label>
          <label className="text-sm">
            Mobile
            <Input value={form.mobile} onChange={set("mobile")} />
          </label>
          <DialogFooter className="col-span-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Registering…" : "Register dependent"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
