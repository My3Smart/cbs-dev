import { createFileRoute } from "@tanstack/react-router";
import { query } from "../../../../../lib/mysql.server";
import { requireCbsUser } from "../../../../../lib/cbs-api.functions";

type Row = {
  child_id: string;
  full_name: string;
  wallet_number: string | null;
  currency: string | null;
  available_balance: string | number | null;
  held_balance: string | number | null;
  pending_balance: string | number | null;
  wallet_status: string | null;
};

export const Route = createFileRoute("/api/v1/dependents/$childId/balance")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        try {
          const user = requireCbsUser(request);
          // Only the guardian of this dependent may read its balance.
          const rows = await query<Row>(
            `SELECT u.id AS child_id, u.full_name,
                    w.wallet_number, w.currency, w.available_balance,
                    w.held_balance, w.pending_balance, w.status AS wallet_status
               FROM user_dependents ud
               INNER JOIN users u ON u.id = ud.child_id
               LEFT JOIN parties p ON p.user_id = u.id AND p.party_type = 'USER'
               LEFT JOIN accounts a ON a.party_id = p.id AND a.account_type = 'WALLET'
               LEFT JOIN wallets w ON w.account_id = a.id
              WHERE ud.guardian_id = ? AND ud.child_id = ?
              LIMIT 1`,
            [user.userId, params.childId],
          );
          const r = rows[0];
          if (!r) {
            return Response.json(
              { success: false, code: "NOT_GUARDIAN", message: "Dependent not found for this guardian." },
              { status: 404 },
            );
          }
          return Response.json({
            success: true,
            childId: r.child_id,
            fullName: r.full_name,
            walletNumber: r.wallet_number,
            currency: r.currency ?? "MYR",
            status: r.wallet_status,
            availableBalance: Number(r.available_balance) || 0,
            heldBalance: Number(r.held_balance) || 0,
            pendingBalance: Number(r.pending_balance) || 0,
          });
        } catch (error: any) {
          console.error("Get dependent balance error:", error);
          return Response.json(
            { success: false, message: error?.message || "Unable to retrieve dependent balance." },
            { status: error?.status || error?.statusCode || 500 },
          );
        }
      },
    },
  },
});
