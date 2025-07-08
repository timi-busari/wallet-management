# 💰 Wallet Management System

A modular, scalable wallet service built with **NestJS**, **Prisma**, **PostgreSQL**, **Redis**, and **BullMQ**, offering robust APIs for wallet creation, deposits, withdrawals, transfers, and transaction management — with support for **optimistic locking**, **idempotency**, and **background job processing**.

---

## ⚙️ Features

* 🔐 **API Key Authentication** (via `ApiKeyGuard`)
* 🏦 Wallet lifecycle: create, retrieve, deactivate
* 💸 Funds: deposit, withdraw, transfer
* 🧾 Transaction listing, stats, and history
* 🧠 **Idempotency** support via `referenceId`
* 🔄 **Optimistic Concurrency** with version tracking
* 🐂 Background processing with Bull (Redis-based queue)
* 🧪 Jest-based testing and coverage tracking
* 📦 Docker-ready PostgreSQL and Redis services

---

## 🚀 Getting Started

### Prerequisites

* Node.js >= 18
* Docker & Docker Compose
* `npm` or `yarn`

### Option 1: Running with Docker (Recommended)

This is the easiest way to get the application running with all dependencies.

#### 1. Clone the Repository

```bash
git clone https://github.com/timi-busari/wallet-management
cd wallet-management
```


#### 2. Build and Start All Services

```bash
# Build and start all services (PostgreSQL, Redis, and the app)
docker-compose up --build
```

#### 3. Initialize Database and Seed Data

In a new terminal window, run the following commands:

```bash
# Generate Prisma client
docker exec -it wallet-app yarn prisma:generate

# Run database migrations
docker exec -it wallet-app yarn prisma:migrate

# Seed the database with initial data
docker exec -it wallet-app yarn prisma:seed
```

#### 4. Access the Application

* **API**: http://localhost:3000

#### 5. Stopping the Services

```bash
# Stop all services
docker-compose down

# Stop and remove volumes (clears all data)
docker-compose down -v
```

---

### Option 2: Local Development Setup

If you prefer to run the application locally without Docker for the app itself:

#### 1. Clone the Repository

```bash
git clone https://github.com/timi-busari/wallet-management
cd wallet-management
```

#### 2. Start Required Services Only

```bash
# Start only PostgreSQL and Redis
docker-compose up -d postgres redis
```

#### 3. Install Dependencies

```bash
npm install
# or
yarn install
```

#### 4. Setup Environment

Create a `.env` file:

```env
# Server Configuration
PORT=3000
NODE_ENV=development

# Database Configuration
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=wallet_user
DB_PASSWORD=wallet_password
DB_NAME=wallet_system

DATABASE_URL="postgresql://${DB_USERNAME}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}?schema=public"

# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379

# Queue Configuration
QUEUE_REDIS_HOST=localhost
QUEUE_REDIS_PORT=6379

# API Configuration
API_KEY=6pfrn00011248xivxkz0t
CORS_ORIGIN=*
```

#### 5. Initialize Database

```bash
npx prisma generate
npx prisma migrate dev --name init
npx prisma db seed
```

#### 6. Start the Application

```bash
npm run start:dev
# or
yarn start:dev
```

---

## 🧪 Testing

### Running Tests Locally

```bash
# Test with coverage
npm run test:cov
```

### Running Tests in Docker

```bash
# Run tests inside the container
docker exec -it wallet-app npm test

# Run tests with coverage
docker exec -it wallet-app npm run test:cov
```

---

## 📜 API Overview

> All requests must include the header:
> `wallet-api-key: your-secure-api-key`

### Wallet Endpoints

| Method | Path                         | Description              |
| ------ | ---------------------------- | ------------------------ |
| POST   | `/wallets`                   | Create a wallet          |
| GET    | `/wallets/:walletId`         | Get wallet details       |
| GET    | `/wallets/:walletId/balance` | Check wallet balance     |
| GET    | `/wallets/user/:userId`      | List wallets by user     |
| POST   | `/wallets/deposit`           | Initiate deposit         |
| POST   | `/wallets/withdraw`          | Initiate withdrawal      |
| POST   | `/wallets/transfer`          | Transfer between wallets |
| DELETE | `/wallets/:walletId`         | Deactivate wallet        |

### Transaction Endpoints

| Method | Path                                   | Description                    |
| ------ | -------------------------------------- | ------------------------------ |
| GET    | `/transactions/wallet/:walletId`       | List transactions for a wallet |
| GET    | `/transactions/:transactionId`         | Get transaction by ID          |
| GET    | `/transactions/wallet/:walletId/stats` | Get wallet transaction summary |

### Documentation 
https://www.postman.com/planetary-meteor-198252/wallet-management/overview

---

## 🧱 Architecture Decisions

### ✅ Assumptions Made

* A user can only have one active wallet at a time.
* Transfers are split into two separate transactions: `TRANSFER_OUT` and `TRANSFER_IN`.
* All transactional operations should be processed asynchronously for scalability.
* Transaction retries should be safe and idempotent.

### 📌 Key Design Decisions

* **Prisma ORM** is used for DB access with PostgreSQL.
* **Bull** is used for processing deposits, withdrawals, and transfers.
* **Redis** serves as both a cache and job queue backend.
* **Decimal.js** is used to handle all monetary operations accurately.
* **Optimistic Locking** ensures transactional updates are safe from race conditions.
* **Idempotency** is enforced by `referenceId` field to prevent duplicates.
* Prisma query logs are enabled via `$on()` for visibility during development.

---

## 📦 Directory Structure

```
src/
├── wallet/               # Wallet controllers, services, DTOs
├── transaction/          # Transaction controllers, services, DTOs
├── processor/            # Bull job processors (deposit, withdraw, transfer)
├── guards/               # ApiKeyGuard for securing routes
├── config/               # App configuration logic
├── prisma/               # PrismaService with transaction helpers
```

---

## 🔐 Security

All APIs are secured with an API Key. Add the following header to every request:

```http
wallet-api-key: your-secure-api-key
```

The default API key is `6pfrn00011248xivxkz0t`. You can customize this value in `.env`.

---


## 📄 License

This project is **UNLICENSED**. You are free to use, fork, or modify it at your own risk.

---

## 👤 Author

**Timi Busari**  
GitHub: [timi-busari](https://github.com/timi-busari)
