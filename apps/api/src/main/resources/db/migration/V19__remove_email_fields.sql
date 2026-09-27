ALTER TABLE users
    DROP INDEX uk_users_email,
    DROP COLUMN email;

ALTER TABLE home_profile
    DROP COLUMN email;

ALTER TABLE member_invitations
    RENAME COLUMN sent_at TO issued_at;
