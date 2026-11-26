import { createFileRoute } from '@tanstack/react-router'
import { query } from '../../../../../lib/mysql.server'
import { requireCbsUser } from '../../../../../lib/cbs-api.functions'

type DependentRow = {
  dependent_id: string
  guardian_id: string
  child_id: string
  relationship: string
  date_of_birth: string | null
  notes: string | null

  user_code: string
  full_name: string
  email: string | null
  mobile: string | null
  status: string
  wallet_number: string | null
  currency: string | null
  available_balance: string | number | null
}

export const Route = createFileRoute(
  '/api/v1/users/me/dependents'
)({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          /*
           * Get the logged-in CBS user from the JWT.
           * We do NOT accept guardian_id from the browser.
           */
          const authUser = await requireCbsUser(request)

          const dependents = await query<DependentRow>(
            `
            SELECT
              ud.id AS dependent_id,
              ud.guardian_id,
              ud.child_id,
              ud.relationship,
              ud.date_of_birth,
              ud.notes,

              u.user_code,
              u.full_name,
              u.email,
              u.mobile,
              u.status,
              w.wallet_number,
              w.currency,
              w.available_balance

            FROM user_dependents ud

            INNER JOIN users u
              ON u.id = ud.child_id
            LEFT JOIN parties p ON p.user_id = u.id AND p.party_type = 'USER'
            LEFT JOIN accounts a ON a.party_id = p.id AND a.account_type = 'WALLET'
            LEFT JOIN wallets w ON w.account_id = a.id

            WHERE ud.guardian_id = ?

            ORDER BY u.full_name ASC
            `,
            [authUser.userId]
          )

          return Response.json({
            success: true,

            dependents: dependents.map((row) => ({
              dependentId: row.dependent_id,
              childId: row.child_id,

              relationship: row.relationship,
              dateOfBirth: row.date_of_birth,
              notes: row.notes,

              userCode: row.user_code,
              fullName: row.full_name,
              email: row.email,
              mobile: row.mobile,
              status: row.status,
              walletNumber: row.wallet_number,
              currency: row.currency ?? 'MYR',
              availableBalance: Number(row.available_balance) || 0
            }))
          })
        } catch (error: any) {
          console.error(
            'Get dependents error:',
            error
          )

          return Response.json(
            {
              success: false,
              message:
                error?.message ||
                'Unable to retrieve dependents.'
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