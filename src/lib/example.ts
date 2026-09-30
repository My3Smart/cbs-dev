/**
 * example.ts
 *
 * Example Wallet -> CBS API client.
 *
 * IMPORTANT:
 *
 * This file is intended to demonstrate the API contract.
 *
 * If this code runs in a browser:
 * DO NOT put CBS_WALLET_API_KEY in the browser.
 *
 * The recommended architecture is:
 *
 * Browser
 *   ↓
 * Wallet backend/server function
 *   ↓
 * CBS API
 *
 * The Wallet backend keeps the CBS application API key secret.
 */

/* -------------------------------------------------------------------------- */
/* Configuration                                                              */
/* -------------------------------------------------------------------------- */

const CBS_API_URL =
  process.env.CBS_API_URL ??
  "http://localhost:3000/api/v1";

const CBS_WALLET_API_KEY =
  process.env.CBS_WALLET_API_KEY;

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

export type CbsLoginInput = {
  userCode?: string;
  email?: string;
  password: string;
};

export type CbsLoginResponse = {
  success: true;
  accessToken: string;
  tokenType: "Bearer";
  expiresIn: number;
  user: {
    userId: string;
    userCode: string;
    fullName: string;
    email: string | null;
    mobile: string | null;
    organizationId: string | null;
    clusterId: string | null;
    walletNumber: string | null;
    currency: string | null;
  };
};

export type CbsRegisterUserInput = {
  organizationCode: string;
  clusterCode?: string;
  userCode: string;
  fullName: string;
  email?: string;
  mobile?: string;
  password?: string;
  kycStatus?:
    | "UNVERIFIED"
    | "PENDING"
    | "VERIFIED";
  currency?: string;
};

export type CbsRegisterUserResponse = {
  userId: string;
  userCode: string;
  partyId: string;
  accountId: string;
  accountNumber: string;
  walletId: string;
  walletNumber: string;
  currency: string;
  availableBalance: number;
};

export type CbsBalanceResponse = {
  walletNumber: string;
  owner: string | null;
  currency: string;
  status: string;
  availableBalance: number;
  heldBalance: number;
  pendingBalance: number;
};

export type CbsTransferInput = {
  fromWalletNumber: string;
  toWalletNumber: string;
  amount: number;
  note?: string;
  reference?: string;
  idempotencyKey?: string;
};

export type CbsTransferResponse = {
  transactionId: string;
  reference: string;
  amount: number;
  currency: string;
  status?: string;
};

export type CbsWalletReloadInput = {
  walletNumber: string;
  amount: number;
  providerCode?: string;
  methodCode?: string;
  reference?: string;
  description?: string;
};

export type CbsWalletReloadResponse = {
  intentId: string;
  reference: string;
  status: string;
  provider: {
    code: string;
    name: string;
    environment: string;
  };
  checkoutUrl: string | null;
  simulated: boolean;
  transactionId: string | null;
  amount: number;
  currency: string;
};

export type CbsConfirmReloadResponse = {
  reference: string;
  status: string;
  transactionId: string | null;
};

export type CbsPaymentProvider = {
  id: string;
  code: string;
  name: string;
  environment: string;
  enabled: boolean;
  status: string;
  priority: number;
  api_base_url: string | null;
  sandbox_base_url: string | null;
};

export type CbsWalletTopup = {
  id: string;
  reference: string;
  amount: number;
  currency: string;
  status: string;
  environment: string;
  method_code: string | null;
  created_at: string;
  provider_id: string;
};

/* -------------------------------------------------------------------------- */
/* API client                                                                 */
/* -------------------------------------------------------------------------- */

let userAccessToken: string | null = null;

/**
 * Set the CBS user access token after login.
 */
export function setCbsUserAccessToken(
  token: string,
) {
  userAccessToken = token;
}

/**
 * Clear the current CBS user session.
 */
export function clearCbsUserAccessToken() {
  userAccessToken = null;
}

/**
 * Get current user token.
 */
export function getCbsUserAccessToken() {
  return userAccessToken;
}

/* -------------------------------------------------------------------------- */
/* HTTP helper                                                                */
/* -------------------------------------------------------------------------- */

async function cbsRequest<T>(
  path: string,
  options: RequestInit = {},
  authentication:
    | "WALLET"
    | "USER"
    | "NONE" = "USER",
): Promise<T> {
  const headers = new Headers(
    options.headers,
  );

  headers.set(
    "Content-Type",
    "application/json",
  );

  /*
   * Wallet application authentication.
   *
   * This should only run on the Wallet SERVER.
   */
  if (authentication === "WALLET") {
    if (!CBS_WALLET_API_KEY) {
      throw new Error(
        "CBS_WALLET_API_KEY is not configured.",
      );
    }

    headers.set(
      "Authorization",
      `Bearer ${CBS_WALLET_API_KEY}`,
    );
  }

  /*
   * Logged-in CBS user authentication.
   */
  if (authentication === "USER") {
    if (!userAccessToken) {
      throw new Error(
        "CBS user is not logged in.",
      );
    }

    headers.set(
      "Authorization",
      `Bearer ${userAccessToken}`,
    );
  }

  const response = await fetch(
    `${CBS_API_URL}${path}`,
    {
      ...options,
      headers,
    },
  );

  let body: any = null;

  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok) {
    throw new Error(
      body?.message ??
        body?.error ??
        `CBS API request failed with HTTP ${response.status}.`,
    );
  }

  return body as T;
}

/* -------------------------------------------------------------------------- */
/* 1. LOGIN                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Login using a CBS user account.
 *
 * The Wallet sends:
 *
 * userCode OR email
 * password
 *
 * The CBS returns:
 *
 * accessToken
 *
 * The token is then used for the other user operations.
 */
export async function cbsLogin(
  data: CbsLoginInput,
): Promise<CbsLoginResponse> {
  const result =
    await cbsRequest<CbsLoginResponse>(
      "/auth/login",
      {
        method: "POST",
        body: JSON.stringify(data),
      },
      "WALLET",
    );

  setCbsUserAccessToken(
    result.accessToken,
  );

  return result;
}

/* -------------------------------------------------------------------------- */
/* 2. REGISTER USER                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Register a new CBS user.
 *
 * This is an application-level operation.
 *
 * The Wallet backend should call this using
 * the Wallet API credential.
 */
export async function cbsRegisterUser(
  data: CbsRegisterUserInput,
): Promise<CbsRegisterUserResponse> {
  return cbsRequest<CbsRegisterUserResponse>(
    "/users",
    {
      method: "POST",
      body: JSON.stringify(data),
    },
    "WALLET",
  );
}

/* -------------------------------------------------------------------------- */
/* 3. BALANCE                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Get the logged-in user's wallet balance.
 */
export async function cbsGetBalance(
  walletNumber?: string,
): Promise<CbsBalanceResponse> {
  const wallet =
    walletNumber ??
    "me";

  return cbsRequest<CbsBalanceResponse>(
    `/wallets/${encodeURIComponent(wallet)}/balance`,
    {
      method: "GET",
    },
    "USER",
  );
}

/* -------------------------------------------------------------------------- */
/* 4. TRANSFER                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Transfer money from the logged-in user's wallet
 * to another wallet.
 */
export async function cbsTransfer(
  data: CbsTransferInput,
): Promise<CbsTransferResponse> {
  return cbsRequest<CbsTransferResponse>(
    "/transfers",
    {
      method: "POST",
      body: JSON.stringify(data),
    },
    "USER",
  );
}

/* -------------------------------------------------------------------------- */
/* 5. WALLET RELOAD                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Create a wallet reload/payment intent.
 *
 * Example:
 *
 * SENANGPAY + FPX
 */
export async function cbsWalletReload(
  data: CbsWalletReloadInput,
): Promise<CbsWalletReloadResponse> {
  return cbsRequest<CbsWalletReloadResponse>(
    "/wallets/reload",
    {
      method: "POST",
      body: JSON.stringify(data),
    },
    "USER",
  );
}

/* -------------------------------------------------------------------------- */
/* 6. CONFIRM WALLET RELOAD                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Confirm a pending wallet reload after
 * the payment provider has completed payment.
 */
export async function cbsConfirmWalletReload(
  reference: string,
): Promise<CbsConfirmReloadResponse> {
  return cbsRequest<CbsConfirmReloadResponse>(
    "/wallets/reload/confirm",
    {
      method: "POST",
      body: JSON.stringify({
        reference,
      }),
    },
    "USER",
  );
}

/* -------------------------------------------------------------------------- */
/* 7. LIST PAYMENT PROVIDERS                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Get payment providers available through CBS.
 *
 * This should normally be an application/admin operation.
 */
export async function cbsListPaymentProviders(): Promise<
  CbsPaymentProvider[]
> {
  return cbsRequest<CbsPaymentProvider[]>(
    "/payment-providers",
    {
      method: "GET",
    },
    "WALLET",
  );
}

/* -------------------------------------------------------------------------- */
/* 8. LIST WALLET TOP-UPS                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Get the logged-in user's wallet top-ups.
 */
export async function cbsListWalletTopups(
  walletNumber?: string,
): Promise<CbsWalletTopup[]> {
  const wallet =
    walletNumber ??
    "me";

  return cbsRequest<CbsWalletTopup[]>(
    `/wallets/${encodeURIComponent(wallet)}/topups`,
    {
      method: "GET",
    },
    "USER",
  );
}

/* -------------------------------------------------------------------------- */
/* EXAMPLES                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Example login.
 */
export async function exampleLogin() {
  const result = await cbsLogin({
    userCode: "U1001",
    password: "user-password",
  });

  console.log(
    "Logged in:",
    result.user.userCode,
  );

  console.log(
    "Wallet:",
    result.user.walletNumber,
  );

  console.log(
    "Access token:",
    result.accessToken,
  );

  return result;
}

/**
 * Example register user.
 */
export async function exampleRegisterUser() {
  return cbsRegisterUser({
    organizationCode: "ORG-MY01",
    clusterCode: "CLS-SEL",
    userCode: "U1001",
    fullName: "Aisyah Rahman",
    email: "aisyah@example.com",
    mobile: "+60123456789",
    password: "TemporaryPassword123!",
    kycStatus: "VERIFIED",
    currency: "MYR",
  });
}

/**
 * Example balance.
 */
export async function exampleGetBalance() {
  return cbsGetBalance();
}

/**
 * Example transfer.
 */
export async function exampleTransfer() {
  return cbsTransfer({
    fromWalletNumber: "WAL-U1001",
    toWalletNumber: "WAL-U1002",
    amount: 25.50,
    note: "Canteen split",
    idempotencyKey:
      `TRF-U1001-U1002-${Date.now()}`,
  });
}

/**
 * Example wallet reload.
 */
export async function exampleWalletReload() {
  return cbsWalletReload({
    walletNumber: "WAL-U1001",
    amount: 100,
    providerCode: "SENANGPAY",
    methodCode: "FPX",
    reference:
      `RLD-U1001-${Date.now()}`,
    description: "Wallet reload",
  });
}

/**
 * Example confirm reload.
 */
export async function exampleConfirmReload(
  reference: string,
) {
  return cbsConfirmWalletReload(
    reference,
  );
}

/**
 * Example list payment providers.
 */
export async function exampleListPaymentProviders() {
  return cbsListPaymentProviders();
}

/**
 * Example list wallet top-ups.
 */
export async function exampleListWalletTopups() {
  return cbsListWalletTopups();
}

/**
 * Example complete wallet flow.
 *
 * 1. Login
 * 2. Read balance
 * 3. Transfer
 * 4. Start reload
 * 5. List top-ups
 */
export async function exampleCompleteWalletFlow() {
  /*
   * LOGIN
   */
  const login =
    await cbsLogin({
      userCode: "U1001",
      password: "user-password",
    });

  console.log(
    "Logged in:",
    login.user.fullName,
  );

  /*
   * BALANCE
   */
  const balance =
    await cbsGetBalance();

  console.log(
    "Balance:",
    balance.availableBalance,
    balance.currency,
  );

  /*
   * TRANSFER
   */
  const transfer =
    await cbsTransfer({
      fromWalletNumber:
        login.user.walletNumber!,
      toWalletNumber:
        "WAL-U1002",
      amount: 25,
      note: "Wallet transfer",
      idempotencyKey:
        `TRF-${Date.now()}`,
    });

  console.log(
    "Transfer:",
    transfer,
  );

  /*
   * WALLET RELOAD
   */
  const reload =
    await cbsWalletReload({
      walletNumber:
        login.user.walletNumber!,
      amount: 100,
      providerCode: "SENANGPAY",
      methodCode: "FPX",
      description:
        "Wallet reload",
    });

  console.log(
    "Reload:",
    reload,
  );

  /*
   * If payment provider requires
   * checkout, redirect the customer
   * to reload.checkoutUrl.
   */
  if (reload.checkoutUrl) {
    console.log(
      "Redirect customer to:",
      reload.checkoutUrl,
    );
  }

  /*
   * LIST TOP-UPS
   */
  const topups =
    await cbsListWalletTopups();

  console.log(
    "Top-ups:",
    topups,
  );

  return {
    login,
    balance,
    transfer,
    reload,
    topups,
  };
}