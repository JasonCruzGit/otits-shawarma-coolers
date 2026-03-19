# Otit's Shawarma & Coolers POS System

Full-featured multi-branch Point of Sale system with sales and inventory monitoring, optimized for a black-and-gold elegant UI.

## Implemented Modules

- Multi-branch support:
  - Otit's Rizal Ave Branch
  - Otit's PPIA Branch
  - Branch-scoped filtering and central admin consolidation
- POS:
  - Touch-friendly product tiles
  - Category grouping (Shawarma, Coolers, Add-ons)
  - Fast cart + auto total computation
  - Cash and QR payment handling
  - Digital receipt generation
- Sales Monitoring:
  - Real-time summary (daily/weekly/monthly)
  - Total sales, transaction count, best sellers
  - Branch performance comparison (admin)
- Inventory:
  - Inventory per branch
  - Auto-deduction on each sale via product recipes
  - Low stock alerts
  - Manual stock adjustment with logs
  - Stock transfer between branches
- Roles and Access:
  - Admin (full access)
  - Branch Manager (branch control)
  - Cashier (POS + branch sales operations)
  - JWT authentication
- Centralized Admin:
  - Consolidated branch dashboard
  - User listing/creation endpoint
  - Backup and restore
- Reports:
  - Sales CSV export
  - Inventory usage CSV export

## Tech Stack

- Frontend: React + Vite
- Backend: Node.js + Express
- Persistence: LowDB JSON file storage (`backend/data/db.json`)
- Charts: Recharts

## Quick Start (Local)

### 1) Backend

```bash
cd backend
cp .env.example .env
npm install
npm run dev
```

Runs at `http://localhost:4000`.

### 2) Frontend

```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```

Runs at `http://localhost:5173`.

## Default Login Accounts

- `admin` / `admin1234`
- `rizal.manager` / `manager1234`
- `ppia.cashier` / `cashier1234`

## API Endpoints (Core)

- Auth
  - `POST /api/auth/login`
  - `GET /api/auth/me`
- Branch / Catalog
  - `GET /api/branches`
  - `GET /api/catalog`
- POS / Orders
  - `POST /api/orders`
  - `GET /api/orders`
  - `POST /api/sync/offline-orders`
- Dashboard
  - `GET /api/dashboard/summary`
  - `GET /api/admin/overview`
- Inventory
  - `GET /api/inventory`
  - `GET /api/inventory/alerts`
  - `POST /api/inventory/adjust`
  - `POST /api/inventory/transfer`
- Reports
  - `GET /api/reports/sales.csv`
  - `GET /api/reports/inventory-usage.csv`
- Admin
  - `GET /api/admin/users`
  - `POST /api/admin/users`
- System
  - `GET /api/system/backup`
  - `POST /api/system/restore`

## Database Structure

Primary collections in `backend/data/db.json`:

- `branches`
- `categories`
- `products` (with `recipe` for inventory deduction)
- `inventoryByBranch`
- `orders`
- `users`
- `inventoryLogs`
- `stockTransfers`

## Deployment (Docker Compose)

From project root:

```bash
docker compose up --build
```

- Frontend: `http://localhost:5173`
- Backend API: `http://localhost:4000`

## Notes

- Profit estimation can be added by introducing ingredient costs and COGS calculations per order.
- Offline sync is included via `/api/sync/offline-orders`.
- For production cloud deployments, migrate persistence to PostgreSQL/MySQL while preserving endpoint contracts.
