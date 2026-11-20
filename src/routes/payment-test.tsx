import { useMemo, useState, type FormEvent } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { FlaskConical, PlugZap } from "lucide-react";
import { AdminShell } from "@/components/admin/AdminShell";
import { PageHeader, StatusPill } from "@/components/admin/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/useAuth";
import { useTable } from "@/lib/queries";
import { PROVIDER_TEMPLATES } from "@/lib/provider-templates";
import { createPaymentProvider } from "@/lib/providers.functions";
import { runTestPayment } from "@/lib/payment-test.functions";

export const Route = createFileRoute("/payment-test")({
  head: () => ({
    meta: [
      { title: "Plug & Play Payment Test — CBS Core Ledger" },
      { name: "description", content: "Connect any payment provider with its keys and send a test payment." },
      { property: "og:title", content: "Plug & Play Payment Test — CBS Core Ledger" },
      { property: "og:description", content: "Connect a payment API by entering its keys, then test it instantly." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PaymentTestPage,
});

type ProviderRow = { id: string; code: string; name: string; environment: string; status: string; enabled: boolean; priority: number };
type MethodRow = { provider_id: string; code: string; name: string };

const selectClass =
  "flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring";

type TestResult = Awaited<ReturnType<typeof runTestPayment>>;

function PaymentTestPage() {
  const { roles } = useAuth();
  const isAdmin = roles.includes("admin");
  const qc = useQueryClient();
  const providers = useTable<ProviderRow>("payment_providers", {
    select: "id,code,name,environment,status,enabled,priority",
    orderBy: "priority",
    ascending: true,
  });
  const methods = useTable<MethodRow>("payment_methods", { select: "provider_id,code,name", orderBy: "code", ascending: true });

  // ---- Test payment ----
  const testFn = useServerFn(runTestPayment);
  const list = providers.data ?? [];
  const senang = list.find((p) => p.code === "SENANGPAY");
  const [providerId, setProviderId] = useState<string>("");
  const selectedId = providerId || senang?.id || list[0]?.id || "";
  const providerMethods = (methods.data ?? []).filter((m) => m.provider_id === selectedId);
  const [amount, setAmount] = useState("1.00");
  const [methodCode, setMethodCode] = useState("");
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);

  async function runTest() {
    if (!selectedId) return;
    setTesting(true);
    setResult(null);
    try {
      setResult(await testFn({ data: { providerId: selectedId, amount: Number(amount), methodCode: methodCode || providerMethods[0]?.code || "" } }));
    } catch (e) {
      setResult({ ok: false, reference: "", error: e instanceof Error ? e.message : "Test failed." });
    } finally {
      setTesting(false);
    }
  }

  // ---- Quick connect ----
  const connectFn = useServerFn(createPaymentProvider);
  const templates = PROVIDER_TEMPLATES;
  const [tplCode, setTplCode] = useState(templates.find((t) => t.code === "STRIPE")?.code ?? templates[0]!.code);
  const tpl = useMemo(() => templates.find((t) => t.code === tplCode)!, [tplCode, templates]);
  const [env, setEnv] = useState<"sandbox" | "production">("sandbox");
  const [connecting, setConnecting] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  async function connect(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const v = Object.fromEntries(new FormData(form)) as Record<string, string>;
    setConnecting(true);
    setNotice(null);
    try {
      const res = await connectFn({
        data: {
          code: v["code"] ?? tpl.code,
          name: v["name"] ?? tpl.name,
          providerType: tpl.providerType,
          environment: env,
          enabled: true,
          priority: 20,
          baseUrl: v["baseUrl"] || (env === "sandbox" ? tpl.sandboxBaseUrl : tpl.productionBaseUrl),
          authType: tpl.authType,
          authHeader: tpl.authHeader,
          authCredentialKey: tpl.authCredentialKey ?? "",
          operations: tpl.operations,
          methods: tpl.methods,
          credentials: tpl.credentials.map((c) => ({ ...c, value: v[`cred_${c.key}`] ?? "" })),
          fieldMapping: JSON.stringify(tpl.fieldMapping),
        },
      });
      setNotice({ ok: true, text: `${res.code} connected (${res.environment}). Pick it below and press "Send test payment".` });
      form.reset();
      await qc.invalidateQueries({ queryKey: ["table"] });
      setProviderId(res.id);
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : "Could not connect provider." });
    } finally {
      setConnecting(false);
    }
  }

  return (
    <AdminShell>
      <PageHeader
        title="Plug & play payment test"
        subtitle="senangPay sandbox is ready as the example. Connect any other provider by entering its keys, then send a test payment."
      />

      {!isAdmin ? (
        <div className="mb-4 rounded-md border border-warning/30 bg-warning/10 p-4 text-sm text-warning">
          Administrator access is required to connect providers and send test payments.
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="panel space-y-4 p-5">
          <div>
            <p className="label-caps">Step 1 · Example / test</p>
            <h2 className="mt-1 flex items-center gap-2 text-lg font-semibold">
              <FlaskConical className="size-4" /> Send test payment
            </h2>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="prov">Provider</Label>
            <select id="prov" className={selectClass} value={selectedId} onChange={(e) => { setProviderId(e.target.value); setMethodCode(""); }}>
              {list.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.environment} {p.code === "SENANGPAY" ? "(example)" : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="amt">Amount (MYR)</Label>
              <Input id="amt" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mth">Method</Label>
              <select id="mth" className={selectClass} value={methodCode} onChange={(e) => setMethodCode(e.target.value)}>
                {providerMethods.length === 0 ? <option value="">Default</option> : null}
                {providerMethods.map((m) => (
                  <option key={m.code} value={m.code}>{m.name}</option>
                ))}
              </select>
            </div>
          </div>
          <Button onClick={() => void runTest()} disabled={!isAdmin || testing || !selectedId}>
            {testing ? "Sending…" : "Send test payment"}
          </Button>

          {result ? (
            result.ok ? (
              <div className="space-y-2 rounded-md border border-border p-3 text-sm">
                <div className="flex items-center gap-2">
                  <StatusPill value={result.status} /> {result.simulated ? <span className="text-xs text-muted-foreground">simulated</span> : null}
                </div>
                <p>Reference: <span className="figure">{result.reference}</span></p>
                <p>Provider ref: <span className="figure">{result.providerReference || "—"}</span></p>
                {result.checkoutUrl ? (
                  <a className="text-primary underline" href={result.checkoutUrl} target="_blank" rel="noreferrer">Open checkout page</a>
                ) : null}
                <Textarea readOnly value={result.raw} rows={6} className="figure text-xs" />
              </div>
            ) : (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{result.error}</div>
            )
          ) : null}
        </section>

        <section className="panel p-5">
          <p className="label-caps">Step 2 · Plug & play</p>
          <h2 className="mt-1 mb-4 flex items-center gap-2 text-lg font-semibold">
            <PlugZap className="size-4" /> Connect another provider
          </h2>
          <form key={`${tplCode}-${env}`} onSubmit={connect} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="tpl">Provider type</Label>
                <select id="tpl" className={selectClass} value={tplCode} onChange={(e) => setTplCode(e.target.value)}>
                  {templates.map((t) => (
                    <option key={t.code} value={t.code}>{t.name}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="env">Environment</Label>
                <select id="env" className={selectClass} value={env} onChange={(e) => setEnv(e.target.value as "sandbox" | "production")}>
                  <option value="sandbox">Sandbox</option>
                  <option value="production">Production</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="code">Code (unique)</Label>
                <Input id="code" name="code" required defaultValue={`${tpl.code}_${env === "sandbox" ? "SBX" : "LIVE"}`} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="name">Name</Label>
                <Input id="name" name="name" required defaultValue={`${tpl.name} ${env === "sandbox" ? "Sandbox" : ""}`.trim()} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="baseUrl">API base URL</Label>
              <Input id="baseUrl" name="baseUrl" defaultValue={env === "sandbox" ? tpl.sandboxBaseUrl : tpl.productionBaseUrl} placeholder="https://api.provider.com" />
            </div>
            {tpl.credentials.map((c) => (
              <div key={c.key} className="space-y-1.5">
                <Label htmlFor={`cred_${c.key}`}>{c.label}{c.required ? " *" : ""}</Label>
                {c.type === "textarea" ? (
                  <Textarea id={`cred_${c.key}`} name={`cred_${c.key}`} required={c.required} rows={3} />
                ) : (
                  <Input id={`cred_${c.key}`} name={`cred_${c.key}`} required={c.required} type={c.secret ? "password" : "text"} autoComplete="off" />
                )}
              </div>
            ))}
            <p className="text-xs text-muted-foreground">Keys are encrypted before saving and never shown again in the browser.</p>
            <Button type="submit" disabled={!isAdmin || connecting}>{connecting ? "Connecting…" : "Connect provider"}</Button>
            {notice ? (
              <p className={notice.ok ? "text-sm text-success" : "text-sm text-destructive"}>{notice.text}</p>
            ) : null}
          </form>
        </section>
      </div>
    </AdminShell>
  );
}
