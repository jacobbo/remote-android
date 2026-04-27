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

# Two configs ship in the image. The startup script picks one based on whether
# /etc/nginx/certs holds a valid Cloudflare Origin Cert at runtime.
COPY nginx.conf      /etc/nginx/conf.d/default.conf
COPY nginx.prod.conf /etc/nginx/conf.d/default.prod.conf

# Hooked into the official nginx image's docker-entrypoint.d framework.
COPY docker-entrypoint.d-30-pick-conf.sh /docker-entrypoint.d/30-pick-conf.sh
RUN chmod +x /docker-entrypoint.d/30-pick-conf.sh

EXPOSE 80 443
