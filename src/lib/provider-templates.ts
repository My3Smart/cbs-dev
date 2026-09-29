/**
 * Payment provider templates. Browser-safe (no secrets) — they only describe
 * which credential fields, endpoints and payment methods a provider needs, so
 * the admin form renders them automatically. Adding a new provider never
 * requires a schema or form change: pick "Custom REST provider" and define the
 * credential fields by hand.
 */
export type CredentialType = "text" | "password" | "textarea" | "url";

export type CredentialDef = {
  key: string;
  label: string;
  type: CredentialType;
  required: boolean;
  secret: boolean;
};

export type OperationDef = { method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; path: string };

export type ProviderTemplate = {
  code: string;
  name: string;
  providerType: string;
  authType: "BEARER" | "HEADER_KEY" | "BASIC" | "NONE" | "SIGNATURE";
  authHeader: string;
  /** Which credential is sent as the auth header value. */
  authCredentialKey: string | null;
  sandboxBaseUrl: string;
  productionBaseUrl: string;
  credentials: CredentialDef[];
  operations: { charge: OperationDef; status: OperationDef; refund: OperationDef; cancel: OperationDef };
  methods: { code: string; name: string }[];
  fieldMapping: Record<string, unknown>;
};

const c = (key: string, label: string, type: CredentialType, required: boolean, secret: boolean): CredentialDef => ({
  key,
  label,
  type,
  required,
  secret,
});

export const PAYMENT_METHOD_OPTIONS = [
  { code: "CARD", name: "Card" },
  { code: "FPX", name: "FPX online banking" },
  { code: "EWALLET", name: "E-wallet" },
  { code: "BANK_TRANSFER", name: "Bank transfer" },
  { code: "QR", name: "QR / DuitNow" },
  { code: "BNPL", name: "Buy now, pay later" },
];

const defaultMapping = {
  request: { amount: "$transaction.amount", currency: "$transaction.currency", reference: "$transaction.reference" },
  response: { provider_reference: "id", status: "status", checkout_url: "checkout_url" },
  status_mapping: { succeeded: "SUCCESS", success: "SUCCESS", paid: "SUCCESS", pending: "PENDING", failed: "FAILED", cancelled: "CANCELLED" },
};

export const PROVIDER_TEMPLATES: ProviderTemplate[] = [
  {
    code: "DOKU",
    name: "DOKU / senangPay",
    providerType: "PAYMENT_GATEWAY",
    authType: "SIGNATURE",
    authHeader: "Client-Id",
    authCredentialKey: "client_id",
    sandboxBaseUrl: "https://api-sandbox.doku.com",
    productionBaseUrl: "https://api.doku.com",
    credentials: [
      c("client_id", "Client ID", "text", true, false),
      c("secret_key", "Secret Key", "password", true, true),
      c("api_key", "API Key", "password", false, true),
      c("doku_public_key", "DOKU Public Key", "textarea", false, false),
      c("merchant_public_key", "Merchant Public Key", "textarea", false, false),
      c("merchant_private_key", "Merchant Private Key", "textarea", false, true),
      c("token_url", "Token URL (SNAP only)", "url", false, false),
    ],
    operations: {
      charge: { method: "POST", path: "/checkout/v1/payment" },
      status: { method: "GET", path: "/orders/v1/status/{id}" },
      refund: { method: "POST", path: "/refund/v1/refund" },
      cancel: { method: "POST", path: "/orders/v1/cancel/{id}" },
    },
    methods: [
      { code: "CARD", name: "Card" },
      { code: "FPX", name: "FPX online banking" },
      { code: "EWALLET", name: "E-wallet" },
    ],
    fieldMapping: {
      request: { "order.amount": "$transaction.amount", "order.invoice_number": "$transaction.reference", "order.currency": "$transaction.currency" },
      response: { provider_reference: "response.order.invoice_number", status: "response.order.status", checkout_url: "response.payment.url" },
      status_mapping: { SUCCESS: "SUCCESS", PENDING: "PENDING", FAILED: "FAILED", EXPIRED: "CANCELLED" },
      signature: { algorithm: "HMAC-SHA256", secret_credential: "secret_key", header: "Signature" },
    },
  },
  {
    code: "STRIPE",
    name: "Stripe",
    providerType: "PAYMENT_GATEWAY",
    authType: "BEARER",
    authHeader: "Authorization",
    authCredentialKey: "secret_key",
    sandboxBaseUrl: "https://api.stripe.com",
    productionBaseUrl: "https://api.stripe.com",
    credentials: [
      c("secret_key", "Secret Key", "password", true, true),
      c("publishable_key", "Publishable Key", "text", false, false),
      c("webhook_secret", "Webhook Secret", "password", false, true),
    ],
    operations: {
      charge: { method: "POST", path: "/v1/payment_intents" },
      status: { method: "GET", path: "/v1/payment_intents/{id}" },
      refund: { method: "POST", path: "/v1/refunds" },
      cancel: { method: "POST", path: "/v1/payment_intents/{id}/cancel" },
    },
    methods: [{ code: "CARD", name: "Card" }],
    fieldMapping: { ...defaultMapping, amount_in_minor: true },
  },
  {
    code: "BILLPLZ",
    name: "Billplz",
    providerType: "PAYMENT_GATEWAY",
    authType: "BASIC",
    authHeader: "Authorization",
    authCredentialKey: "api_key",
    sandboxBaseUrl: "https://www.billplz-sandbox.com/api",
    productionBaseUrl: "https://www.billplz.com/api",
    credentials: [
      c("api_key", "API Key", "password", true, true),
      c("collection_id", "Collection ID", "text", true, false),
      c("x_signature", "X Signature Key", "password", false, true),
    ],
    operations: {
      charge: { method: "POST", path: "/v3/bills" },
      status: { method: "GET", path: "/v3/bills/{id}" },
      refund: { method: "POST", path: "/v3/refunds" },
      cancel: { method: "DELETE", path: "/v3/bills/{id}" },
    },
    methods: [{ code: "FPX", name: "FPX online banking" }],
    fieldMapping: { ...defaultMapping, amount_in_minor: true, response: { provider_reference: "id", status: "state", checkout_url: "url" } },
  },
  {
    code: "IPAY88",
    name: "iPay88",
    providerType: "PAYMENT_GATEWAY",
    authType: "SIGNATURE",
    authHeader: "MerchantCode",
    authCredentialKey: "merchant_code",
    sandboxBaseUrl: "https://sandbox.ipay88.com.my",
    productionBaseUrl: "https://payment.ipay88.com.my",
    credentials: [
      c("merchant_code", "Merchant Code", "text", true, false),
      c("merchant_key", "Merchant Key", "password", true, true),
    ],
    operations: {
      charge: { method: "POST", path: "/epayment/entry.asp" },
      status: { method: "POST", path: "/epayment/enquiry.asp" },
      refund: { method: "POST", path: "/epayment/refund.asp" },
      cancel: { method: "POST", path: "/epayment/void.asp" },
    },
    methods: [
      { code: "CARD", name: "Card" },
      { code: "FPX", name: "FPX online banking" },
      { code: "EWALLET", name: "E-wallet" },
    ],
    fieldMapping: { ...defaultMapping, status_mapping: { "1": "SUCCESS", "0": "FAILED", "6": "PENDING" } },
  },
  {
    code: "SENANGPAY",
    name: "senangPay (classic)",
    providerType: "PAYMENT_GATEWAY",
    authType: "BASIC",
    authHeader: "Authorization",
    authCredentialKey: "merchant_id",
    sandboxBaseUrl: "https://sandbox.senangpay.my",
    productionBaseUrl: "https://app.senangpay.my",
    credentials: [
      c("merchant_id", "Merchant ID", "text", true, false),
      c("secret_key", "Secret Key", "password", true, true),
    ],
    operations: {
      charge: { method: "POST", path: "/payment/{merchant_id}" },
      status: { method: "GET", path: "/apiv1/query_order_status" },
      refund: { method: "POST", path: "/apiv1/refund" },
      cancel: { method: "POST", path: "/apiv1/cancel" },
    },
    methods: [
      { code: "CARD", name: "Card" },
      { code: "FPX", name: "FPX online banking" },
    ],
    fieldMapping: { ...defaultMapping, status_mapping: { "1": "SUCCESS", "0": "FAILED" } },
  },
  {
    code: "CUSTOM",
    name: "Custom REST provider",
    providerType: "PAYMENT_GATEWAY",
    authType: "BEARER",
    authHeader: "Authorization",
    authCredentialKey: "api_key",
    sandboxBaseUrl: "",
    productionBaseUrl: "",
    credentials: [c("api_key", "API Key", "password", true, true)],
    operations: {
      charge: { method: "POST", path: "/v1/charges" },
      status: { method: "GET", path: "/v1/charges/{id}" },
      refund: { method: "POST", path: "/v1/refunds" },
      cancel: { method: "POST", path: "/v1/charges/{id}/cancel" },
    },
    methods: [],
    fieldMapping: defaultMapping,
  },
];

export const PROVIDER_TYPES = [
  { value: "PAYMENT_GATEWAY", label: "Payment gateway" },
  { value: "EWALLET", label: "E-wallet" },
  { value: "BANK", label: "Bank / open banking" },
  { value: "ACQUIRER", label: "Card acquirer" },
  { value: "PAYOUT", label: "Payout / disbursement" },
];
