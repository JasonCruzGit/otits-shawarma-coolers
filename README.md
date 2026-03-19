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
- Backend: **Plain PHP** (compatible with shared hosting — no Node.js required)
- Persistence: JSON file storage (`api/data/db.json`, auto-created on first request)
- Charts: Recharts

## Hostinger Deployment (Shared Hosting)

Upload the following to your `public_html/` directory:

```
public_html/
  .htaccess          ← from project root
  index.html         ← from frontend/dist/
  assets/            ← from frontend/dist/assets/
  api/
    .htaccess
    index.php
    helpers.php
    data/
      .htaccess      ← protects db.json from direct web access
```

Steps:

1. Build the frontend locally: `cd frontend && npm run build`
2. Upload `frontend/dist/*` (index.html, assets/) into `public_html/`
3. Upload the root `.htaccess` into `public_html/`
4. Upload the entire `api/` folder into `public_html/api/`
5. Make sure `public_html/api/data/` directory exists and is writable (chmod 755 or 775)
6. Visit your domain — the database seeds automatically on first request

## Quick Start (Local)

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Runs at `http://localhost:5173`.

### Backend (PHP)

If you have PHP installed locally:

```bash
cd api
php -S localhost:4000 index.php
```

Or set `VITE_API_BASE_URL=http://localhost:4000` in `frontend/.env`.

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
- Products
  - `POST /api/products`
  - `PATCH /api/products/:id`
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
  - `GET /api/health`

## Database Structure

Primary collections in `api/data/db.json` (auto-created):

- `branches`
- `categories`
- `products` (with `recipe` for inventory deduction)
- `inventoryByBranch`
- `orders`
- `users`
- `inventoryLogs`
- `stockTransfers`
