import { createFileRoute } from '@tanstack/react-router'
import { query } from '../../../lib/mysql.server'
import { requireCbsUser } from '../../../lib/cbs-api.functions'

type MerchantRow = {
  id: string
  merchant_code: string
  business_name: string
  legal_name: string | null
  email: string | null
  mobile: string | null
  business_address: string | null
  status: string
}

export const Route = createFileRoute(
  '/api/v1/merchants'
)({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {

          // Require logged-in CBS user
          await requireCbsUser(request)

          const merchants = await query<MerchantRow>(
            `
            SELECT
              id,
              merchant_code,
              business_name,
              legal_name,
              email,
              mobile,
              business_address,
              status
            FROM merchants
            WHERE status = 'ACTIVE'
            ORDER BY business_name ASC
            `
          )

          return Response.json({
            success: true,
            merchants: merchants.map((merchant) => ({
              id: merchant.id,
              merchantCode: merchant.merchant_code,
              businessName: merchant.business_name,
              legalName: merchant.legal_name,
              email: merchant.email,
              mobile: merchant.mobile,
              businessAddress: merchant.business_address,
              status: merchant.status
            }))
          })

        } catch (error: any) {

          console.error(
            'Get merchants error:',
            error
          )

          return Response.json(
            {
              success: false,
              message:
                error?.message ||
                'Unable to retrieve merchants.'
            },
            {
              status:
                error?.status ||
                error?.statusCode ||
                500
            }
          )
        }
      }
    }
  }
})