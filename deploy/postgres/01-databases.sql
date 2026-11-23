\set ON_ERROR_STOP on
\getenv web_password POSTGRES_WEB_PASSWORD
\getenv checkpoint_password POSTGRES_CHECKPOINT_PASSWORD

CREATE ROLE buildurprofile_web LOGIN PASSWORD :'web_password';
CREATE ROLE buildurprofile_checkpoint LOGIN PASSWORD :'checkpoint_password';

CREATE DATABASE buildurprofile OWNER buildurprofile_web;
CREATE DATABASE buildurprofile_checkpoints OWNER buildurprofile_checkpoint;

REVOKE CONNECT ON DATABASE buildurprofile FROM PUBLIC;
REVOKE CONNECT ON DATABASE buildurprofile_checkpoints FROM PUBLIC;
GRANT CONNECT ON DATABASE buildurprofile TO buildurprofile_web;
GRANT CONNECT ON DATABASE buildurprofile_checkpoints TO buildurprofile_checkpoint;
