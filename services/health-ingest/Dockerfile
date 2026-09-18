FROM node:22-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY src ./src
COPY sql ./sql

USER node
EXPOSE 8088

CMD ["node", "src/server.js"]
