#!/bin/sh
# nginx Docker entrypoint runs every executable in /docker-entrypoint.d/
# before launching nginx. We use that hook to pick the prod (TLS) config when
# the Cloudflare Origin Certificate is bind-mounted into the container, and
# stay on the dev (port 80 only) config otherwise. The cert directory is
# always present because compose binds ./certs/, but it's empty in dev — so
# checking for the actual origin.pem file is what flips the mode.
set -e

if [ -f /etc/nginx/certs/origin.pem ] && [ -f /etc/nginx/certs/origin-key.pem ]; then
    cp /etc/nginx/conf.d/default.prod.conf /etc/nginx/conf.d/default.conf
    echo "[nginx] TLS certs detected — serving HTTPS on 443 with HTTP→HTTPS redirect on 80"
else
    echo "[nginx] No TLS certs in /etc/nginx/certs — staying on plain HTTP (port 80)"
fi
