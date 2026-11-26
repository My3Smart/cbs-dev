import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireCbsUser } from "../../../../lib/cbs-api.functions";
import { transferBody, transferGuardianToChild, childForCard, errorResponse } from "../../../../lib/dependent-transfer.server";

const body = transferBody.extend({ cardUid: z.string().trim().min(4).max(64) });

export const Route = createFileRoute("/api/v1/cards/transfer")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const user = requireCbsUser(request);
          const b = body.parse(await request.json());
          const childId = await childForCard(b.cardUid);
          const t = await transferGuardianToChild({
            guardianUserId: user.userId,
            childUserId: childId,
            amount: b.amount,
            currency: b.currency,
            note: b.note,
            idempotencyKey: b.idempotencyKey,
            channel: "CARD",
          });
          return Response.json({
            success: true,
            transaction: {
              reference: t.reference,
              status: t.status,
              replayed: t.replayed,
              amount: t.amount,
              currency: t.currency,
              card: { cardUid: t.card?.card_uid ?? b.cardUid.toUpperCase(), cardType: t.card?.card_type ?? "NFC", status: t.card?.status ?? "ACTIVE" },
              beneficiary: { childId, name: t.to.childName, walletNumber: t.to.walletNumber, newBalance: t.to.newBalance },
              sender: { walletNumber: t.from.walletNumber, newBalance: t.from.newBalance },
              note: t.note,
              timestamp: t.timestamp,
            },
          });
        } catch (e) {
          return errorResponse(e);
        }
      },
    },
  },
});
