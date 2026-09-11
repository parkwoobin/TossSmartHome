FROM node:24-alpine

WORKDIR /app

COPY package.json ./
COPY server.js ./
COPY dist ./dist

ENV SMART_HOME_API_HOST=0.0.0.0
ENV SMART_HOME_API_PORT=4176

EXPOSE 4176

CMD ["node", "server.js"]
