FROM node:18-alpine

WORKDIR /app

# Install OpenSSL
RUN apk update && \
    apk add --no-cache openssl

COPY package.json yarn.lock ./
RUN yarn install --immutable --immutable-cache --check-cache

COPY . .

EXPOSE 3000
CMD ["yarn", "start:dev"]
