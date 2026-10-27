import { createFileRoute } from "@tanstack/react-router";
import bcrypt from "bcryptjs";

import { one } from "@/lib/mysql.server";
import {
  authErrorResponse,
  createUserAccessToken,
  requireWalletApiClient,
} from "@/lib/cbs-api.functions";

type LoginBody = {
  email?: string;
  userCode?: string;
  password?: string;
};

type UserRow = {
  id: string;
  user_code: string;
  full_name: string;
  email: string | null;
  mobile: string | null;
  password_hash: string | null;
  status: string;
  organization_id: string | null;
  cluster_id: string | null;
};

type WalletRow = {
  wallet_number: string;
  currency: string;
};

export const Route = createFileRoute("/api/v1/auth/login")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          // 1. Authenticate the Skoola Wallet application itself.
          requireWalletApiClient(request);

          // 2. Read login credentials.
          const body = (await request.json()) as LoginBody;

          const email = body.email?.trim().toLowerCase();
          const userCode = body.userCode?.trim();
          const password = body.password ?? "";

          if ((!email && !userCode) || !password) {
            return Response.json(
              {
                success: false,
                message: "Email or user code and password are required.",
              },
              { status: 400 },
            );
          }

          // 3. Find CBS user.
          let user: UserRow | null = null;

          if (email) {
            user = await one<UserRow>(
              `SELECT
                 id,
                 user_code,
                 full_name,
                 email,
                 mobile,
                 password_hash,
                 status,
                 organization_id,
                 cluster_id
               FROM users
               WHERE LOWER(email) = ?
               LIMIT 1`,
              [email],
            );
          } else if (userCode) {
            user = await one<UserRow>(
              `SELECT
                 id,
                 user_code,
                 full_name,
                 email,
                 mobile,
                 password_hash,
                 status,
                 organization_id,
                 cluster_id
               FROM users
               WHERE user_code = ?
               LIMIT 1`,
              [userCode],
            );
          }

          // 4. Verify password.
          if (
            !user ||
            !user.password_hash ||
            !(await bcrypt.compare(password, user.password_hash))
          ) {
            return Response.json(
              {
                success: false,
                message: "Wrong email or password.",
              },
              { status: 401 },
            );
          }

          // 5. Only ACTIVE users can log in.
          if (user.status !== "ACTIVE") {
            return Response.json(
              {
                success: false,
                message: "This account is not active.",
              },
              { status: 403 },
            );
          }

          // 6. Find user's wallet.
          const wallet = await one<WalletRow>(
            `SELECT
               w.wallet_number,
               w.currency
             FROM parties p
             JOIN accounts a
               ON a.party_id = p.id
             JOIN wallets w
               ON w.account_id = a.id
             WHERE p.user_id = ?
             ORDER BY a.created_at ASC
             LIMIT 1`,
            [user.id],
          );

          // 7. Generate CBS user JWT.
          const accessToken = createUserAccessToken({
            userId: user.id,
            userCode: user.user_code,
            organizationId: user.organization_id,
            clusterId: user.cluster_id,
            walletNumber: wallet?.wallet_number ?? null,
          });

          // 8. Return contract expected by example.ts.
          return Response.json({
            success: true,
            accessToken,
            tokenType: "Bearer",
            expiresIn: 60 * 60 * 24 * 30,

            user: {
              userId: user.id,
              userCode: user.user_code,
              fullName: user.full_name,
              email: user.email,
              mobile: user.mobile,
              organizationId: user.organization_id,
              clusterId: user.cluster_id,
              walletNumber: wallet?.wallet_number ?? null,
              currency: wallet?.currency ?? null,
            },
          });
        } catch (error) {
          console.error("CBS Wallet login error:", error);
          return authErrorResponse(error);
        }
      },
    },
  },
});