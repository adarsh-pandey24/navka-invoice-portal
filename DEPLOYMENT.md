# NAVKA Invoice Management — Production Deployment Guide

This guide covers Phase 11 of the implementation plan: building, configuring and running the app in production, plus the results of the performance, indexing and security audit.

## 1. Architecture in production

The Express API serves both the REST API (`/api/*`) and the built React app from one Node.js process and one origin:

```
Browser ──HTTPS──> reverse proxy (nginx / load balancer, TLS) ──> node backend/dist/server.js ──> MongoDB
                                                                    ├─ /api/*      REST API
                                                                    └─ /*          frontend/dist (SPA)
```

Hosting the frontend separately (for example on a CDN) also works. Set `VITE_API_URL` when building the frontend, set `FRONTEND_DIST=` (empty) on the API, and set `CORS_ORIGIN` to the frontend's URL.

## 2. Requirements

- Node.js 20 or later
- MongoDB 5.0 or later (the reports use `$lookup` with a pipeline). MongoDB Atlas works.
- A Shopify custom app with the `read_orders` scope and an Admin API access token
- TLS termination in front of the app. Never serve the app over plain HTTP, because logins send passwords and JWTs.

## 3. Environment checklist

Copy `backend/.env.example` to `backend/.env`. In production the server **refuses to start** if a required variable is missing.

| Variable | Required in production | Notes |
|---|---|---|
| `NODE_ENV` | yes | `production` |
| `MONGODB_URI` | yes | Without it, development falls back to an in-memory DB. Production refuses to start instead of losing data. |
| `JWT_SECRET` | yes, at least 32 characters | `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `CORS_ORIGIN` | yes | Public URL of the app, e.g. `https://invoices.navka.com` |
| `PORT` | no | Default `5000` |
| `JWT_EXPIRES_IN` | no | Default `7d` |
| `SHOPIFY_STORE_DOMAIN`, `SHOPIFY_ACCESS_TOKEN`, `SHOPIFY_API_VERSION` | for Shopify sync | With the demo token, sync runs in mock mode |
| `SHOPIFY_DEFAULT_HSN` | no | Default `UNMAPPED`, so unmapped products are visible in reports instead of silently wrong |
| `TRUST_PROXY` | behind a proxy | `1` for one proxy hop. Needed for correct client IPs in the login rate limit. |
| `LOGIN_MAX_ATTEMPTS`, `LOGIN_WINDOW_MINUTES` | no | Default 10 failed attempts per IP + email per 15 minutes |
| `REPORT_TIMEZONE` | no | Default `Asia/Kolkata`; used to group the report's daily trend |
| `FRONTEND_DIST` | no | Default `../frontend/dist`. Set it to an empty value to disable serving the frontend. |

## 4. Build

```bash
# Backend
cd backend
npm ci
npm run typecheck
npm test            # 11 suites, in-memory MongoDB, needs no external services
npm run build       # -> backend/dist (test files excluded)

# Frontend
cd ../frontend
npm ci
npm run build       # -> frontend/dist (code-split; charts load only on chart pages)
```

`npm ci --omit=dev` is enough on the server if you copy a prebuilt `dist/`. The in-memory MongoDB package is a dev dependency and is never used in production.

## 5. First deployment

1. Create the database and set `MONGODB_URI`.
2. Create the first Admin with a real password. The password is read from an environment variable so it stays out of shell history:

   ```bash
   cd backend
   NEW_USER_PASSWORD='choose-a-strong-password' npm run create-user:prod -- \
     --email owner@yourcompany.com --name "Owner" --role ADMIN
   ```

   Create the CA user the same way with `--role CA`. Running the command again for an existing email updates that user's name, role and password.
3. Start the server: `NODE_ENV=production node dist/server.js`. Use a process manager such as systemd, pm2 or Docker with a restart policy.
4. Sign in as Admin and open **Settings**. Enter the legal business name, address, GSTIN, invoice prefix and bank details. These details are copied onto each invoice when the invoice is created.
5. Check that `GET /api/health` returns `200` with `"database": "connected"`.
6. Run **Sync Shopify** from the header. Then review the HSN/SAC mappings: any product reported as `UNMAPPED` needs its HSN code set.

> **Do not run `npm run seed` in production.** The seed deletes all products, customers, invoices and payments, and it resets the demo users to public passwords (`admin123` / `ca123`). Both seed scripts refuse to run when `NODE_ENV=production`. They accept `--force-production` only for setting up a brand-new, empty database.

## 6. Reverse proxy example (nginx)

```nginx
server {
  listen 443 ssl http2;
  server_name invoices.navka.com;
  # ssl_certificate / ssl_certificate_key ...

  client_max_body_size 2m;           # API accepts JSON bodies up to 1 MB
  location / {
    proxy_pass http://127.0.0.1:5000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

With this setup, set `TRUST_PROXY=1`.

## 7. Operations

- **Health check:** `GET /api/health` returns `200` when the database is connected and `503` when it is not.
- **Logs:** Apache "combined" format request logs go to stdout. Server errors are logged with stack traces, but clients only ever receive `Internal Server Error`.
- **Backups:** back up MongoDB daily (Atlas continuous backup or `mongodump`). Invoices are legal GST records. Keep them for the retention period required by Section 36 of the CGST Act (72 months from the due date of the annual return for that year), and never delete them. Cancelling an invoice keeps the record.
- **Shopify sync:** sync is manual (Admin, header button) and idempotent. Running it again updates orders in place. Offline payments recorded against unpaid Shopify orders (e.g. cash on delivery) are kept when the order is synced again.
- **Upgrades:** pull the code, `npm ci`, `npm run build` in both folders, then restart. Mongoose creates new indexes at startup.

## 8. Audit results

### Security

| Area | Status |
|---|---|
| Authentication | bcrypt password hashes; JWT signed with a secret of at least 32 characters, enforced at startup |
| Brute force | Login is rate-limited per IP + email (429 after 10 failures in 15 minutes). The limit is in memory, so it applies per server instance; use a shared store such as Redis if you run more than one instance. |
| Authorization | Role checks happen on the server on every mutation. An automated sweep (`rbacTest.ts`) checks that every write route returns 403 for CA and 401 without a token. CA also sees a read-only UI. |
| Input validation | Zod schemas on every write endpoint. Totals sent by the browser are ignored and recalculated on the server. Query filters ignore invalid values instead of erroring. |
| Injection | Search terms are regex-escaped. CSV/Excel exports neutralise formula cells (`=`, `+`, `-`, `@`) so customer names from Shopify cannot run as spreadsheet formulas. |
| Transport and headers | Helmet (CSP, HSTS, no-sniff, frame protection); `x-powered-by` disabled; CORS restricted to `CORS_ORIGIN` in production; JSON body limit of 1 MB |
| Error handling | Mongoose cast, validation and duplicate errors map to 400/409. 5xx details are hidden in production. |
| Data safety | Production refuses an in-memory DB, refuses to run the seed scripts, and treats cancelled invoices as final (they cannot be reactivated) |
| Known limitation | The JWT is stored in `localStorage`, so an XSS bug would expose it. The CSP reduces this risk. Moving the token to an httpOnly cookie would also need CSRF protection; consider it if third-party scripts are ever added. |

### Indexing

| Collection | Indexes | Used by |
|---|---|---|
| invoices | `invoiceNumber` (unique), `shopifyOrderId`, `invoiceDate`, `paymentStatus`, `invoiceStatus`, `source`, `items.hsnSac`, `{invoiceDate, paymentStatus}`, `{invoiceStatus, invoiceDate}`, text index on customer name / number | Listing, filters, dashboard, sales report, Shopify upsert |
| payments | `invoiceId`, `paymentDate`, `paymentMethod`, `paymentSource`, `paymentStatus`, `{paymentDate, paymentSource}`, `{invoiceId, paymentStatus}` | Ledger filters, balance and reconciliation lookups |
| users | `email` (unique) | Login |
| products / customers | `name`, `hsnSac`, `shopifyProductId`, `email`, `phone`, `shopifyCustomerId` | HSN mapping, Shopify customer matching |

### Performance

- The dashboard's pending-balance calculation used one query per partial invoice. It now uses a single aggregation.
- The sales report uses one `$facet` aggregation for the summary, trend and register, plus one aggregation for the HSN summary. The CGST/SGST/IGST split is computed from grouped totals, not from individual invoices.
- The on-screen register shows the latest 2,000 invoices. The Excel/CSV exports include up to 50,000 rows. The PDF export shows the latest 2,000 rows and notes when rows are left out.
- Frontend pages are lazy-loaded and vendor code is split into its own chunks. The initial load is about 80 KB of app code plus 165 KB of React (gzip: 27 KB + 54 KB). Recharts (106 KB gzip) loads only on the Dashboard and Sales Report pages.
- Built assets are served with `Cache-Control: immutable, max-age=1y`. `index.html` is served with `no-cache`, so a deploy takes effect immediately.

## 9. Verification

The `backend` test suite (`npm test`) covers all phases. Each suite starts its own in-memory MongoDB:

| Suite | Covers |
|---|---|
| `modelsTest`, `authTest` | Schemas, seed integrity, login, JWT, RBAC basics |
| `dashboardTest` | KPIs, payment overview, date periods |
| `shopifyTest`, `shopifyLiveTest` | Order mapping, tax-inclusive prices, refunds, pagination, 429 retry, idempotency |
| `invoiceTest`, `invoiceCreateTest` | Listing, search, filters, sorting, detail, GST maths, numbering, PDF |
| `paymentTest` | Ledger, offline payments, reconciliation, Shopify re-sync safety, exports, settings |
| `reportTest` | Report totals against the database, intra-state vs inter-state split, filters, CSV/Excel/PDF |
| `rbacTest` | Every route: 401 without a token, CA reads allowed, CA writes blocked with 403 |
| `e2eTest` | Full journey: login, create invoice, CA views it, part-payment then full payment, dashboard and report update, exports |
