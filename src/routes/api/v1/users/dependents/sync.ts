
import { createFileRoute } from '@tanstack/react-router'
import {
  query,
  tx,
  newId,
  ensureWallet,
} from '../../../../lib/mysql.server'
import crypto from 'node:crypto'

type UserRow = {
  id: string
  user_code: string
  organization_id: string
  status: string
}

type PartyRow = {
  id: string
  organization_id: string | null
  party_type: string
}

function authorized(request: Request): boolean {
  const expected = process.env["CBS_SKOOLA_SYNC_API_KEY"]

  const provided =
    request.headers.get('authorization')
      ?.replace(/^Bearer\s+/i, '') ?? ''

  if (!expected || !provided) return false

  const a = Buffer.from(provided)
  const b = Buffer.from(expected)

  return a.length === b.length &&
    crypto.timingSafeEqual(a, b)
}

export const Route = createFileRoute('/api/v1/users/sync')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!authorized(request)) {
          return Response.json(
            { success: false, message: 'Unauthorized' },
            { status: 401 }
          )
        }

        try {
          const body = await request.json()

          const {
            organization_id,
            user_code,
            full_name,
            email,
            mobile,
            password_hash
          } = body

          if (
            typeof organization_id !== 'string' ||
            typeof user_code !== 'string' ||
            typeof full_name !== 'string' ||
            !organization_id ||
            !user_code ||
            !full_name ||
            (email != null && typeof email !== 'string') ||
            (mobile != null && typeof mobile !== 'string')
          ) {
            return Response.json(
              {
                success: false,
                message: 'Invalid or missing fields.'
              },
              { status: 422 }
            )
          }

          // Only accept valid bcrypt password hashes.
          if (
            password_hash !== undefined &&
            password_hash !== null &&
            (
              typeof password_hash !== 'string' ||
              !/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(password_hash)
            )
          ) {
            return Response.json(
              {
                success: false,
                message: 'Invalid password hash format.'
              },
              { status: 422 }
            )
          }

          if (
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(organization_id) ||
            user_code.length > 40 ||
            full_name.length > 160 ||
            (email != null && email.length > 255) ||
            (mobile != null && mobile.length > 40)
          ) {
            return Response.json(
              {
                success: false,
                message: 'Invalid field length or organization ID.'
              },
              { status: 422 }
            )
          }

          if (
            organization_id !==
            process.env["CBS_SKOOLA_ORGANIZATION_ID"]
          ) {
            return Response.json(
              {
                success: false,
                message: 'Organization is not permitted.'
              },
              { status: 403 }
            )
          }

          // All CBS provisioning runs in one transaction.
          const result = await tx(async (conn) => {

            // 1. Find existing CBS user.
            const existing = await query<UserRow>(
              `
              SELECT id, user_code, organization_id, status
              FROM users
              WHERE user_code = ?
              LIMIT 1
              FOR UPDATE
              `,
              [user_code],
              conn
            )

            let userId: string
            let userStatus = 'ACTIVE'
            let created = false

            if (existing.length > 0) {
              const user = existing[0]!

              if (user.organization_id !== organization_id) {
                throw new Error('ORGANIZATION_MISMATCH')
              }

              userId = user.id
              userStatus = user.status

              // Update existing user.
              if (password_hash != null) {
                await conn.query(
                  `
                  UPDATE users
                  SET full_name = ?,
                      email = ?,
                      mobile = ?,
                      password_hash = ?
                  WHERE id = ?
                    AND organization_id = ?
                  `,
                  [
                    full_name,
                    email ?? null,
                    mobile ?? null,
                    password_hash,
                    userId,
                    organization_id
                  ]
                )
              } else {
                // Preserve existing password.
                await conn.query(
                  `
                  UPDATE users
                  SET full_name = ?,
                      email = ?,
                      mobile = ?
                  WHERE id = ?
                    AND organization_id = ?
                  `,
                  [
                    full_name,
                    email ?? null,
                    mobile ?? null,
                    userId,
                    organization_id
                  ]
                )
              }

            } else {
              // 2. Create new CBS user.
              userId = crypto.randomUUID()

              await conn.query(
                `
                INSERT INTO users (
                  id,
                  organization_id,
                  user_code,
                  full_name,
                  email,
                  mobile,
                  password_hash,
                  kyc_status,
                  status
                )
                VALUES (
                  ?, ?, ?, ?, ?, ?, ?,
                  'UNVERIFIED', 'ACTIVE'
                )
                `,
                [
                  userId,
                  organization_id,
                  user_code,
                  full_name,
                  email ?? null,
                  mobile ?? null,
                  password_hash ?? null
                ]
              )

              created = true
            }

            // 3. Find existing party.
            const parties = await query<PartyRow>(
              `
              SELECT id, organization_id, party_type
              FROM parties
              WHERE user_id = ?
              FOR UPDATE
              `,
              [userId],
              conn
            )

            let partyId: string

            if (parties.length > 1) {
              throw new Error('DUPLICATE_USER_PARTIES')
            }

            if (parties.length > 0) {
              const party = parties[0]!

              if (
                party.party_type !== 'USER' ||
                (
                  party.organization_id !== null &&
                  party.organization_id !== organization_id
                )
              ) {
                throw new Error('PARTY_MISMATCH')
              }

              partyId = party.id

              await conn.query(
                `
                UPDATE parties
                SET display_name = ?,
                    organization_id = ?
                WHERE id = ?
                `,
                [full_name, organization_id, partyId]
              )

            } else {
              // 4. Create missing party.
              partyId = await newId(conn)

              await conn.query(
                `
                INSERT INTO parties (
                  id,
                  user_id,
                  organization_id,
                  party_type,
                  display_name,
                  status
                )
                VALUES (?, ?, ?, 'USER', ?, ?)
                `,
                [
                  partyId,
                  userId,
                  organization_id,
                  full_name,
                  userStatus
                ]
              )
            }

            // Do not automatically provision active wallets
            // for suspended, closed or pending users.
            if (userStatus !== 'ACTIVE') {
              return {
                success: true,
                created,
                userId,
                partyId,
                walletProvisioned: false
              }
            }

            // 5. Create missing account, wallet and ledger.
            const provisioned = await ensureWallet(
              conn,
              partyId
            )

            return {
              success: true,
              created,
              userId,
              partyId,
              walletProvisioned: true,
              accountId: provisioned.accountId,
              accountNumber: provisioned.accountNumber,
              walletId: provisioned.wallet.id,
              walletNumber: provisioned.wallet.wallet_number,
              ledgerAccountId: provisioned.ledgerAccountId
            }
          })

          return Response.json(result)

        } catch (error: any) {
          console.error(
            'CBS user sync error:',
            error?.code ?? error?.message ?? 'UNKNOWN'
          )

          if (error?.message === 'ORGANIZATION_MISMATCH') {
            return Response.json(
              {
                success: false,
                message: 'User belongs to another organization.'
              },
              { status: 403 }
            )
          }

          if (
            error?.code === 'ER_DUP_ENTRY' ||
            error?.message === 'DUPLICATE_USER_PARTIES' ||
            error?.message === 'PARTY_MISMATCH'
          ) {
            return Response.json(
              {
                success: false,
                message: 'Conflicting CBS account records.'
              },
              { status: 409 }
            )
          }

          return Response.json(
            {
              success: false,
              message: 'Unable to synchronize CBS user.'
            },
            { status: 500 }
          )
        }
      }
    }
  }
})
