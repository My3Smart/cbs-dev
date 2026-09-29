# CBS on MySQL — setup

Everything the core banking system stores is in **`database.sql`**: all tables, the
double-entry posting procedure, and a full set of demo records (organizations,
clusters, users, merchants, accounts, wallets, chart of accounts, payment
providers, top-ups, transfers, audit trail, and three staff logins).

## 1. Requirements

- MySQL 8.0 or newer (MariaDB 10.6+ also works)

## 2. Create the database

```bash
mysql -u root -p < database.sql
```

This drops and recreates a database named `cbs`, so run it on a fresh instance
or rename the database at the top of the file first.

## 3. Create an application login

```sql
CREATE USER 'cbs_app'@'%' IDENTIFIED BY 'change-me-strong-password';
GRANT SELECT, INSERT, UPDATE, DELETE, EXECUTE ON cbs.* TO 'cbs_app'@'%';
FLUSH PRIVILEGES;
```

## 4. Connection settings

Put these in your environment (never commit real passwords):

```
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_DATABASE=cbs
MYSQL_USER=cbs_app
MYSQL_PASSWORD=change-me-strong-password
```

## 5. Check the data loaded

```sql
USE cbs;
SELECT wallet_number, available_balance FROM wallets ORDER BY wallet_number;
SELECT reference, transaction_type, amount FROM transactions ORDER BY created_at;
```

Debits and credits are printed at the end of the import and must be equal.

## Demo staff logins

| Email | Password | Role |
| --- | --- | --- |
| admin@cbs.local | admin123 | admin |
| operator@cbs.local | admin123 | operator |
| viewer@cbs.local | admin123 | viewer |

Change these before any real use.

## Posting money

Never insert into `ledger_entries` directly — call the procedure, which enforces
balanced entries, records the transaction, and moves wallet balances:

```sql
CALL post_transaction(
  'TRF-1001', 'TRANSFER', 'Wallet transfer', 'MYR',
  '22222222-2222-4222-8222-000000000001', 'TRF-1001',
  '[{"ledger_account_id":"<from-ledger-account>","direction":"DEBIT","amount":25.00},
    {"ledger_account_id":"<to-ledger-account>","direction":"CREDIT","amount":25.00}]',
  @txn);
SELECT @txn;
```

## Note on the live app

The running portal in CBS still reads and writes its built-in cloud
database — it cannot reach a MySQL server on your own machine or private
network. To point the app at this MySQL database, it needs a MySQL host that
accepts connections from the internet plus the credentials above; tell me the
host and I will wire the app to it.

## Detail profiles with account numbers

`database.sql` includes two views that join a user or merchant to its assigned
account number, wallet and balances:

```sql
SELECT user_code, full_name, account_number, wallet_number, available_balance
FROM v_user_profiles;

SELECT merchant_code, business_name, account_number, wallet_number, available_balance
FROM v_merchant_profiles;
```

Rows with a NULL `account_number` have not been assigned an account yet.
