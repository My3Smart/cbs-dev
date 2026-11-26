import { createFileRoute } from "@tanstack/react-router";
import { requireCbsUser } from "../../../../../lib/cbs-api.functions";
import { transferBody, transferGuardianToChild, errorResponse } from "../../../../../lib/dependent-transfer.server";

export const Route = createFileRoute("/api/v1/dependents/$childId/transfer")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        try {
          const user = requireCbsUser(request);
          const body = transferBody.parse(await request.json());
          const transaction = await transferGuardianToChild({
            guardianUserId: user.userId,
            childUserId: params.childId,
            amount: body.amount,
            currency: body.currency,
            note: body.note,
            idempotencyKey: body.idempotencyKey,
            channel: "DEPENDENT",
          });
          return Response.json({ success: true, transaction });
        } catch (e) {
          return errorResponse(e);
        }
      },
    },
  },
});
