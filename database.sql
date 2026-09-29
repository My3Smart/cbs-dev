-- =====================================================================
-- CBS (Core Banking System) — MySQL 8.0 schema + demo data
--
-- Usage:
--   mysql -u root -p < database.sql
--
-- Creates the database `cbs`, all tables, the double-entry posting
-- procedure, and a full set of demo/seed records.
-- =====================================================================

DROP DATABASE IF EXISTS cbs;
CREATE DATABASE cbs CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE cbs;

SET FOREIGN_KEY_CHECKS = 1;

-- ---------------------------------------------------------------------
-- Staff accounts and roles
-- ---------------------------------------------------------------------
CREATE TABLE staff_users (
  id                   CHAR(36)     NOT NULL DEFAULT (UUID()),
  email                VARCHAR(255) NOT NULL,
  full_name            VARCHAR(160) NULL,
  password_hash        VARCHAR(255) NOT NULL,
  must_change_password TINYINT(1)   NOT NULL DEFAULT 0,
  created_at           TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY staff_users_email_key (email)
) ENGINE=InnoDB;

CREATE TABLE staff_roles (
  id         CHAR(36)  NOT NULL DEFAULT (UUID()),
  user_id    CHAR(36)  NOT NULL,
  role       ENUM('admin','operator','viewer') NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY staff_roles_user_role_key (user_id, role),
  CONSTRAINT staff_roles_user_fk FOREIGN KEY (user_id) REFERENCES staff_users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- Organization hierarchy
-- ---------------------------------------------------------------------
CREATE TABLE organizations (
  id                  CHAR(36)     NOT NULL DEFAULT (UUID()),
  code                VARCHAR(40)  NOT NULL,
  name                VARCHAR(160) NOT NULL,
  legal_name          VARCHAR(200) NULL,
  registration_number VARCHAR(80)  NULL,
  email               VARCHAR(255) NULL,
  mobile              VARCHAR(40)  NULL,
  address             TEXT         NULL,
  currency            CHAR(3)      NOT NULL DEFAULT 'MYR',
  timezone            VARCHAR(64)  NOT NULL DEFAULT 'Asia/Kuala_Lumpur',
  status              ENUM('ACTIVE','SUSPENDED','CLOSED','PENDING') NOT NULL DEFAULT 'ACTIVE',
  created_at          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY organizations_code_key (code)
) ENGINE=InnoDB;

CREATE TABLE clusters (
  id              CHAR(36)     NOT NULL DEFAULT (UUID()),
  organization_id CHAR(36)     NOT NULL,
  code            VARCHAR(40)  NOT NULL,
  name            VARCHAR(160) NOT NULL,
  region          VARCHAR(120) NULL,
  status          ENUM('ACTIVE','SUSPENDED','CLOSED','PENDING') NOT NULL DEFAULT 'ACTIVE',
  created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY clusters_org_code_key (organization_id, code),
  CONSTRAINT clusters_org_fk FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE users (
  id              CHAR(36)     NOT NULL DEFAULT (UUID()),
  organization_id CHAR(36)     NOT NULL,
  cluster_id      CHAR(36)     NULL,
  user_code       VARCHAR(40)  NOT NULL,
  full_name       VARCHAR(160) NOT NULL,
  email           VARCHAR(255) NULL,
  mobile          VARCHAR(40)  NULL,
  kyc_status      ENUM('UNVERIFIED','PENDING','VERIFIED') NOT NULL DEFAULT 'UNVERIFIED',
  status          ENUM('ACTIVE','SUSPENDED','CLOSED','PENDING') NOT NULL DEFAULT 'ACTIVE',
  created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY users_user_code_key (user_code),
  KEY users_org_idx (organization_id),
  CONSTRAINT users_org_fk FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT users_cluster_fk FOREIGN KEY (cluster_id) REFERENCES clusters(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- Dependents: child accounts registered under a guardian (parent) user.
-- The child is a normal row in `users` (own account + wallet);
-- this table links the child to its guardian.
-- ---------------------------------------------------------------------
CREATE TABLE user_dependents (
  id             CHAR(36)     NOT NULL DEFAULT (UUID()),
  guardian_id    CHAR(36)     NOT NULL,
  child_id       CHAR(36)     NOT NULL,
  relationship   VARCHAR(40)  NOT NULL DEFAULT 'CHILD',
  date_of_birth  DATE         NULL,
  notes          VARCHAR(255) NULL,
  created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY user_dependents_child_key (child_id),
  KEY user_dependents_guardian_idx (guardian_id),
  CONSTRAINT user_dependents_guardian_fk FOREIGN KEY (guardian_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT user_dependents_child_fk FOREIGN KEY (child_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE merchants (
  id                  CHAR(36)     NOT NULL DEFAULT (UUID()),
  organization_id     CHAR(36)     NOT NULL,
  cluster_id          CHAR(36)     NULL,
  merchant_code       VARCHAR(40)  NOT NULL,
  business_name       VARCHAR(160) NOT NULL,
  legal_name          VARCHAR(200) NULL,
  registration_number VARCHAR(80)  NULL,
  email               VARCHAR(255) NULL,
  mobile              VARCHAR(40)  NULL,
  business_address    TEXT         NULL,
  settlement_cycle    VARCHAR(20)  NOT NULL DEFAULT 'T+1',
  status              ENUM('ACTIVE','SUSPENDED','CLOSED','PENDING') NOT NULL DEFAULT 'ACTIVE',
  created_at          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY merchants_code_key (merchant_code),
  CONSTRAINT merchants_org_fk FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT merchants_cluster_fk FOREIGN KEY (cluster_id) REFERENCES clusters(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- Financial parties, accounts, wallets
-- ---------------------------------------------------------------------
CREATE TABLE parties (
  id              CHAR(36)     NOT NULL DEFAULT (UUID()),
  party_type      ENUM('USER','MERCHANT','ORGANIZATION','SYSTEM') NOT NULL,
  user_id         CHAR(36)     NULL,
  merchant_id     CHAR(36)     NULL,
  organization_id CHAR(36)     NULL,
  display_name    VARCHAR(200) NOT NULL,
  status          ENUM('ACTIVE','SUSPENDED','CLOSED','PENDING') NOT NULL DEFAULT 'ACTIVE',
  created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT parties_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT parties_merchant_fk FOREIGN KEY (merchant_id) REFERENCES merchants(id) ON DELETE CASCADE,
  CONSTRAINT parties_org_fk FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE accounts (
  id             CHAR(36)    NOT NULL DEFAULT (UUID()),
  party_id       CHAR(36)    NOT NULL,
  account_number VARCHAR(60) NOT NULL,
  account_type   ENUM('WALLET','SETTLEMENT','FEE','CLEARING','SUSPENSE') NOT NULL DEFAULT 'WALLET',
  currency       CHAR(3)     NOT NULL DEFAULT 'MYR',
  status         ENUM('ACTIVE','SUSPENDED','CLOSED','PENDING') NOT NULL DEFAULT 'ACTIVE',
  opened_at      TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  closed_at      TIMESTAMP   NULL,
  created_at     TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY accounts_number_key (account_number),
  CONSTRAINT accounts_party_fk FOREIGN KEY (party_id) REFERENCES parties(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE wallets (
  id                CHAR(36)      NOT NULL DEFAULT (UUID()),
  account_id        CHAR(36)      NOT NULL,
  wallet_number     VARCHAR(60)   NOT NULL,
  currency          CHAR(3)       NOT NULL DEFAULT 'MYR',
  available_balance DECIMAL(20,4) NOT NULL DEFAULT 0,
  pending_balance   DECIMAL(20,4) NOT NULL DEFAULT 0,
  held_balance      DECIMAL(20,4) NOT NULL DEFAULT 0,
  status            ENUM('ACTIVE','SUSPENDED','CLOSED','PENDING') NOT NULL DEFAULT 'ACTIVE',
  created_at        TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY wallets_number_key (wallet_number),
  CONSTRAINT wallets_account_fk FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- Double-entry ledger
-- ---------------------------------------------------------------------
CREATE TABLE ledger_accounts (
  id             CHAR(36)     NOT NULL DEFAULT (UUID()),
  code           VARCHAR(60)  NOT NULL,
  name           VARCHAR(200) NOT NULL,
  account_class  ENUM('ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE') NOT NULL,
  normal_balance ENUM('DEBIT','CREDIT') NOT NULL,
  wallet_id      CHAR(36)     NULL,
  currency       CHAR(3)      NOT NULL DEFAULT 'MYR',
  status         ENUM('ACTIVE','SUSPENDED','CLOSED','PENDING') NOT NULL DEFAULT 'ACTIVE',
  created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY ledger_accounts_code_key (code),
  CONSTRAINT ledger_accounts_wallet_fk FOREIGN KEY (wallet_id) REFERENCES wallets(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE transactions (
  id                      CHAR(36)      NOT NULL DEFAULT (UUID()),
  reference               VARCHAR(60)   NOT NULL,
  idempotency_key         VARCHAR(120)  NULL,
  transaction_type        VARCHAR(40)   NOT NULL,
  status                  ENUM('PENDING','POSTED','FAILED','REVERSED') NOT NULL DEFAULT 'POSTED',
  amount                  DECIMAL(20,4) NOT NULL,
  currency                CHAR(3)       NOT NULL DEFAULT 'MYR',
  description             VARCHAR(255)  NULL,
  organization_id         CHAR(36)      NULL,
  reverses_transaction_id CHAR(36)      NULL,
  created_by              CHAR(36)      NULL,
  posted_at               TIMESTAMP     NULL,
  created_at              TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY transactions_reference_key (reference),
  UNIQUE KEY transactions_idempotency_key (idempotency_key),
  CONSTRAINT transactions_org_fk FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE SET NULL,
  CONSTRAINT transactions_reverses_fk FOREIGN KEY (reverses_transaction_id) REFERENCES transactions(id)
) ENGINE=InnoDB;

CREATE TABLE ledger_entries (
  id                CHAR(36)      NOT NULL DEFAULT (UUID()),
  transaction_id    CHAR(36)      NOT NULL,
  ledger_account_id CHAR(36)      NOT NULL,
  direction         ENUM('DEBIT','CREDIT') NOT NULL,
  amount            DECIMAL(20,4) NOT NULL,
  currency          CHAR(3)       NOT NULL DEFAULT 'MYR',
  created_at        TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ledger_entries_txn_idx (transaction_id),
  KEY ledger_entries_account_idx (ledger_account_id),
  CONSTRAINT ledger_entries_amount_check CHECK (amount > 0),
  CONSTRAINT ledger_entries_txn_fk FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE,
  CONSTRAINT ledger_entries_account_fk FOREIGN KEY (ledger_account_id) REFERENCES ledger_accounts(id)
) ENGINE=InnoDB;

CREATE TABLE transfers (
  id             CHAR(36)      NOT NULL DEFAULT (UUID()),
  transaction_id CHAR(36)      NULL,
  from_wallet_id CHAR(36)      NOT NULL,
  to_wallet_id   CHAR(36)      NOT NULL,
  amount         DECIMAL(20,4) NOT NULL,
  currency       CHAR(3)       NOT NULL DEFAULT 'MYR',
  status         ENUM('PENDING','POSTED','FAILED','REVERSED') NOT NULL DEFAULT 'POSTED',
  reference      VARCHAR(60)   NOT NULL,
  note           VARCHAR(255)  NULL,
  created_by     CHAR(36)      NULL,
  created_at     TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY transfers_reference_key (reference),
  CONSTRAINT transfers_amount_check CHECK (amount > 0),
  CONSTRAINT transfers_txn_fk FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE SET NULL,
  CONSTRAINT transfers_from_fk FOREIGN KEY (from_wallet_id) REFERENCES wallets(id),
  CONSTRAINT transfers_to_fk FOREIGN KEY (to_wallet_id) REFERENCES wallets(id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- Payment providers (live + sandbox) and top-ups
-- ---------------------------------------------------------------------
CREATE TABLE payment_providers (
  id                     CHAR(36)     NOT NULL DEFAULT (UUID()),
  code                   VARCHAR(40)  NOT NULL,
  name                   VARCHAR(160) NOT NULL,
  provider_type          VARCHAR(40)  NOT NULL DEFAULT 'PAYMENT_GATEWAY',
  priority               INT          NOT NULL DEFAULT 100,
  enabled                TINYINT(1)   NOT NULL DEFAULT 0,
  environment            ENUM('live','sandbox','production') NOT NULL DEFAULT 'sandbox',
  status                 ENUM('ACTIVE','SUSPENDED','CLOSED','PENDING') NOT NULL DEFAULT 'PENDING',
  notes                  TEXT         NULL,
  api_base_url           VARCHAR(255) NULL,
  sandbox_base_url       VARCHAR(255) NULL,
  auth_type              VARCHAR(20)  NOT NULL DEFAULT 'BEARER',
  auth_header            VARCHAR(60)  NOT NULL DEFAULT 'Authorization',
  auth_credential_key    VARCHAR(60)  NULL,
  credential_secret_name VARCHAR(120) NULL,
  charge_method          VARCHAR(10)  NOT NULL DEFAULT 'POST',
  charge_path            VARCHAR(160) NOT NULL DEFAULT '/v1/charges',
  status_method          VARCHAR(10)  NOT NULL DEFAULT 'GET',
  status_path            VARCHAR(160) NOT NULL DEFAULT '/v1/charges/{id}',
  refund_method          VARCHAR(10)  NULL,
  refund_path            VARCHAR(160) NULL,
  cancel_method          VARCHAR(10)  NULL,
  cancel_path            VARCHAR(160) NULL,
  webhook_url            VARCHAR(255) NULL,
  currency               CHAR(3)      NOT NULL DEFAULT 'MYR',
  min_amount             DECIMAL(20,4) NOT NULL DEFAULT 0,
  max_amount             DECIMAL(20,4) NULL,
  config                 JSON         NOT NULL,
  created_at             TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at             TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY payment_providers_code_key (code)
) ENGINE=InnoDB;

-- Provider credentials. Values are AES-256-GCM encrypted by the app ("v1:...").
-- Seed rows may use "plain:<value>"; the app accepts them and they never leave the server.
CREATE TABLE payment_provider_credentials (
  id               CHAR(36)     NOT NULL DEFAULT (UUID()),
  provider_id      CHAR(36)     NOT NULL,
  environment      ENUM('sandbox','production') NOT NULL DEFAULT 'sandbox',
  credential_key   VARCHAR(60)  NOT NULL,
  credential_label VARCHAR(120) NOT NULL,
  credential_type  VARCHAR(20)  NOT NULL DEFAULT 'password',
  encrypted_value  TEXT         NULL,
  is_required      TINYINT(1)   NOT NULL DEFAULT 0,
  is_secret        TINYINT(1)   NOT NULL DEFAULT 1,
  created_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY ppc_provider_env_key (provider_id, environment, credential_key),
  CONSTRAINT ppc_provider_fk FOREIGN KEY (provider_id) REFERENCES payment_providers(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE payment_methods (
  id          CHAR(36)     NOT NULL DEFAULT (UUID()),
  provider_id CHAR(36)     NOT NULL,
  code        VARCHAR(40)  NOT NULL,
  name        VARCHAR(160) NOT NULL,
  enabled     TINYINT(1)   NOT NULL DEFAULT 1,
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY payment_methods_provider_code_key (provider_id, code),
  CONSTRAINT payment_methods_provider_fk FOREIGN KEY (provider_id) REFERENCES payment_providers(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE payment_intents (
  id                 CHAR(36)      NOT NULL DEFAULT (UUID()),
  provider_id        CHAR(36)      NOT NULL,
  method_code        VARCHAR(40)   NULL,
  wallet_id          CHAR(36)      NOT NULL,
  amount             DECIMAL(20,4) NOT NULL,
  currency           CHAR(3)       NOT NULL DEFAULT 'MYR',
  status             VARCHAR(20)   NOT NULL DEFAULT 'PENDING',
  environment        ENUM('live','sandbox') NOT NULL DEFAULT 'sandbox',
  provider_reference VARCHAR(120)  NULL,
  checkout_url       VARCHAR(500)  NULL,
  reference          VARCHAR(60)   NOT NULL,
  transaction_id     CHAR(36)      NULL,
  metadata           JSON          NOT NULL,
  created_by         CHAR(36)      NULL,
  created_at         TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY payment_intents_reference_key (reference),
  CONSTRAINT payment_intents_amount_check CHECK (amount > 0),
  CONSTRAINT payment_intents_provider_fk FOREIGN KEY (provider_id) REFERENCES payment_providers(id),
  CONSTRAINT payment_intents_wallet_fk FOREIGN KEY (wallet_id) REFERENCES wallets(id),
  CONSTRAINT payment_intents_txn_fk FOREIGN KEY (transaction_id) REFERENCES transactions(id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- Audit trail
-- ---------------------------------------------------------------------
CREATE TABLE audit_logs (
  id          CHAR(36)     NOT NULL DEFAULT (UUID()),
  actor_id    CHAR(36)     NULL,
  action      VARCHAR(80)  NOT NULL,
  entity_type VARCHAR(80)  NULL,
  entity_id   VARCHAR(80)  NULL,
  metadata    JSON         NOT NULL,
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY audit_logs_created_idx (created_at)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- Wallet balances follow the ledger: every entry against a wallet
-- ledger account moves that wallet's available balance.
-- (Wallet ledger accounts are LIABILITY/CREDIT: credit = money in.)
-- ---------------------------------------------------------------------
DELIMITER //

CREATE TRIGGER ledger_entries_apply_to_wallet
AFTER INSERT ON ledger_entries
FOR EACH ROW
BEGIN
  DECLARE v_wallet CHAR(36);
  SELECT wallet_id INTO v_wallet FROM ledger_accounts WHERE id = NEW.ledger_account_id;
  IF v_wallet IS NOT NULL THEN
    UPDATE wallets
       SET available_balance = available_balance
           + CASE WHEN NEW.direction = 'CREDIT' THEN NEW.amount ELSE -NEW.amount END
     WHERE id = v_wallet;
  END IF;
END//

-- post_transaction(reference, type, description, currency, organization_id,
--                  idempotency_key, entries_json)
--   entries_json: [{"ledger_account_id":"...","direction":"DEBIT","amount":10}, ...]
-- Debits must equal credits or the call is rejected.
CREATE PROCEDURE post_transaction(
  IN  p_reference        VARCHAR(60),
  IN  p_transaction_type VARCHAR(40),
  IN  p_description      VARCHAR(255),
  IN  p_currency         CHAR(3),
  IN  p_organization_id  CHAR(36),
  IN  p_idempotency_key  VARCHAR(120),
  IN  p_entries          JSON,
  OUT p_transaction_id   CHAR(36)
)
BEGIN
  DECLARE v_count   INT DEFAULT JSON_LENGTH(p_entries);
  DECLARE v_i       INT DEFAULT 0;
  DECLARE v_debit   DECIMAL(20,4) DEFAULT 0;
  DECLARE v_credit  DECIMAL(20,4) DEFAULT 0;
  DECLARE v_dir     VARCHAR(10);
  DECLARE v_amount  DECIMAL(20,4);
  DECLARE v_account CHAR(36);
  DECLARE v_existing CHAR(36) DEFAULT NULL;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_existing FROM transactions WHERE idempotency_key = p_idempotency_key LIMIT 1;
  END IF;

  IF v_existing IS NOT NULL THEN
    SET p_transaction_id = v_existing;
  ELSE
    IF v_count IS NULL OR v_count < 2 THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'A transaction needs at least two entries.';
    END IF;

    WHILE v_i < v_count DO
      SET v_dir    = JSON_UNQUOTE(JSON_EXTRACT(p_entries, CONCAT('$[', v_i, '].direction')));
      SET v_amount = CAST(JSON_UNQUOTE(JSON_EXTRACT(p_entries, CONCAT('$[', v_i, '].amount'))) AS DECIMAL(20,4));
      IF v_dir = 'DEBIT' THEN SET v_debit = v_debit + v_amount;
      ELSE SET v_credit = v_credit + v_amount; END IF;
      SET v_i = v_i + 1;
    END WHILE;

    IF v_debit <> v_credit THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Debits and credits must balance.';
    END IF;

    SET p_transaction_id = UUID();
    INSERT INTO transactions
      (id, reference, idempotency_key, transaction_type, status, amount, currency,
       description, organization_id, posted_at)
    VALUES
      (p_transaction_id, p_reference, p_idempotency_key, p_transaction_type, 'POSTED', v_debit,
       p_currency, p_description, p_organization_id, CURRENT_TIMESTAMP);

    SET v_i = 0;
    WHILE v_i < v_count DO
      SET v_account = JSON_UNQUOTE(JSON_EXTRACT(p_entries, CONCAT('$[', v_i, '].ledger_account_id')));
      SET v_dir     = JSON_UNQUOTE(JSON_EXTRACT(p_entries, CONCAT('$[', v_i, '].direction')));
      SET v_amount  = CAST(JSON_UNQUOTE(JSON_EXTRACT(p_entries, CONCAT('$[', v_i, '].amount'))) AS DECIMAL(20,4));
      INSERT INTO ledger_entries (transaction_id, ledger_account_id, direction, amount, currency)
      VALUES (p_transaction_id, v_account, v_dir, v_amount, p_currency);
      SET v_i = v_i + 1;
    END WHILE;
  END IF;
END//

DELIMITER ;

-- =====================================================================
-- DETAIL PROFILE VIEWS (include the assigned account number)
-- =====================================================================

CREATE OR REPLACE VIEW v_user_profiles AS
SELECT
  u.id                AS user_id,
  u.user_code,
  u.full_name,
  u.email,
  u.mobile,
  u.kyc_status,
  u.status,
  o.code              AS organization_code,
  o.name              AS organization_name,
  c.code              AS cluster_code,
  c.name              AS cluster_name,
  p.id                AS party_id,
  a.id                AS account_id,
  a.account_number,
  a.account_type,
  a.currency          AS account_currency,
  a.status            AS account_status,
  w.wallet_number,
  w.available_balance,
  w.pending_balance,
  w.held_balance,
  u.created_at
FROM users u
JOIN organizations o ON o.id = u.organization_id
LEFT JOIN clusters c ON c.id = u.cluster_id
LEFT JOIN parties  p ON p.user_id = u.id
LEFT JOIN accounts a ON a.party_id = p.id
LEFT JOIN wallets  w ON w.account_id = a.id;

CREATE OR REPLACE VIEW v_merchant_profiles AS
SELECT
  m.id                AS merchant_id,
  m.merchant_code,
  m.business_name,
  m.legal_name,
  m.registration_number,
  m.email,
  m.mobile,
  m.business_address,
  m.settlement_cycle,
  m.status,
  o.code              AS organization_code,
  o.name              AS organization_name,
  c.code              AS cluster_code,
  c.name              AS cluster_name,
  p.id                AS party_id,
  a.id                AS account_id,
  a.account_number,
  a.account_type,
  a.currency          AS account_currency,
  a.status            AS account_status,
  w.wallet_number,
  w.available_balance,
  w.pending_balance,
  w.held_balance,
  m.created_at
FROM merchants m
JOIN organizations o ON o.id = m.organization_id
LEFT JOIN clusters c ON c.id = m.cluster_id
LEFT JOIN parties  p ON p.merchant_id = m.id
LEFT JOIN accounts a ON a.party_id = p.id
LEFT JOIN wallets  w ON w.account_id = a.id;

-- =====================================================================
-- DEMO DATA
-- =====================================================================

-- Staff: admin@cbs.local / admin123 (bcrypt hash — change after first login)
INSERT INTO staff_users (id, email, full_name, password_hash) VALUES
  ('11111111-1111-4111-8111-111111111111', 'admin@cbs.local', 'System Administrator',
   '$2b$10$so6ZAg0Ev/Erwj6z/Lgkl.Y4HpIF8oMDXRh2jn1P2BXB4kVW2PYIK'),
  ('11111111-1111-4111-8111-111111111112', 'operator@cbs.local', 'Wallet Operator',
   '$2b$10$so6ZAg0Ev/Erwj6z/Lgkl.Y4HpIF8oMDXRh2jn1P2BXB4kVW2PYIK'),
  ('11111111-1111-4111-8111-111111111113', 'viewer@cbs.local', 'Read Only Analyst',
   '$2b$10$so6ZAg0Ev/Erwj6z/Lgkl.Y4HpIF8oMDXRh2jn1P2BXB4kVW2PYIK');

INSERT INTO staff_roles (user_id, role) VALUES
  ('11111111-1111-4111-8111-111111111111', 'admin'),
  ('11111111-1111-4111-8111-111111111112', 'operator'),
  ('11111111-1111-4111-8111-111111111113', 'viewer');

INSERT INTO organizations
  (id, code, name, legal_name, registration_number, email, mobile, address, currency, timezone, status) VALUES
  ('22222222-2222-4222-8222-000000000001', 'ORG-MY01', 'Nusantara Education Group',
   'Nusantara Education Group Sdn Bhd', '202301001234', 'ops@nusantara.edu.my', '+60312345678',
   'Level 12, Menara Nusantara, Jalan Ampang, 50450 Kuala Lumpur', 'MYR', 'Asia/Kuala_Lumpur', 'ACTIVE'),
  ('22222222-2222-4222-8222-000000000002', 'ORG-MY02', 'Selatan Retail Holdings',
   'Selatan Retail Holdings Bhd', '202401005678', 'finance@selatanretail.my', '+6075551234',
   'Wisma Selatan, Jalan Wong Ah Fook, 80000 Johor Bahru', 'MYR', 'Asia/Kuala_Lumpur', 'ACTIVE');

INSERT INTO clusters (id, organization_id, code, name, region, status) VALUES
  ('33333333-3333-4333-8333-000000000001', '22222222-2222-4222-8222-000000000001', 'CLS-KUL', 'Kuala Lumpur Campus Cluster', 'Central', 'ACTIVE'),
  ('33333333-3333-4333-8333-000000000002', '22222222-2222-4222-8222-000000000001', 'CLS-SEL', 'Selangor Campus Cluster', 'Central', 'ACTIVE'),
  ('33333333-3333-4333-8333-000000000003', '22222222-2222-4222-8222-000000000002', 'CLS-JHR', 'Johor Retail Cluster', 'Southern', 'ACTIVE');

INSERT INTO users (id, organization_id, cluster_id, user_code, full_name, email, mobile, kyc_status, status) VALUES
  ('44444444-4444-4444-8444-000000000001', '22222222-2222-4222-8222-000000000001', '33333333-3333-4333-8333-000000000001', 'U1', 'Aisyah Binti Rahman',  'aisyah@nusantara.edu.my',  '+60123456701', 'VERIFIED',   'ACTIVE'),
  ('44444444-4444-4444-8444-000000000002', '22222222-2222-4222-8222-000000000001', '33333333-3333-4333-8333-000000000001', 'U2', 'Daniel Tan Wei Ming', 'daniel@nusantara.edu.my',  '+60123456702', 'VERIFIED',   'ACTIVE'),
  ('44444444-4444-4444-8444-000000000003', '22222222-2222-4222-8222-000000000001', '33333333-3333-4333-8333-000000000002', 'U3', 'Kavitha Subramaniam', 'kavitha@nusantara.edu.my', '+60123456703', 'PENDING',    'ACTIVE'),
  ('44444444-4444-4444-8444-000000000004', '22222222-2222-4222-8222-000000000002', '33333333-3333-4333-8333-000000000003', 'U4', 'Farid Bin Hassan',    'farid@selatanretail.my',   '+60123456704', 'UNVERIFIED', 'ACTIVE');

-- Dependent (child) of Aisyah (U1)
INSERT INTO users (id, organization_id, cluster_id, user_code, full_name, email, mobile, kyc_status, status) VALUES
  ('44444444-4444-4444-8444-000000000005', '22222222-2222-4222-8222-000000000001', '33333333-3333-4333-8333-000000000001', 'U1-D1', 'Adam Bin Aisyah', NULL, NULL, 'UNVERIFIED', 'ACTIVE');
INSERT INTO user_dependents (guardian_id, child_id, relationship, date_of_birth) VALUES
  ('44444444-4444-4444-8444-000000000001', '44444444-4444-4444-8444-000000000005', 'CHILD', '2014-05-12');

INSERT INTO merchants
  (id, organization_id, cluster_id, merchant_code, business_name, legal_name, registration_number,
   email, mobile, business_address, settlement_cycle, status) VALUES
  ('55555555-5555-4555-8555-000000000001', '22222222-2222-4222-8222-000000000001', '33333333-3333-4333-8333-000000000001',
   'M1', 'Kampus Cafe', 'Kampus Cafe Enterprise', 'JM0123456-A', 'cafe@nusantara.edu.my', '+60322110001',
   'Blok A, Kafeteria Utama, Kampus KL', 'T+1', 'ACTIVE'),
  ('55555555-5555-4555-8555-000000000002', '22222222-2222-4222-8222-000000000001', '33333333-3333-4333-8333-000000000002',
   'M2', 'Campus Bookstore', 'Ilmu Books Sdn Bhd', '201901009876', 'books@nusantara.edu.my', '+60322110002',
   'Ground Floor, Library Annex, Kampus Selangor', 'T+2', 'ACTIVE');

-- Parties
INSERT INTO parties (id, party_type, user_id, merchant_id, organization_id, display_name, status) VALUES
  ('66666666-6666-4666-8666-000000000001', 'USER',     '44444444-4444-4444-8444-000000000001', NULL, '22222222-2222-4222-8222-000000000001', 'Aisyah Binti Rahman', 'ACTIVE'),
  ('66666666-6666-4666-8666-000000000002', 'USER',     '44444444-4444-4444-8444-000000000002', NULL, '22222222-2222-4222-8222-000000000001', 'Daniel Tan Wei Ming', 'ACTIVE'),
  ('66666666-6666-4666-8666-000000000003', 'USER',     '44444444-4444-4444-8444-000000000003', NULL, '22222222-2222-4222-8222-000000000001', 'Kavitha Subramaniam', 'ACTIVE'),
  ('66666666-6666-4666-8666-000000000004', 'USER',     '44444444-4444-4444-8444-000000000004', NULL, '22222222-2222-4222-8222-000000000002', 'Farid Bin Hassan', 'ACTIVE'),
  ('66666666-6666-4666-8666-000000000005', 'MERCHANT', NULL, '55555555-5555-4555-8555-000000000001', '22222222-2222-4222-8222-000000000001', 'Kampus Cafe', 'ACTIVE'),
  ('66666666-6666-4666-8666-000000000006', 'MERCHANT', NULL, '55555555-5555-4555-8555-000000000002', '22222222-2222-4222-8222-000000000001', 'Campus Bookstore', 'ACTIVE'),
  ('66666666-6666-4666-8666-000000000007', 'SYSTEM',   NULL, NULL, '22222222-2222-4222-8222-000000000001', 'CBS System', 'ACTIVE');

INSERT INTO accounts (id, party_id, account_number, account_type, currency, status) VALUES
  ('77777777-7777-4777-8777-000000000001', '66666666-6666-4666-8666-000000000001', 'ACC-U1', 'WALLET', 'MYR', 'ACTIVE'),
  ('77777777-7777-4777-8777-000000000002', '66666666-6666-4666-8666-000000000002', 'ACC-U2', 'WALLET', 'MYR', 'ACTIVE'),
  ('77777777-7777-4777-8777-000000000003', '66666666-6666-4666-8666-000000000003', 'ACC-U3', 'WALLET', 'MYR', 'ACTIVE'),
  ('77777777-7777-4777-8777-000000000004', '66666666-6666-4666-8666-000000000004', 'ACC-U4', 'WALLET', 'MYR', 'ACTIVE'),
  ('77777777-7777-4777-8777-000000000005', '66666666-6666-4666-8666-000000000005', 'ACC-M1', 'WALLET', 'MYR', 'ACTIVE'),
  ('77777777-7777-4777-8777-000000000006', '66666666-6666-4666-8666-000000000006', 'ACC-M2', 'WALLET', 'MYR', 'ACTIVE');

INSERT INTO wallets (id, account_id, wallet_number, currency, status) VALUES
  ('88888888-8888-4888-8888-000000000001', '77777777-7777-4777-8777-000000000001', 'WAL-U1', 'MYR', 'ACTIVE'),
  ('88888888-8888-4888-8888-000000000002', '77777777-7777-4777-8777-000000000002', 'WAL-U2', 'MYR', 'ACTIVE'),
  ('88888888-8888-4888-8888-000000000003', '77777777-7777-4777-8777-000000000003', 'WAL-U3', 'MYR', 'ACTIVE'),
  ('88888888-8888-4888-8888-000000000004', '77777777-7777-4777-8777-000000000004', 'WAL-U4', 'MYR', 'ACTIVE'),
  ('88888888-8888-4888-8888-000000000005', '77777777-7777-4777-8777-000000000005', 'WAL-M1', 'MYR', 'ACTIVE'),
  ('88888888-8888-4888-8888-000000000006', '77777777-7777-4777-8777-000000000006', 'WAL-M2', 'MYR', 'ACTIVE');

-- Chart of accounts
INSERT INTO ledger_accounts (id, code, name, account_class, normal_balance, wallet_id, currency, status) VALUES
  ('99999999-9999-4999-8999-000000000001', '1001', 'Provider Settlement Clearing', 'ASSET',     'DEBIT',  NULL, 'MYR', 'ACTIVE'),
  ('99999999-9999-4999-8999-000000000002', '2900', 'Wallet Liability Control',      'LIABILITY', 'CREDIT', NULL, 'MYR', 'ACTIVE'),
  ('99999999-9999-4999-8999-000000000003', '4001', 'Fee Income',                    'REVENUE',   'CREDIT', NULL, 'MYR', 'ACTIVE'),
  ('99999999-9999-4999-8999-000000000004', '3001', 'System Adjustment',             'EQUITY',    'CREDIT', NULL, 'MYR', 'ACTIVE'),
  ('99999999-9999-4999-8999-000000000011', '2001-U1', 'Wallet liability — Aisyah Binti Rahman', 'LIABILITY', 'CREDIT', '88888888-8888-4888-8888-000000000001', 'MYR', 'ACTIVE'),
  ('99999999-9999-4999-8999-000000000012', '2001-U2', 'Wallet liability — Daniel Tan Wei Ming', 'LIABILITY', 'CREDIT', '88888888-8888-4888-8888-000000000002', 'MYR', 'ACTIVE'),
  ('99999999-9999-4999-8999-000000000013', '2001-U3', 'Wallet liability — Kavitha Subramaniam', 'LIABILITY', 'CREDIT', '88888888-8888-4888-8888-000000000003', 'MYR', 'ACTIVE'),
  ('99999999-9999-4999-8999-000000000014', '2001-U4', 'Wallet liability — Farid Bin Hassan',    'LIABILITY', 'CREDIT', '88888888-8888-4888-8888-000000000004', 'MYR', 'ACTIVE'),
  ('99999999-9999-4999-8999-000000000021', '2002-M1', 'Wallet liability — Kampus Cafe',         'LIABILITY', 'CREDIT', '88888888-8888-4888-8888-000000000005', 'MYR', 'ACTIVE'),
  ('99999999-9999-4999-8999-000000000022', '2002-M2', 'Wallet liability — Campus Bookstore',    'LIABILITY', 'CREDIT', '88888888-8888-4888-8888-000000000006', 'MYR', 'ACTIVE');

-- Payment providers
INSERT INTO payment_providers
  (id, code, name, priority, enabled, environment, status, notes, api_base_url, sandbox_base_url,
   auth_type, auth_header, credential_secret_name, charge_path, status_path, webhook_url, config) VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-000000000001', 'SANDBOX', 'CBS Sandbox Gateway', 10, 1, 'sandbox', 'ACTIVE',
   'Built-in simulator: charges succeed immediately. Use for testing.', NULL, 'https://sandbox.local/cbs',
   'BEARER', 'Authorization', 'SANDBOX_API_KEY', '/v1/charges', '/v1/charges/{id}', NULL, '{"simulate":true}'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-000000000002', 'FPX', 'FPX Online Banking', 20, 0, 'sandbox', 'PENDING',
   'Add the live base URL and API key before enabling.', 'https://api.fpx-provider.com', 'https://sandbox.fpx-provider.com',
   'BEARER', 'Authorization', 'FPX_API_KEY', '/v1/charges', '/v1/charges/{id}', NULL, '{}'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-000000000003', 'CARD', 'Card Acquirer', 30, 0, 'sandbox', 'PENDING',
   'Card acquiring — awaiting credentials.', 'https://api.card-acquirer.com', 'https://sandbox.card-acquirer.com',
   'APIKEY', 'X-API-Key', 'CARD_API_KEY', '/payments', '/payments/{id}', NULL, '{}');

-- senangPay (DOKU) sandbox
INSERT INTO payment_providers
  (id, code, name, provider_type, priority, enabled, environment, status, notes, api_base_url, sandbox_base_url,
   auth_type, auth_header, auth_credential_key, charge_method, charge_path, status_method, status_path,
   refund_method, refund_path, cancel_method, cancel_path, currency, config) VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-000000000004', 'SENANGPAY', 'senangPay (DOKU) Sandbox', 'PAYMENT_GATEWAY', 5, 1, 'sandbox', 'ACTIVE',
   'senangPay / DOKU sandbox. Credentials configured: API key, secret key, public key and Client ID.',
   'https://api.doku.com', 'https://api-sandbox.doku.com',
   'SIGNATURE', 'Client-Id', 'client_id', 'POST', '/checkout/v1/payment', 'GET', '/orders/v1/status/{id}',
   'POST', '/refund/v1/refund', 'POST', '/orders/v1/cancel/{id}', 'MYR',
   '{"request":{"order.amount":"$transaction.amount","order.invoice_number":"$transaction.reference","order.currency":"$transaction.currency"},"response":{"provider_reference":"response.order.invoice_number","status":"response.order.status","checkout_url":"response.payment.url"},"status_mapping":{"SUCCESS":"SUCCESS","PENDING":"PENDING","FAILED":"FAILED","EXPIRED":"CANCELLED"},"signature":{"algorithm":"HMAC-SHA256","secret_credential":"secret_key","header":"Signature"}}');

INSERT INTO payment_provider_credentials
  (provider_id, environment, credential_key, credential_label, credential_type, encrypted_value, is_required, is_secret) VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-000000000004', 'sandbox', 'client_id', 'Client ID', 'text', 'plain:BRN-0221-1790574635839', 1, 0),
  ('aaaaaaaa-aaaa-4aaa-8aaa-000000000004', 'sandbox', 'api_key', 'API Key', 'password', 'plain:doku_key_sandbox_b7e9efe909e94a2d9b373dade99b4337', 0, 1),
  ('aaaaaaaa-aaaa-4aaa-8aaa-000000000004', 'sandbox', 'secret_key', 'Secret Key', 'password', 'plain:SK-lywUjepVfcjf1mnFnk0E', 1, 1),
  ('aaaaaaaa-aaaa-4aaa-8aaa-000000000004', 'sandbox', 'doku_public_key', 'DOKU Public Key', 'textarea',
   'plain:-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAoF6MJW74Jl3PK8dtcYq0glj2bjjMYajwlFyaJzh5pCOm2GusYDNicEkYvNAWZsk1zB2BVBwPi17+WPl3DRLrxNhZlGqVxKDbMT/cIm0kZqVx+5blc+SKky3qR5j8T/U/JMuxtwYKcSchRBGduyUp7kSRxWqpolIlFJ9maKSzXdUK1OuTJHz+D9m4qyY1weikHgPXDL1uShOeiynFW0xZlD8hEyiIcFABb+BzFJkXYbNIhXandLEBYX+M3b8E0bR4VCpni8ECLbBPTDYSl4yuUjZjYvThpr/VNd3AjWrMmMFUf/MVGZl2lKQS93gpRhAupkYjWWmhT5AEwFPq74PlgwIDAQAB\n-----END PUBLIC KEY-----', 0, 0);

INSERT INTO payment_methods (provider_id, code, name, enabled) VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-000000000004', 'CARD', 'Card', 1),
  ('aaaaaaaa-aaaa-4aaa-8aaa-000000000004', 'FPX', 'FPX online banking', 1),
  ('aaaaaaaa-aaaa-4aaa-8aaa-000000000004', 'EWALLET', 'E-wallet', 1),
  ('aaaaaaaa-aaaa-4aaa-8aaa-000000000001', 'SIM_INSTANT', 'Simulated Instant Payment', 1),
  ('aaaaaaaa-aaaa-4aaa-8aaa-000000000002', 'FPX_B2C', 'FPX Retail Banking', 1),
  ('aaaaaaaa-aaaa-4aaa-8aaa-000000000002', 'FPX_B2B', 'FPX Corporate Banking', 1),
  ('aaaaaaaa-aaaa-4aaa-8aaa-000000000003', 'VISA', 'Visa', 1),
  ('aaaaaaaa-aaaa-4aaa-8aaa-000000000003', 'MASTERCARD', 'Mastercard', 1);

-- Demo wallet reloads (posted through the ledger, so balances move)
CALL post_transaction('RLD-DEMO-0001', 'WALLET_RELOAD', 'Wallet reload via SANDBOX', 'MYR',
  '22222222-2222-4222-8222-000000000001', 'RLD-DEMO-0001',
  '[{"ledger_account_id":"99999999-9999-4999-8999-000000000001","direction":"DEBIT","amount":500.00},
    {"ledger_account_id":"99999999-9999-4999-8999-000000000011","direction":"CREDIT","amount":500.00}]', @txn1);

CALL post_transaction('RLD-DEMO-0002', 'WALLET_RELOAD', 'Wallet reload via SANDBOX', 'MYR',
  '22222222-2222-4222-8222-000000000001', 'RLD-DEMO-0002',
  '[{"ledger_account_id":"99999999-9999-4999-8999-000000000001","direction":"DEBIT","amount":250.00},
    {"ledger_account_id":"99999999-9999-4999-8999-000000000012","direction":"CREDIT","amount":250.00}]', @txn2);

CALL post_transaction('RLD-DEMO-0003', 'WALLET_RELOAD', 'Wallet reload via SANDBOX', 'MYR',
  '22222222-2222-4222-8222-000000000001', 'RLD-DEMO-0003',
  '[{"ledger_account_id":"99999999-9999-4999-8999-000000000001","direction":"DEBIT","amount":120.50},
    {"ledger_account_id":"99999999-9999-4999-8999-000000000013","direction":"CREDIT","amount":120.50}]', @txn3);

INSERT INTO payment_intents
  (provider_id, method_code, wallet_id, amount, currency, status, environment,
   provider_reference, reference, transaction_id, metadata, created_by) VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-000000000001', 'SIM_INSTANT', '88888888-8888-4888-8888-000000000001', 500.00, 'MYR', 'SUCCEEDED', 'sandbox', 'SIM-0001', 'RLD-DEMO-0001', @txn1, '{"simulated":true}', '11111111-1111-4111-8111-111111111111'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-000000000001', 'SIM_INSTANT', '88888888-8888-4888-8888-000000000002', 250.00, 'MYR', 'SUCCEEDED', 'sandbox', 'SIM-0002', 'RLD-DEMO-0002', @txn2, '{"simulated":true}', '11111111-1111-4111-8111-111111111111'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-000000000001', 'SIM_INSTANT', '88888888-8888-4888-8888-000000000003', 120.50, 'MYR', 'SUCCEEDED', 'sandbox', 'SIM-0003', 'RLD-DEMO-0003', @txn3, '{"simulated":true}', '11111111-1111-4111-8111-111111111111'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-000000000001', 'SIM_INSTANT', '88888888-8888-4888-8888-000000000004',  80.00, 'MYR', 'PENDING',   'sandbox', 'SIM-0004', 'RLD-DEMO-0004', NULL,  '{"simulated":true}', '11111111-1111-4111-8111-111111111112');

-- Demo wallet-to-wallet transfers (user pays a merchant)
CALL post_transaction('TRF-DEMO-0001', 'TRANSFER', 'Transfer WAL-U1 -> WAL-M1', 'MYR',
  '22222222-2222-4222-8222-000000000001', 'TRF-DEMO-0001',
  '[{"ledger_account_id":"99999999-9999-4999-8999-000000000011","direction":"DEBIT","amount":45.00},
    {"ledger_account_id":"99999999-9999-4999-8999-000000000021","direction":"CREDIT","amount":45.00}]', @txn4);

INSERT INTO transfers (transaction_id, from_wallet_id, to_wallet_id, amount, currency, status, reference, note, created_by)
VALUES (@txn4, '88888888-8888-4888-8888-000000000001', '88888888-8888-4888-8888-000000000005', 45.00, 'MYR', 'POSTED',
        'TRF-DEMO-0001', 'Lunch at Kampus Cafe', '11111111-1111-4111-8111-111111111112');

CALL post_transaction('TRF-DEMO-0002', 'TRANSFER', 'Transfer WAL-U2 -> WAL-M2', 'MYR',
  '22222222-2222-4222-8222-000000000001', 'TRF-DEMO-0002',
  '[{"ledger_account_id":"99999999-9999-4999-8999-000000000012","direction":"DEBIT","amount":89.90},
    {"ledger_account_id":"99999999-9999-4999-8999-000000000022","direction":"CREDIT","amount":89.90}]', @txn5);

INSERT INTO transfers (transaction_id, from_wallet_id, to_wallet_id, amount, currency, status, reference, note, created_by)
VALUES (@txn5, '88888888-8888-4888-8888-000000000002', '88888888-8888-4888-8888-000000000006', 89.90, 'MYR', 'POSTED',
        'TRF-DEMO-0002', 'Textbook purchase', '11111111-1111-4111-8111-111111111112');

INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata) VALUES
  ('11111111-1111-4111-8111-111111111111', 'SEED_DATABASE',   'database', 'cbs', '{"source":"database.sql"}'),
  ('11111111-1111-4111-8111-111111111111', 'CBS_REGISTER_USER','users',   'U1',  '{"wallet_number":"WAL-U1"}'),
  ('11111111-1111-4111-8111-111111111112', 'CBS_TRANSFER',     'transfers','TRF-DEMO-0001', '{"amount":45.00}');

-- Sanity check: the ledger must balance
SELECT
  (SELECT COALESCE(SUM(amount),0) FROM ledger_entries WHERE direction='DEBIT')  AS total_debits,
  (SELECT COALESCE(SUM(amount),0) FROM ledger_entries WHERE direction='CREDIT') AS total_credits;

SELECT wallet_number, currency, available_balance FROM wallets ORDER BY wallet_number;
