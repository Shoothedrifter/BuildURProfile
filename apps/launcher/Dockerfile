FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY . .
RUN npm ci --ignore-scripts && npm run build

FROM node:24-bookworm-slim
ENV NODE_ENV=production SERVER_HOST=0.0.0.0 SERVER_PORT=8787
WORKDIR /app
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/launcher ./apps/launcher
COPY --from=build /app/apps/web ./apps/web
COPY --from=build /app/packages ./packages
RUN mkdir -p /app/data && chown -R node:node /app
USER node
EXPOSE 8787
CMD ["node", "apps/launcher/src/index.mjs"]
