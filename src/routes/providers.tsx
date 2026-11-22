import { useState, type FormEvent } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { PlugZap, TestTube2 } from "lucide-react";
import { AdminShell } from "@/components/admin/AdminShell";
import { DataTable, PageHeader, StatusPill, type Column } from "@/components/admin/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth, useRoles } from "@/hooks/useAuth";
import { useTable } from "@/lib/queries";
import {
  addApiPaymentProvider,
  addSandboxPaymentProvider,
  testPaymentProvider,
} from "@/lib/providers.functions";
import { cn } from "@/lib/utils";
import { PlugAndPlayPanel } from "@/components/admin/PlugAndPlayPanel";

export const Route = createFileRoute("/providers")({
  head: () => ({
    meta: [
      { title: "Plug and Play API and Sandbox — CBS Core Ledger" },
      {
        name: "description",
        content: "Connect any payment provider API or sandbox, set routing priority and manage payment methods.",
      },
      { property: "og:title", content: "Plug and Play API and Sandbox — CBS Core Ledger" },
      { property: "og:description", content: "Connect payment provider APIs and sandboxes for wallet reloads." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ProvidersPage,
});

type ProviderRow = {
  id: string;
  code: string;
  name: string;
  priority: number;
  enabled: boolean;
  environment: string;
  status: string;
  api_base_url: string | null;
  sandbox_base_url: string | null;
  auth_type: string;
  credential_secret_name: string | null;
  notes: string | null;
};

type MethodRow = {
  code: string;
  name: string;
  enabled: boolean;
  payment_providers: { name: string } | null;
};

const fieldClass = "space-y-1.5";
const selectClass =
  "flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50";

function Field({
  label,
  name,
  required,
  placeholder,
  defaultValue,
}: {
  label: string;
  name: string;
  required?: boolean;
  placeholder?: string;
  defaultValue?: string;
}) {
  return (
    <div className={fieldClass}>
      <Label htmlFor={name}>
        {label}
        {required ? " *" : ""}
      </Label>
      <Input id={name} name={name} required={required} placeholder={placeholder} defaultValue={defaultValue} />
    </div>
  );
}

const methodColumns: Column<MethodRow>[] = [
  { header: "Code", cell: (r) => <span className="figure text-xs">{r.code}</span> },
  { header: "Method", cell: (r) => <span className="font-medium">{r.name}</span> },
  { header: "Provider", cell: (r) => r.payment_providers?.name ?? "—" },
  { header: "Enabled", cell: (r) => <StatusPill value={r.enabled ? "ACTIVE" : "SUSPENDED"} /> },
];

function ProvidersPage() {
  const [mode, setMode] = useState<"api" | "sandbox">("api");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const { user } = useAuth();
  const { data: roles } = useRoles(user?.id);
  const isAdmin = roles?.includes("admin") ?? false;
  const queryClient = useQueryClient();

  const addApi = useServerFn(addApiPaymentProvider);
  const addSandbox = useServerFn(addSandboxPaymentProvider);
  const testProvider = useServerFn(testPaymentProvider);

  const providers = useTable<ProviderRow>("payment_providers", {
    select:
      "id,code,name,priority,enabled,environment,status,api_base_url,sandbox_base_url,auth_type,credential_secret_name,notes",
    orderBy: "priority",
    ascending: true,
  });
  const methods = useTable<MethodRow>("payment_methods", {
    select: "code,name,enabled,payment_providers(name)",
    orderBy: "code",
    ascending: true,
  });

  const senang = (providers.data ?? []).find((p) => p.code.toUpperCase().includes("SENANG") || p.name.toLowerCase().includes("senang"));

  async function runTest(providerId: string) {
    setNotice(null);
    try {
      const result = await testProvider({ data: { providerId } });
      setNotice({
        tone: result.reachable ? "success" : "error",
        text: `Connection check: ${result.detail}`,
      });
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "Connection check failed." });
    }
  }

  const providerColumns: Column<ProviderRow>[] = [
    { header: "Code", cell: (r) => <span className="figure text-xs">{r.code}</span> },
    { header: "Provider", cell: (r) => <span className="font-medium">{r.name}</span> },
    { header: "Priority", align: "right", cell: (r) => <span className="figure">{r.priority}</span> },
    { header: "Environment", cell: (r) => r.environment },
    {
      header: "Endpoint",
      cell: (r) => (
        <span className="text-xs text-muted-foreground">
          {r.api_base_url ?? r.sandbox_base_url ?? "simulated locally"}
        </span>
      ),
    },
    { header: "Auth", cell: (r) => <span className="text-xs">{r.auth_type}</span> },
    {
      header: "Key name",
      cell: (r) => <span className="figure text-xs text-muted-foreground">{r.credential_secret_name ?? "—"}</span>,
    },
    { header: "Routing", cell: (r) => <StatusPill value={r.enabled ? "ACTIVE" : "SUSPENDED"} /> },
    { header: "Status", cell: (r) => <StatusPill value={r.status} /> },
    {
      header: "Check",
      cell: (r) => (
        <Button type="button" variant="ghost" size="sm" onClick={() => void runTest(r.id)}>
          <TestTube2 className="size-4" /> Test
        </Button>
      ),
    },
  ];

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isAdmin) return;
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    const shared = {
      code: String(values["code"]),
      name: String(values["name"]),
      priority: Number(values["priority"] || 10),
      enabled: String(values["enabled"] ?? "true") === "true",
      authType: String(values["authType"]) as "BEARER",
      authHeader: String(values["authHeader"] || "Authorization"),
      credentialSecretName: String(values["credentialSecretName"] ?? ""),
      chargePath: String(values["chargePath"] || "/v1/charges"),
      statusPath: String(values["statusPath"] || "/v1/charges/{id}"),
      webhookUrl: String(values["webhookUrl"] ?? ""),
      notes: String(values["notes"] ?? ""),
      config: String(values["config"] ?? ""),
    };

    setBusy(true);
    setNotice(null);
    try {
      if (mode === "api") {
        await addApi({
          data: {
            ...shared,
            apiBaseUrl: String(values["apiBaseUrl"]),
            sandboxBaseUrl: String(values["sandboxBaseUrl"] ?? ""),
          },
        });
      } else {
        await addSandbox({ data: { ...shared, sandboxBaseUrl: String(values["sandboxBaseUrl"] ?? "") } });
      }
      setNotice({ tone: "success", text: `${shared.name} was added and is ready for routing.` });
      form.reset();
      await queryClient.invalidateQueries({ queryKey: ["table"] });
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "Could not save the provider." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminShell>
      <section className="panel border-primary/40 bg-primary/5 p-5 sm:p-6">
        <p className="label-caps text-primary">Payment providers</p>
        <h1 className="mt-1 text-2xl font-bold tracking-wide sm:text-3xl">PLUG AND PLAY API AND SANDBOX</h1>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
          Connect any payment provider by choosing it, switching Sandbox or Production, and entering its Client ID and API key.
          Keys are encrypted automatically and the provider is ready for wallet transactions straight away.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-md border border-border bg-background/60 p-3 text-sm">
          <span className="font-semibold">senangPay sandbox</span>
          {senang ? (
            <>
              <StatusPill value={senang.status} />
              <span className="figure text-xs text-muted-foreground">{senang.code} · {senang.environment} · {senang.sandbox_base_url ?? senang.api_base_url ?? "—"}</span>
              <span className="text-xs text-muted-foreground">Existing setup kept as-is.</span>
            </>
          ) : (
            <span className="text-xs text-muted-foreground">{providers.isLoading ? "Checking…" : "Not found in providers list yet."}</span>
          )}
        </div>
      </section>

      <PlugAndPlayPanel />

      <details className="panel p-5 sm:p-6">
        <summary className="cursor-pointer label-caps">Advanced manual setup</summary>
        <div className="mt-4">
      <section>
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
          <div>
            <p className="label-caps">Add provider</p>
            <h2 className="mt-1 text-lg font-semibold">
              {mode === "api" ? "Live provider API" : "Sandbox provider"}
            </h2>
          </div>
          <div className="flex gap-2">
            <Button type="button" variant={mode === "api" ? "secondary" : "ghost"} size="sm" onClick={() => setMode("api")}>
              <PlugZap className="size-4" /> API
            </Button>
            <Button
              type="button"
              variant={mode === "sandbox" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setMode("sandbox")}
            >
              <TestTube2 className="size-4" /> Sandbox
            </Button>
          </div>
        </div>

        {!isAdmin && roles ? (
          <div className="mb-4 rounded-md border border-warning/30 bg-warning/10 p-4 text-sm text-warning">
            Administrator access is required to add payment providers.
          </div>
        ) : null}

        <form key={mode} onSubmit={submit} className="space-y-5">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Provider code" name="code" required placeholder="STRIPE" />
            <Field label="Provider name" name="name" required placeholder="Stripe" />
            {mode === "api" ? (
              <Field label="API base URL" name="apiBaseUrl" required placeholder="https://api.stripe.com" />
            ) : null}
            <Field
              label={mode === "api" ? "Sandbox base URL" : "Sandbox base URL (leave empty to simulate)"}
              name="sandboxBaseUrl"
              placeholder="https://sandbox.provider.com"
            />
            <div className={fieldClass}>
              <Label htmlFor="authType">Authentication *</Label>
              <select id="authType" name="authType" className={selectClass} defaultValue={mode === "api" ? "BEARER" : "NONE"}>
                <option value="BEARER">Bearer token</option>
                <option value="HEADER_KEY">API key header</option>
                <option value="BASIC">Basic auth</option>
                <option value="NONE">None</option>
              </select>
            </div>
            <Field label="Auth header name" name="authHeader" defaultValue="Authorization" />
            <Field
              label="Stored key name"
              name="credentialSecretName"
              placeholder="STRIPE_SECRET_KEY"
            />
            <Field label="Routing priority" name="priority" defaultValue="10" />
            <Field label="Charge path" name="chargePath" defaultValue="/v1/charges" />
            <Field label="Status path" name="statusPath" defaultValue="/v1/charges/{id}" />
            <Field label="Webhook URL" name="webhookUrl" placeholder="https://your-app/api/public/payments/webhook" />
            <div className={fieldClass}>
              <Label htmlFor="enabled">Routing *</Label>
              <select id="enabled" name="enabled" className={selectClass} defaultValue="true">
                <option value="true">Enabled</option>
                <option value="false">Disabled</option>
              </select>
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <Label htmlFor="config">Field mapping (JSON)</Label>
              <Textarea
                id="config"
                name="config"
                rows={3}
                placeholder='{"amount_in_minor": true, "reference_path": "id", "success_values": ["succeeded"]}'
              />
              <p className="text-xs text-muted-foreground">
                Optional. Describes how this provider names its request and response fields, so any provider API can be
                used without code changes.
              </p>
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea id="notes" name="notes" rows={2} />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={busy || !isAdmin}>
              {busy ? "Saving…" : mode === "api" ? "Add provider API" : "Add sandbox provider"}
            </Button>
            <p className="text-xs text-muted-foreground">
              Secret values are never stored here — save the key separately and reference it by name.
            </p>
          </div>
        </form>
      </section>
        </div>
      </details>
      {notice ? (
        <div
          className={cn(
            "rounded-md border p-3 text-sm",
            notice.tone === "success"
              ? "border-success/30 bg-success/10 text-success"
              : "border-destructive/30 bg-destructive/10 text-destructive",
          )}
        >
          {notice.text}
        </div>
      ) : null}

      <section className="space-y-3">
        <h2 className="label-caps">Providers</h2>
        <DataTable columns={providerColumns} rows={providers.data} loading={providers.isLoading} empty="No providers connected yet." />
      </section>
      <section className="space-y-3">
        <h2 className="label-caps">Payment methods</h2>
        <DataTable columns={methodColumns} rows={methods.data} loading={methods.isLoading} empty="No payment methods yet." />
      </section>
    </AdminShell>
  );
}
