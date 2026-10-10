FROM node:20-alpine AS builder

WORKDIR /app

# Install root dependencies
COPY package*.json tsconfig.json ./
RUN npm install

# Install web dependencies and build web
COPY web/package*.json web/
RUN cd web && npm install

COPY . .
RUN npm run build

FROM node:20-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm install --omit=dev

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/web/dist ./web/dist
COPY --from=builder /app/results ./results

EXPOSE 3000

CMD ["node", "dist/src/api/server.js"]
