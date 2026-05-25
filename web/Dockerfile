# Build stage
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Serve stage
FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html

# The nginx config is NOT baked into the image. docker-compose.yml bind-mounts
# nginx.prod.conf (HTTPS + Cloudflare Origin Cert) by default, and
# docker-compose.override.yml overrides that with nginx.conf (plain HTTP) for
# LAN dev. The default conf shipped with the nginx:alpine base image (which
# would otherwise serve from /usr/share/nginx/html on :80) is replaced by the
# mount on container start.

EXPOSE 80 443
