FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY server.mjs ./
ENV NODE_ENV=production
ENV PORT=8787
EXPOSE 8787
USER node
CMD ["node", "server.mjs"]
