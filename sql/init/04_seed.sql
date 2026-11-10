-- =====================================================================
-- Seed data (development / demo). Every demo password: Password@123
--
-- artist ids: 1 Nova, 2 Kai, 3 Mira, 4 Lina (solo)
--             5 The Night Owls (group) = Nova 50% + Owl Beats Collective 50%
--             6 Owl Beats Collective (group) = Kai 60% + Lina 40%     <- nested group
-- periods:    1 '2026-09' open   (MongoDB demo usage events target this one)
--             2 '2026-08' closed (history: usage, ledger, payouts, one paid)
-- =====================================================================

-- ---------- artists, groups, logins ----------
BEGIN;   -- one transaction so the deferred "group shares = 100" check runs at COMMIT

INSERT INTO artist (name, kind, email) VALUES
    ('Nova', 'solo', 'nova@royalty.test'),
    ('Kai',  'solo', 'kai@royalty.test'),
    ('Mira', 'solo', 'mira@royalty.test'),
    ('Lina', 'solo', 'lina@royalty.test'),
    ('The Night Owls',       'group', NULL),
    ('Owl Beats Collective', 'group', NULL);

INSERT INTO group_member (group_id, member_id, share_pct) VALUES
    (6, 2, 60), (6, 4, 40),
    (5, 1, 50), (5, 6, 50);

-- gen_salt('bf') produces $2a$ bcrypt hashes, which bcryptjs verifies.
INSERT INTO app_user (email, password_hash, role, artist_id) VALUES
    ('admin@royalty.test',   crypt('Password@123', gen_salt('bf', 10)), 'admin',   NULL),
    ('auditor@royalty.test', crypt('Password@123', gen_salt('bf', 10)), 'auditor', NULL),
    ('nova@royalty.test',    crypt('Password@123', gen_salt('bf', 10)), 'artist',  1),
    ('kai@royalty.test',     crypt('Password@123', gen_salt('bf', 10)), 'artist',  2),
    ('mira@royalty.test',    crypt('Password@123', gen_salt('bf', 10)), 'artist',  3),
    ('lina@royalty.test',    crypt('Password@123', gen_salt('bf', 10)), 'artist',  4);

COMMIT;

-- ---------- platforms and tracks ----------
INSERT INTO platform (code, name, rate_per_play) VALUES
    ('spotify',     'Spotify',     0.004000),
    ('youtube',     'YouTube',     0.002000),
    ('apple_music', 'Apple Music', 0.007000);

INSERT INTO track (title, isrc, primary_artist_id, released_on) VALUES
    ('Midnight Static',    'INABC2600001', 5, '2026-03-14'),
    ('Paper Lanterns',     'INABC2600002', 1, '2026-05-02'),
    ('Neon Monsoon Drive', 'INABC2600003', 2, '2026-07-19'),
    ('Owl Light',          'INABC2600004', 6, '2026-02-10'),
    ('Glass Harbour',      'INABC2600005', 3, '2026-06-21'),
    ('Saltwater Letters',  'INABC2600006', 4, '2026-04-08'),
    ('Kerala Skyline',     'INABC2600007', 5, '2026-08-15'),
    ('Unfinished Demo',    'INABC2600008', 3, NULL);

-- ---------- contracts (draft -> splits -> activate) ----------
-- Track 1 v1: Night Owls 80% + Mira 20%  => Nova 40, Kai 24, Lina 16, Mira 20 (superseded below)
SELECT create_contract_draft(1);
INSERT INTO contract_split VALUES (1, 5, 80), (1, 3, 20);
SELECT activate_contract(1);

SELECT create_contract_draft(2);                              -- Paper Lanterns: Nova 100%
INSERT INTO contract_split VALUES (2, 1, 100);
SELECT activate_contract(2);

SELECT create_contract_draft(3);                              -- Neon Monsoon Drive: Kai 50% + Lina 50%
INSERT INTO contract_split VALUES (3, 2, 50), (3, 4, 50);
SELECT activate_contract(3);

SELECT create_contract_draft(4);                              -- Owl Light: Owl Beats Collective 100%
INSERT INTO contract_split VALUES (4, 6, 100);
SELECT activate_contract(4);

SELECT create_contract_draft(5);                              -- Glass Harbour: Mira 70% + Nova 30%
INSERT INTO contract_split VALUES (5, 3, 70), (5, 1, 30);
SELECT activate_contract(5);

SELECT create_contract_draft(6);                              -- Saltwater Letters: Lina 60% + Kai 25% + Mira 15%
INSERT INTO contract_split VALUES (6, 4, 60), (6, 2, 25), (6, 3, 15);
SELECT activate_contract(6);

SELECT create_contract_draft(7);                              -- Kerala Skyline: Night Owls 100%
INSERT INTO contract_split VALUES (7, 5, 100);
SELECT activate_contract(7);

-- Track 8 stays a draft that totals only 90% (cannot be activated: demo of the 100% rule)
SELECT create_contract_draft(8);
INSERT INTO contract_split VALUES (8, 3, 60), (8, 1, 30);

-- ---------- periods ----------
INSERT INTO payout_period (label, starts_on, ends_on) VALUES
    ('2026-09', '2026-09-01', '2026-09-30'),
    ('2026-08', '2026-08-01', '2026-08-31');

-- August history: usage -> close (uses track 1 v1) -> Nova's payout paid
INSERT INTO usage_summary (period_id, track_id, platform_code, plays) VALUES
    (2, 1, 'spotify',     100000),   -- 400.00
    (2, 2, 'youtube',      50000),   -- 100.00
    (2, 3, 'apple_music',  20000);   -- 140.00
CALL close_payout_period(2);
SELECT mark_payout_paid(payout_id) FROM payout WHERE period_id = 2 AND artist_id = 1;

-- Track 1 v2 (activated after August): Night Owls 70% + Mira 30%; v1 becomes superseded
SELECT create_contract_draft(1);                              -- contract 9, splits copied from v1
UPDATE contract_split SET share_pct = 70 WHERE contract_id = 9 AND artist_id = 5;
UPDATE contract_split SET share_pct = 30 WHERE contract_id = 9 AND artist_id = 3;
SELECT activate_contract(9);
