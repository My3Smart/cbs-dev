
import { createFileRoute } from '@tanstack/react-router'
import {
  query,
  tx,
  newId,
  ensureWallet,
} from '../../../../lib/mysql.server'
import crypto from 'node:crypto'

type ClusterRow = {
  id: string
}

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
  status: string
}

function authorized(request: Request): boolean {
  const expected = process.env["CBS_SKOOLA_SYNC_API_KEY"]

  const provided =
    request.headers.get('authorization')
      ?.replace(/^Bearer\s+/i, '') ?? ''

  if (!expected || !provided) return false

  const a = Buffer.from(provided)
  const b = Buffer.from(expected)

  return (
    a.length === b.length &&
    crypto.timingSafeEqual(a, b)
  )
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

          // Validate required fields.
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

          // Validate field lengths and organization UUID.
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

          // Validate bcrypt password hash.
          if (
            password_hash != null &&
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

          // Restrict synchronization to Skoola organization.
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

          // Run all provisioning inside one transaction.
          const result = await tx(async (conn) => {

            // Retrieve the active Skowla cluster.
            const clusters = await query<ClusterRow>(
              `
  SELECT id
  FROM clusters
  WHERE organization_id = ?
    AND code = ?
    AND status = 'ACTIVE'
  FOR UPDATE
  `,
              [organization_id, 'CLS-SKW'],
              conn
            )

            if (clusters.length !== 1) {
              throw new Error('SKOWLA_CLUSTER_INVALID')
            }

            const clusterId = clusters[0]!.id

            // STEP 1: Find existing CBS user.
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
                      password_hash = ?,
                      cluster_id = ?
                  WHERE id = ?
                    AND organization_id = ?
                  `,
                  [
                    full_name,
                    email ?? null,
                    mobile ?? null,
                    password_hash,
                    clusterId,
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
                      mobile = ?,
                      cluster_id = ?
                  WHERE id = ?
                    AND organization_id = ?
                  `,
                  [
                    full_name,
                    email ?? null,
                    mobile ?? null,
                    clusterId,
                    userId,
                    organization_id
                  ]
                )
              }

            } else {

              // STEP 2: Create new CBS user.
              userId = crypto.randomUUID()

              await conn.query(
                `
                INSERT INTO users (
                  id,
                  organization_id,
                  cluster_id,
                  user_code,
                  full_name,
                  email,
                  mobile,
                  password_hash,
                  kyc_status,
                  status
                )
                VALUES (
                  ?, ?, ?, ?, ?, ?, ?,?,
                  'UNVERIFIED', 'ACTIVE'
                )
                `,
                [
                  userId,
                  organization_id,
                  clusterId,
                  user_code,
                  full_name,
                  email ?? null,
                  mobile ?? null,
                  password_hash ?? null
                ]
              )

              created = true
            }

            // STEP 3: Find existing party.
            const parties = await query<PartyRow>(
              `
              SELECT id, organization_id, party_type, status
              FROM parties
              WHERE user_id = ?
              FOR UPDATE
              `,
              [userId],
              conn
            )

            let partyId: string
            let partyStatus = userStatus

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
              partyStatus = party.status

              // Update existing party details.
              await conn.query(
                `
                UPDATE parties
                SET display_name = ?,
                    organization_id = ?
                WHERE id = ?
                `,
                [
                  full_name,
                  organization_id,
                  partyId
                ]
              )

            } else {

              // STEP 4: Create missing party.
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

            // Do not provision new wallets for inactive users
            // or inactive parties.
            if (
              userStatus !== 'ACTIVE' ||
              partyStatus !== 'ACTIVE'
            ) {
              return {
                success: true,
                created,
                userId,
                partyId,
                walletProvisioned: false
              }
            }

            // STEP 5: Automatically create missing:
            // - Financial account
            // - Wallet
            // - Ledger account
            //
            // Existing records and balances are preserved.
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

          if (error?.message === 'SKOWLA_CLUSTER_INVALID') {
            return Response.json(
              {
                success: false,
                message: 'CLS-SKW cluster is missing, inactive or duplicated.'
              },
              { status: 500 }
            )
          }

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
