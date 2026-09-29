/**
 * example.ts — how to call every CBS API.
 *
 * These are runnable snippets, not tests. Import a function from
 * `@/lib/cbs-api.functions` and call it with `{ data: ... }`.
 *
 * From a React component, wrap the call so the staff bearer token is attached:
 *
 *   import { useServerFn } from "@tanstack/react-start";
 *   const reload = useServerFn(cbsWalletReload);
 *   await reload({ data: { walletNumber: "WAL-U1", amount: 100 } });
 *
 * From another server function or a route loader under _authenticated,
 * call the function directly as shown below.
 */
import {
  cbsConfirmWalletReload,
  cbsGetBalance,
  cbsListPaymentProviders,
  cbsListWalletTopups,
  cbsRegisterUser,
  cbsTransfer,
  cbsWalletReload,
} from "./cbs-api.functions";
import {
  addApiPaymentProvider,
  addPaymentMethod,
  addSandboxPaymentProvider,
  testPaymentProvider,
} from "./providers.functions";

/* 1. Register a user — creates the user, account, wallet and wallet ledger account. */
export async function exampleRegisterUser() {
  const result = await cbsRegisterUser({
    data: {
      organizationCode: "ORG-MY01",
      clusterCode: "CLS-SEL",
      userCode: "U1001",
      fullName: "Aisyah Rahman",
      email: "aisyah@example.com",
      mobile: "+60123456789",
      kycStatus: "VERIFIED",
      currency: "MYR",
    },
  });
  console.log(result.walletNumber); // WAL-U1001
  return result;
}

/* 2. Balance — by wallet number or by user code. */
export async function exampleGetBalance() {
  const byWallet = await cbsGetBalance({ data: { walletNumber: "WAL-U1001" } });
  const byUser = await cbsGetBalance({ data: { userCode: "U1001" } });
  return { byWallet, byUser };
}

/* 3. Transfer — wallet to wallet, posted as a balanced double entry. */
export async function exampleTransfer() {
  return cbsTransfer({
    data: {
      fromWalletNumber: "WAL-U1001",
      toWalletNumber: "WAL-U1002",
      amount: 25.5,
      note: "Canteen split",
      // reference and idempotencyKey are optional; pass your own to make retries safe
      idempotencyKey: "TRF-U1001-U1002-0001",
    },
  });
}

/* 4a. Wallet reload — let CBS route to the highest-priority enabled provider. */
export async function exampleWalletReloadAutoRouted() {
  const topup = await cbsWalletReload({
    data: { walletNumber: "WAL-U1001", amount: 100, methodCode: "FPX" },
  });

  if (topup.status === "SUCCEEDED") {
    console.log("posted to ledger:", topup.transactionId);
  } else if (topup.checkoutUrl) {
    console.log("redirect the payer to:", topup.checkoutUrl);
  }
  return topup;
}

/* 4b. Wallet reload through a named provider. */
export async function exampleWalletReloadNamedProvider() {
  return cbsWalletReload({
    data: {
      walletNumber: "WAL-U1001",
      amount: 50,
      providerCode: "SANDBOX",
      methodCode: "CARD",
      description: "Sandbox test reload",
      reference: "RLD-DEMO-0001",
    },
  });
}

/* 4c. Confirm a pending reload after the payer finishes at the gateway. */
export async function exampleConfirmReload() {
  return cbsConfirmWalletReload({ data: { reference: "RLD-DEMO-0001" } });
}

/* 5. Read helpers. */
export async function exampleReads() {
  const providers = await cbsListPaymentProviders();
  const allTopups = await cbsListWalletTopups({ data: {} });
  const walletTopups = await cbsListWalletTopups({ data: { walletNumber: "WAL-U1001" } });
  return { providers, allTopups, walletTopups };
}

/* 6. Add a live payment provider API (admin only).
 *    The credential itself is never stored in the database — only the name of the
 *    saved secret, which the adapter reads from the server environment.          */
export async function exampleAddApiProvider() {
  return addApiPaymentProvider({
    data: {
      code: "STRIPE",
      name: "Stripe",
      apiBaseUrl: "https://api.stripe.com",
      authType: "BEARER",
      authHeader: "Authorization",
      credentialSecretName: "STRIPE_SECRET_KEY",
      chargePath: "/v1/payment_intents",
      statusPath: "/v1/payment_intents/{id}",
      priority: 10,
      enabled: true,
      config: JSON.stringify({
        amount_in_minor: true,
        amount_field: "amount",
        currency_field: "currency",
        reference_field: "metadata[reference]",
        reference_path: "id",
        status_path_field: "status",
        success_values: ["succeeded"],
      }),
    },
  });
}

/* 7. Add a sandbox provider. Leave sandboxBaseUrl empty to simulate top-ups locally. */
export async function exampleAddSandboxProvider() {
  return addSandboxPaymentProvider({
    data: {
      code: "SANDBOX",
      name: "In-house sandbox",
      sandboxBaseUrl: "",
      authType: "NONE",
      priority: 1,
      enabled: true,
      notes: "Simulated approvals for UAT",
    },
  });
}

/* 8. Attach a payment method to a provider, then probe the connection. */
export async function exampleAddMethodAndTest(providerId: string) {
  await addPaymentMethod({ data: { providerId, code: "FPX", name: "FPX online banking", enabled: true } });
  return testPaymentProvider({ data: { providerId } });
}
