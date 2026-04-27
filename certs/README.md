# Origin certificates

Drop the Cloudflare Origin Certificate here as `origin.pem` + `origin-key.pem`
to enable TLS termination on the frontend nginx (port 443) and on coturn
(TURNS / port 5349 — uncomment the `cert=`/`pkey=` lines in `turnserver.conf`).

Generated under Cloudflare → SSL/TLS → Origin Server → Create Certificate.
Default validity is 15 years; no Let's Encrypt renewal needed because the
certificate is only ever presented to Cloudflare's edge servers.

This directory is git-ignored except for the .gitkeep + this README. Do NOT
commit real keys.
