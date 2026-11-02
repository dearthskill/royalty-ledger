-- =====================================================================
-- Seed data (development / demo). All demo passwords: Password@123
-- Wrapped in one transaction so the deferred group-share check runs at COMMIT.
-- =====================================================================
BEGIN;

INSERT INTO app_user (email, password_hash, display_name, role) VALUES
    ('admin@royalty.test',   crypt('Password@123', gen_salt('bf', 10)), 'Label Admin',  'admin'),
    ('auditor@royalty.test', crypt('Password@123', gen_salt('bf', 10)), 'Finance Audit', 'auditor'),
    ('nova@royalty.test',    crypt('Password@123', gen_salt('bf', 10)), 'Nova',          'artist'),
    ('kai@royalty.test',     crypt('Password@123', gen_salt('bf', 10)), 'Kai',           'artist'),
    ('mira@royalty.test',    crypt('Password@123', gen_salt('bf', 10)), 'Mira',          'artist'),
    ('lina@royalty.test',    crypt('Password@123', gen_salt('bf', 10)), 'Lina',          'artist');

-- artist ids: 1 Nova, 2 Kai, 3 Mira, 4 Lina, 5 Night Owls (group), 6 Owl Beats Collective (group)
INSERT INTO artist (user_id, stage_name, kind) VALUES
    (3, 'Nova', 'solo'),
    (4, 'Kai',  'solo'),
    (5, 'Mira', 'solo'),
    (6, 'Lina', 'solo'),
    (NULL, 'The Night Owls',      'group'),
    (NULL, 'Owl Beats Collective', 'group');

-- Nested groups:  Night Owls = Nova 50% + Owl Beats Collective 50%
--                 Owl Beats Collective = Kai 60% + Lina 40%
INSERT INTO group_member (group_id, member_id, share_pct) VALUES
    (6, 2, 60), (6, 4, 40),
    (5, 1, 50), (5, 6, 50);

INSERT INTO platform (code, display_name, rate_per_play) VALUES
    ('spotify',     'Spotify',     0.004000),
    ('youtube',     'YouTube',     0.002000),
    ('apple_music', 'Apple Music', 0.007000),
    ('radio',       'Radio',       0.001500);

INSERT INTO track (isrc, title, release_date) VALUES
    ('INABC2600001', 'Midnight Static',      '2026-03-14'),
    ('INABC2600002', 'Paper Lanterns',       '2026-05-02'),
    ('INABC2600003', 'Neon Monsoon Drive',   '2026-07-19');

-- Track 1: Night Owls 80% + Mira 20% (featured)  => Nova 40, Kai 24, Lina 16, Mira 20
SELECT create_contract_draft(1, 1);
INSERT INTO contract_split (contract_id, artist_id, share_pct) VALUES (1, 5, 80), (1, 3, 20);
SELECT activate_contract(1);

-- Track 2: Nova 100%
SELECT create_contract_draft(2, 1);
INSERT INTO contract_split (contract_id, artist_id, share_pct) VALUES (2, 1, 100);
SELECT activate_contract(2);

-- Track 3: Kai 50% + Lina 50%
SELECT create_contract_draft(3, 1);
INSERT INTO contract_split (contract_id, artist_id, share_pct) VALUES (3, 2, 50), (3, 4, 50);
SELECT activate_contract(3);

INSERT INTO payout_period (period_start, period_end) VALUES ('2026-09-01', '2026-09-30');

COMMIT;
