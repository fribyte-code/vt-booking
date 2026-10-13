# Multi-stage build of the React app, served by Nginx, which also proxies /api to the backend.
# The main app is always the production build, which vite.config.ts forces into API mode.
#
# WITH_DEMO=true (local compose.yaml only) also builds the standalone demo into /demo/ and shows
# "Prøv demo" on the login page. The demo is a separate build with no API code. The default
# (false) gives an image with no demo, no mock users and no link to either.

FROM node:22-alpine AS build
ARG WITH_DEMO=false
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN if [ "$WITH_DEMO" = "true" ]; then \
      VITE_DEMO_URL=/demo/ npm run build && \
      VITE_LOGIN_URL=/ npx vite build --mode demo --base /demo/ --outDir dist/demo; \
    else \
      npm run build; \
    fi

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
