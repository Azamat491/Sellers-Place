FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY public ./public
ENV DATA_DIR=/data
VOLUME /data
EXPOSE 3000
CMD ["npm", "start"]
