FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json tsconfig.backend.json ./
COPY packages/contracts/typescript/package.json packages/contracts/typescript/package.json
COPY packages/backend-common/package.json packages/backend-common/package.json
COPY services/document-service/package.json services/document-service/package.json
COPY services/rule-engine/package.json services/rule-engine/package.json
COPY services/reconciliation-service/package.json services/reconciliation-service/package.json
COPY services/anomaly-service/package.json services/anomaly-service/package.json
COPY services/legal-rag-service/package.json services/legal-rag-service/package.json
COPY apps/api/package.json apps/api/package.json

RUN npm ci

# Build workspace packages once so their package exports are available. The
# application and service sources are mounted by docker-compose in development.
COPY packages packages
RUN npm run build:shared

ENV NODE_ENV=development

EXPOSE 8000

