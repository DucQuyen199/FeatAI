FROM node:22-bookworm-slim AS build

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

COPY packages packages
COPY services services
COPY apps/api apps/api
COPY config config
COPY legal/manifest.json legal/manifest.json
COPY legal/raw legal/raw
COPY legal/processed/legal_chunks.jsonl legal/processed/legal_chunks.jsonl
COPY legal/processed/corpus_index.json legal/processed/corpus_index.json
COPY legal/processed/extraction_report.json legal/processed/extraction_report.json
RUN npm run build:backend && npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/packages packages
COPY --from=build /app/services services
COPY --from=build /app/apps/api apps/api
COPY --from=build /app/config config
COPY --from=build /app/legal legal

USER node
EXPOSE 8000
CMD ["node", "apps/api/dist/index.js"]
