import { useMemo, useState, type FormEvent } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Building2, Layers, Plus, Store, Users } from "lucide-react";
import { AdminShell } from "@/components/admin/AdminShell";
import { PageHeader } from "@/components/admin/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth, useRoles } from "@/hooks/useAuth";
import { useTable } from "@/lib/queries";
import { registerEntity, type RegistrationInput } from "@/lib/registration.functions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/registration")({
  head: () => ({
    meta: [
      { title: "Registration — CBS Core Ledger" },
      { name: "description", content: "Register organizations, clusters, users and merchants in the core banking hierarchy." },
      { property: "og:title", content: "Registration — CBS Core Ledger" },
      { property: "og:description", content: "Admin registration for the Organization, Cluster, User and Merchant hierarchy." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: RegistrationPage,
});

type Kind = "organization" | "cluster" | "user" | "merchant";
type Organization = { id: string; name: string; code: string };
type Cluster = { id: string; name: string; code: string; organization_id: string };

const sections = [
  { kind: "organization", label: "Organization", icon: Building2 },
  { kind: "cluster", label: "Cluster", icon: Layers },
  { kind: "user", label: "User", icon: Users },
  { kind: "merchant", label: "Merchant", icon: Store },
] as const;

const fieldClass = "space-y-1.5";
const selectClass = "flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50";

function Field({ label, name, required, type = "text", placeholder, defaultValue }: { label: string; name: string; required?: boolean; type?: string; placeholder?: string; defaultValue?: string }) {
  return <div className={fieldClass}><Label htmlFor={name}>{label}{required ? " *" : ""}</Label><Input id={name} name={name} required={required} type={type} placeholder={placeholder} defaultValue={defaultValue} /></div>;
}

function RegistrationPage() {
  const [kind, setKind] = useState<Kind>("organization");
  const [organizationId, setOrganizationId] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const { user } = useAuth();
  const { data: roles } = useRoles(user?.id);
  const organizations = useTable<Organization>("organizations", { select: "id,name,code", orderBy: "name", ascending: true });
  const clusters = useTable<Cluster>("clusters", { select: "id,name,code,organization_id", orderBy: "name", ascending: true });
  const register = useServerFn(registerEntity);
  const queryClient = useQueryClient();
  const isAdmin = roles?.includes("admin") ?? false;
  const availableClusters = useMemo(() => (clusters.data ?? []).filter((cluster) => cluster.organization_id === organizationId), [clusters.data, organizationId]);

  function changeKind(next: Kind) {
    setKind(next);
    setOrganizationId("");
    setNotice(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isAdmin) return;
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    let data: RegistrationInput;
    if (kind === "organization") {
      data = { kind, code: String(values["code"]), name: String(values["name"]), legalName: String(values["legalName"] ?? ""), registrationNumber: String(values["registrationNumber"] ?? ""), email: String(values["email"] ?? ""), mobile: String(values["mobile"] ?? ""), address: String(values["address"] ?? ""), currency: String(values["currency"]), timezone: String(values["timezone"]), status: String(values["status"]) as "ACTIVE" };
    } else if (kind === "cluster") {
      data = { kind, organizationId: String(values["organizationId"]), code: String(values["code"]), name: String(values["name"]), region: String(values["region"] ?? ""), status: String(values["status"]) as "ACTIVE" };
    } else if (kind === "user") {
      data = { kind, organizationId: String(values["organizationId"]), clusterId: String(values["clusterId"]), userCode: String(values["userCode"]), fullName: String(values["fullName"]), email: String(values["email"] ?? ""), mobile: String(values["mobile"] ?? ""), kycStatus: String(values["kycStatus"]) as "UNVERIFIED", status: String(values["status"]) as "ACTIVE" };
    } else {
      data = { kind, organizationId: String(values["organizationId"]), clusterId: String(values["clusterId"]), merchantCode: String(values["merchantCode"]), businessName: String(values["businessName"]), legalName: String(values["legalName"] ?? ""), registrationNumber: String(values["registrationNumber"] ?? ""), email: String(values["email"] ?? ""), mobile: String(values["mobile"] ?? ""), businessAddress: String(values["businessAddress"] ?? ""), settlementCycle: String(values["settlementCycle"]), status: String(values["status"]) as "ACTIVE" };
    }
    setBusy(true);
    setNotice(null);
    try {
      const result = await register({ data });
      setNotice({ tone: "success", text: `${result.label} was registered successfully.` });
      form.reset();
      setOrganizationId("");
      await queryClient.invalidateQueries({ queryKey: ["table"] });
      await queryClient.invalidateQueries({ queryKey: ["count"] });
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "Registration failed." });
    } finally {
      setBusy(false);
    }
  }

  return <AdminShell>
    <PageHeader title="Registration" subtitle="Create records in order: Organization → Cluster → User or Merchant." />
    <div className="grid gap-6 xl:grid-cols-[240px_minmax(0,1fr)]">
      <nav className="space-y-1" aria-label="Registration sections">
        {sections.map(({ kind: itemKind, label, icon: Icon }, index) => <Button key={itemKind} type="button" variant={kind === itemKind ? "secondary" : "ghost"} className="h-auto w-full justify-start gap-3 px-3 py-3" onClick={() => changeKind(itemKind)}>
          <span className={cn("figure flex size-7 items-center justify-center rounded border text-xs", kind === itemKind ? "border-primary text-primary" : "border-border text-muted-foreground")}>{index + 1}</span>
          <Icon className="size-4" /> {label}
        </Button>)}
      </nav>
      <section className="panel p-5 sm:p-6">
        <div className="mb-6 border-b border-border pb-4"><p className="label-caps">Register new</p><h2 className="mt-1 text-lg font-semibold capitalize">{kind}</h2></div>
        {!isAdmin && roles ? <div className="rounded-md border border-warning/30 bg-warning/10 p-4 text-sm text-warning">Administrator access is required to register records.</div> : null}
        <form key={kind} onSubmit={submit} className="space-y-5">
          <div className="grid gap-4 md:grid-cols-2">
            {kind !== "organization" ? <div className={fieldClass}><Label htmlFor="organizationId">Organization *</Label><select id="organizationId" name="organizationId" className={selectClass} required value={organizationId} onChange={(e) => setOrganizationId(e.target.value)}><option value="">Select organization</option>{organizations.data?.map((org) => <option key={org.id} value={org.id}>{org.code} · {org.name}</option>)}</select></div> : null}
            {(kind === "user" || kind === "merchant") ? <div className={fieldClass}><Label htmlFor="clusterId">Cluster *</Label><select id="clusterId" name="clusterId" className={selectClass} required disabled={!organizationId}><option value="">Select cluster</option>{availableClusters.map((cluster) => <option key={cluster.id} value={cluster.id}>{cluster.code} · {cluster.name}</option>)}</select></div> : null}
            {kind === "organization" ? <><Field label="Organization code" name="code" required placeholder="ORG-MY02" /><Field label="Organization name" name="name" required /><Field label="Legal name" name="legalName" /><Field label="Registration number" name="registrationNumber" /><Field label="Email" name="email" type="email" /><Field label="Mobile" name="mobile" /><Field label="Currency" name="currency" required defaultValue="MYR" /><Field label="Timezone" name="timezone" required defaultValue="Asia/Kuala_Lumpur" /><div className="space-y-1.5 md:col-span-2"><Label htmlFor="address">Address</Label><Textarea id="address" name="address" /></div></> : null}
            {kind === "cluster" ? <><Field label="Cluster code" name="code" required placeholder="CLS-JHR" /><Field label="Cluster name" name="name" required /><Field label="Region" name="region" /></> : null}
            {kind === "user" ? <><Field label="User code" name="userCode" required placeholder="USR-000004" /><Field label="Full name" name="fullName" required /><Field label="Email" name="email" type="email" /><Field label="Mobile" name="mobile" /><div className={fieldClass}><Label htmlFor="kycStatus">KYC status *</Label><select id="kycStatus" name="kycStatus" className={selectClass} defaultValue="UNVERIFIED"><option value="UNVERIFIED">Unverified</option><option value="PENDING">Pending</option><option value="VERIFIED">Verified</option></select></div></> : null}
            {kind === "merchant" ? <><Field label="Merchant code" name="merchantCode" required placeholder="MRC-000003" /><Field label="Business name" name="businessName" required /><Field label="Legal name" name="legalName" /><Field label="Registration number" name="registrationNumber" /><Field label="Email" name="email" type="email" /><Field label="Mobile" name="mobile" /><Field label="Settlement cycle" name="settlementCycle" required defaultValue="T+1" /><div className="space-y-1.5 md:col-span-2"><Label htmlFor="businessAddress">Business address</Label><Textarea id="businessAddress" name="businessAddress" /></div></> : null}
            <div className={fieldClass}><Label htmlFor="status">Status *</Label><select id="status" name="status" className={selectClass} defaultValue="ACTIVE"><option value="ACTIVE">Active</option><option value="PENDING">Pending</option><option value="SUSPENDED">Suspended</option><option value="CLOSED">Closed</option></select></div>
          </div>
          {notice ? <p role="status" className={cn("rounded-md border p-3 text-sm", notice.tone === "success" ? "border-success/30 bg-success/10 text-success" : "border-destructive/30 bg-destructive/10 text-destructive")}>{notice.text}</p> : null}
          <div className="flex justify-end border-t border-border pt-5"><Button type="submit" disabled={!isAdmin || busy}><Plus className="size-4" />{busy ? "Registering…" : `Register ${kind}`}</Button></div>
        </form>
      </section>
    </div>
  </AdminShell>;
}
