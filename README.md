# DG Domain Core (`dg-domain-core`)

> **Architectural Status**: Phase 1 Prototype — Core Infrastructure & Naming Engine  
> **Target Namespace**: `.dg` (Private Overlay Prototype)
> **Copyright**: © 2026 Deep Group. All Rights Reserved.

---

## ⚠️ Important Prototype & ICANN Disclaimer

**PROTOTYPE NAMESPACE NOTICE:**  
The `.dg` domain naming system implemented in this repository is an **experimental private overlay architecture** built by Deep Group for technical prototyping, architectural validation, and infrastructure research.

* **Non-Delegated TLD**: `.dg` is **NOT** an ICANN-delegated public Top-Level Domain (TLD) and does not exist in the public Internet DNS root zone (`.` managed by IANA/ICANN).
* **Overlay Scope**: Resolution within this repository functions strictly at the application level and via dedicated DNS-over-HTTPS (DoH) / zone translation endpoints. Standard recursive resolvers (such as `8.8.8.8` or `1.1.1.1`) will **not** resolve `.dg` names across the public Internet.
* **No Public Representation**: Deep Group makes no claim of ownership over a recognized public Internet TLD. Any future public deployment is strictly contingent upon ICANN's New gTLD Program processes, technical delegation criteria, and international regulatory compliance.

---

## 1. Phase 1 Architecture Overview

`dg-domain-core` is the foundational infrastructure layer responsible for domain registration, strict namespace policy enforcement, resource record persistence, and application-level name resolution.

```
                  +----------------------------------------------+
                  |            Client / Applications             |
                  +----------------------------------------------+
                                  |              |
                      HTTP / DoH  |              |  Application Resolver
                     (RFC 8484)   |              |  (JSON REST API)
                                  v              v
                  +----------------------------------------------+
                  |         DG Domain Core API Router            |
                  |             (Express v4 / REST)              |
                  +----------------------------------------------+
                    |             |              |            |
                    |             |              |            |
     +--------------v---+  +------v-------+  +---v----+  +----v---------+
     |  Naming Policy   |  | Rate Limiter |  |  Auth  |  |  TTL Cache   |
     |  RFC 1035/1123   |  | Sliding Win  |  | SHA256 |  |  In-Memory   |
     +------------------+  +--------------+  +--------+  +--------------+
                    |             |              |
                    v             v              v
                  +----------------------------------------------+
                  |         Domain Registry Service              |
                  |    - Duplicate Prevention (ACID)             |
                  |    - Status Management (active/locked)       |
                  |    - Authorization Enforcement               |
                  +----------------------------------------------+
                                         |
                                         v
                  +----------------------------------------------+
                  |        Resolution Engine (Authoritative)     |
                  |    - Apex & Subdomain Zone Mapping           |
                  |    - CNAME Canonical Recursion Chasing       |
                  |    - RFC 8484 DoH Serialization              |
                  +----------------------------------------------+
                                         |
                                         v
                  +----------------------------------------------+
                  |        SQLite Lightweight Database           |
                  |     - domains (PK: name, token_hash)         |
                  |     - records (FK, UNIQUE constraint)        |
                  |     - audit_logs (Action logs)               |
                  +----------------------------------------------+
```

---

## 2. Core Modules

| Module | Location | Purpose |
| :--- | :--- | :--- |
| **Naming Conventions** | `src/core/naming.ts` | RFC 1035 label syntax, `.dg` boundary checks, reserved name protection, sanitization. |
| **Core Types** | `src/core/types.ts` | Type definitions for domain entities, resource records (`A`, `AAAA`, `CNAME`, `TXT`, `MX`, `NS`), and DoH contracts. |
| **Persistence Engine** | `src/db/database.ts` | SQLite driver (Node 22 `node:sqlite`) supporting file-backed storage (`data/dg_core.db`) or in-memory testing. |
| **Schema & Migrations** | `src/db/schema.ts` | DDL migrations with strict unique constraints, foreign keys, and indexes. |
| **Domain Registry** | `src/registry/registryService.ts` | Registration, availability checking, duplicate prevention, token verification, RDAP lookups. |
| **Resolution Engine** | `src/resolver/resolver.ts` | Authoritative name resolution, CNAME chasing recursion, in-memory TTL caching, RFC 8484 DoH responses. |
| **Security & Auth** | `src/security/auth.ts` | Unguessable token generation, SHA-256 HMAC hashing, timing-safe equality checks. |
| **Abuse Prevention** | `src/security/rateLimiter.ts` | In-memory sliding window rate limiter for registration and query protection. |
| **REST & DoH API** | `src/api/routes.ts` | RESTful endpoints for registration, queries, updates, and DNS-over-HTTPS. |

---

## 3. Naming Rules & Conventions

Inside the `.dg` prototype environment:
1. **Top-Level Domain**: Every domain must strictly terminate with `.dg` (e.g. `deepgroup.dg`, `ai.dg`, `mail.dg`).
2. **Character Set**: Second-level labels and subdomains may only contain lowercase alphanumeric characters `[a-z0-9]` and hyphens `-`.
3. **Hyphen Rules**: Hyphens cannot appear as the first or last character of any label. Consecutive hyphens at positions 3 and 4 are reserved for IDN/Punycode.
4. **Label Length**: Each label between 1 and 63 ASCII characters.
5. **Total FQDN Length**: Maximum 253 characters.
6. **Case Normalization**: All queries and registrations are canonicalized to lowercase ASCII.
7. **Protected Reserved Names**: The following names cannot be registered publicly:
   - `nic.dg`, `whois.dg`, `dns.dg`, `root.dg`, `registry.dg`, `localhost.dg`, `iana.dg`, `icann.dg`, `gov.dg`, `bank.dg`, `dg.dg`, `ns1.dg`, `ns2.dg`, `example.dg`, `test.dg`, `invalid.dg`.

---

## 4. Database Schema & Data Integrity

The storage layer utilizes a lightweight SQLite engine with full ACID compliance:

### `domains` Table
- `name` (`TEXT PRIMARY KEY`): Canonical FQDN (e.g., `deepgroup.dg`).
- `registrant_id` (`TEXT NOT NULL`): Identifier of the registrant entity.
- `auth_token_hash` (`TEXT NOT NULL`): SHA-256 HMAC hash of registrant auth token (raw token is returned only once at registration).
- `status` (`TEXT NOT NULL`): Domain state (`active`, `suspended`, `locked`).
- `registered_at` (`INTEGER NOT NULL`): Epoch timestamp in milliseconds.
- `updated_at` (`INTEGER NOT NULL`): Last update timestamp.
- `expires_at` (`INTEGER NOT NULL`): Domain expiration timestamp.

### `records` Table
- `id` (`INTEGER PRIMARY KEY AUTOINCREMENT`)
- `domain_name` (`TEXT NOT NULL`): Foreign key referencing `domains(name)` with cascade delete.
- `name` (`TEXT NOT NULL`): Subdomain label or `@` for zone apex.
- `type` (`TEXT NOT NULL`): Record type (`A`, `AAAA`, `CNAME`, `TXT`, `MX`, `NS`).
- `value` (`TEXT NOT NULL`): Target IP address, host string, or text content.
- `ttl` (`INTEGER NOT NULL DEFAULT 300`): Time to live in seconds.
- `priority` (`INTEGER`): Preference value for MX records.
- `created_at` (`INTEGER NOT NULL`)
- **Constraint**: `UNIQUE(domain_name, name, type, value)` guarantees no duplicate identical records can be inserted.

### `audit_logs` Table
- Tracks every registration, record update, and administrative status change with timestamp and client IP.

---

## 5. Backend API Reference

Base URL: `/api/v1`

### 1. Availability Check
```http
GET /api/v1/domains/check?name=ai.dg
```
**Response (200 OK):**
```json
{
  "name": "ai.dg",
  "available": true,
  "disclaimer": "PROTOTYPE NAMESPACE NOTICE: ..."
}
```

### 2. Register Domain
```http
POST /api/v1/domains/register
Content-Type: application/json

{
  "name": "ai.dg",
  "registrantId": "deep-group-ai-lab",
  "records": [
    { "name": "@", "type": "A", "value": "10.0.1.50", "ttl": 300 }
  ]
}
```
**Response (201 Created):**
```json
{
  "name": "ai.dg",
  "registrantId": "deep-group-ai-lab",
  "authToken": "dg_sec_d83n19fnv398nf932...",
  "status": "active",
  "registeredAt": "2026-10-11T04:30:00.000Z",
  "expiresAt": "2027-10-11T04:30:00.000Z",
  "records": [ ... ],
  "disclaimer": "PROTOTYPE NAMESPACE NOTICE: ..."
}
```
*Note: Duplicate registration attempts return `409 Conflict`.*

### 3. Domain Record Lookup (RDAP-aligned)
```http
GET /api/v1/domains/deepgroup.dg
```
**Response (200 OK):**
```json
{
  "name": "deepgroup.dg",
  "registrantId": "deep-group-core-registry",
  "status": "active",
  "registeredAt": "2026-10-11T04:00:00.000Z",
  "records": [
    { "name": "@", "type": "A", "value": "10.0.0.1", "ttl": 300 }
  ],
  "disclaimer": "PROTOTYPE NAMESPACE NOTICE: ..."
}
```

### 4. Authorized Record Update
```http
PUT /api/v1/domains/deepgroup.dg/records
Authorization: Bearer <dg_sec_auth_token>
Content-Type: application/json

{
  "records": [
    { "name": "@", "type": "A", "value": "10.0.0.5", "ttl": 600 },
    { "name": "mail", "type": "A", "value": "10.0.0.6", "ttl": 600 }
  ]
}
```
**Response (200 OK):**
```json
{
  "success": true,
  "records": [ ... ],
  "message": "Records updated successfully for deepgroup.dg."
}
```

### 5. Application-Level Resolution
```http
GET /api/v1/resolve?name=deepgroup.dg&type=A
```
**Response (200 OK):**
```json
{
  "question": { "name": "deepgroup.dg", "type": "A" },
  "status": "NOERROR",
  "statusCode": 0,
  "answers": [
    { "name": "deepgroup.dg", "type": "A", "data": "10.0.0.1", "TTL": 300 }
  ],
  "cached": false,
  "authoritative": true,
  "executionTimeMs": 1.42,
  "disclaimer": "PROTOTYPE NAMESPACE NOTICE: ..."
}
```

### 6. RFC 8484 DNS-over-HTTPS (DoH) Endpoint
```http
GET /api/v1/dns-query?name=deepgroup.dg&type=1
Accept: application/dns-json
```
**Response (200 OK):**
```json
{
  "Status": 0,
  "TC": false,
  "RD": true,
  "RA": true,
  "AD": false,
  "CD": false,
  "Question": [{ "name": "deepgroup.dg.", "type": 1 }],
  "Answer": [{ "name": "deepgroup.dg.", "type": 1, "TTL": 300, "data": "10.0.0.1" }],
  "Comment": "PROTOTYPE NAMESPACE NOTICE: ..."
}
```

### 7. External Web-Hosting Connection
Connects an apex domain or subdomain to an external web hosting provider (e.g., GitHub Pages, Vercel, Cloudflare, AWS CloudFront, or custom VPS). Validates real destinations, enforces RFC 1034 CNAME exclusivity on the target label while **preserving non-conflicting records** (e.g., MX for email, TXT for SPF/verification).

#### Endpoint
```http
POST /api/v1/domains/:name/hosting
```

#### Required Authorization Headers
- `Authorization: Bearer <dg_sec_auth_token>` or
- `X-Auth-Token: <dg_sec_auth_token>`

#### Example A: Connect Apex to GitHub Pages (IPv4 - A Record)
```http
POST /api/v1/domains/deepgroup.dg/hosting
Authorization: Bearer dg_sec_your_secret_token_here
Content-Type: application/json

{
  "subdomain": "@",
  "type": "A",
  "destination": "185.199.108.153",
  "provider": "github_pages",
  "ttl": 300
}
```
**Response (`200 OK`):**
```json
{
  "success": true,
  "domain": "deepgroup.dg",
  "subdomain": "@",
  "type": "A",
  "destination": "185.199.108.153",
  "provider": "github_pages",
  "isPublicRoutable": true,
  "isPrivateAddress": false,
  "activeRecords": [
    { "domainName": "deepgroup.dg", "name": "@", "type": "A", "value": "185.199.108.153", "ttl": 300, "priority": null },
    { "domainName": "deepgroup.dg", "name": "@", "type": "MX", "value": "mail.deepgroup.dg", "ttl": 300, "priority": 10 },
    { "domainName": "deepgroup.dg", "name": "@", "type": "TXT", "value": "v=spf1 include:_spf.deepgroup.dg ~all", "ttl": 300, "priority": null }
  ],
  "disclaimer": "PROTOTYPE NAMESPACE NOTICE: ..."
}
```

#### Example B: Connect Apex to Cloudflare (IPv6 - AAAA Record)
```http
POST /api/v1/domains/deepgroup.dg/hosting
Authorization: Bearer dg_sec_your_secret_token_here
Content-Type: application/json

{
  "subdomain": "@",
  "type": "AAAA",
  "destination": "2606:4700:3033::6815:1506",
  "provider": "cloudflare",
  "ttl": 300
}
```

#### Example C: Connect WWW Hostname to Vercel (CNAME Record)
```http
POST /api/v1/domains/deepgroup.dg/hosting
Authorization: Bearer dg_sec_your_secret_token_here
Content-Type: application/json

{
  "subdomain": "www",
  "type": "CNAME",
  "destination": "cname.vercel-dns.com",
  "provider": "vercel",
  "ttl": 300
}
```
**Response (`200 OK`):**
```json
{
  "success": true,
  "domain": "deepgroup.dg",
  "subdomain": "www",
  "type": "CNAME",
  "destination": "cname.vercel-dns.com",
  "provider": "vercel",
  "isPublicRoutable": true,
  "isPrivateAddress": false,
  "activeRecords": [ ... ],
  "disclaimer": "PROTOTYPE NAMESPACE NOTICE: ..."
}
```

### 8. Inspect External Hosting Configuration
Retrieves all configured hosting destinations and preserved records for a domain.
```http
GET /api/v1/domains/deepgroup.dg/hosting
```
**Response (`200 OK`):**
```json
{
  "domain": "deepgroup.dg",
  "status": "active",
  "hostingDestinations": [
    { "subdomain": "@", "type": "A", "destination": "185.199.108.153", "ttl": 300 },
    { "subdomain": "www", "type": "CNAME", "destination": "cname.vercel-dns.com", "ttl": 300 }
  ],
  "preservedRecords": [
    { "name": "@", "type": "MX", "value": "mail.deepgroup.dg" },
    { "name": "@", "type": "TXT", "value": "v=spf1 include:_spf.deepgroup.dg ~all" }
  ],
  "disclaimer": "PROTOTYPE NAMESPACE NOTICE: ..."
}
```

---

## 6. Testing

The repository includes a comprehensive automated test suite testing syntax rules, duplicate registration prevention, authorized updates, resolver recursion, rate limiting, and hosting connections.

### Running Tests Locally:

```bash
# Run complete test suite using Node 22 test runner
npm test

# Or directly via tsx
npx tsx --test tests/**/*.test.ts
```

### Test Suite Coverage:
1. `tests/naming.test.ts`: RFC label syntax, hyphen restrictions, TLD enforcement, reserved names.
2. `tests/registry.test.ts`: Availability, registration, duplicate checks, auth verification, administrative locks.
3. `tests/resolver.test.ts`: Apex A records, subdomain mapping, CNAME recursion, NXDOMAIN, REFUSED outside `.dg`, caching, and DoH RFC 8484 format.
4. `tests/api.test.ts`: Integration tests for all HTTP REST and DoH endpoints including hosting connection.
5. `tests/security.test.ts`: Cryptographic token entropy, SHA-256 HMAC hashing, timing-safe equality, and sliding window rate limiting.
6. `tests/hosting.test.ts`: External hosting A and AAAA (IPv6) configurations, CNAME external hostname targets, RFC 1034 CNAME exclusivity and conflict resolution, preservation of non-conflicting MX/TXT records, destination validation (0.0.0.0, broadcast, invalid IPs, invalid CNAMEs, self-loops), TTL bounds, domain-owner authorization enforcement, administrative status locks, and database persistence across close/reopen.

---

## 7. Phase 1 Capabilities vs. Scope Limitations

| Feature / Area | Phase 1 Capability | What is NOT in Phase 1 |
| :--- | :--- | :--- |
| **Namespace Scope** | Authoritative registration and resolution for `.dg` prototype overlay. | Public Internet root DNS delegation (ICANN root zone). |
| **Resolution Method**| HTTP REST resolver and RFC 8484 DoH JSON endpoint. | Native UDP/TCP Port 53 raw wire format DNS server (planned for Phase 2). |
| **Persistence** | Zero-dependency SQLite with ACID transactions & migrations. | Distributed multi-region distributed cluster. |
| **Authentication** | Unguessable bearer tokens (`dg_sec_*`) + SHA-256 HMAC. | External OAuth2 / OpenID Connect identity provider. |
| **Management UI** | Core Developer Workbench & live inspector harness. | End-user billing / multi-tenant domain customer dashboard. |

---

## 8. Roadmap for Future DNS & Production Integration

### Phase 2: DNS Server Protocol Adapter
- **BIND9 / Knot DNS Zone Exporter**: Automated generation of standard RFC 1035 master zone files (`.zone`) from the database.
- **CoreDNS Custom Plugin**: A native Go/C plugin for CoreDNS that queries the `dg-domain-core` SQLite/PostgreSQL database to serve UDP/TCP port 53 directly.
- **DNSSEC Prototype**: Implementation of RRSIG, DNSKEY, and DS record generation using Ed25519 (RFC 8080) for authenticated overlay resolution.

### Phase 3: Registry-Registrar Protocol (EPP)
- Implementation of RFC 5730 (Extensible Provisioning Protocol) for standardized registrar-registry communications.
- WHOIS (RFC 3912) and RDAP (RFC 7480-7484) standards compliance server.

### Phase 4: ICANN New gTLD Readiness
- Technical evaluation against ICANN Applicant Guidebook (AGB) requirements.
- Escrow data format (RFC 8984) export integration.
- Continuous High Availability and SLA compliance benchmarking.

---

## 9. Production Reverse Proxy Guide (Nginx & Caddy)

This guide documents how to expose the existing DG Domain Core Node.js backend to the public Internet using **Nginx** or **Caddy** as a reverse proxy with automated HTTPS.

---

### A. Prerequisites

Before setting up a public reverse proxy, ensure the following infrastructure is in place:

1. **Dedicated Server or Host**: A virtual private server (VPS, e.g., Ubuntu 22.04/24.04 LTS, Debian 12) or hardware computer that remains continuously connected online.
2. **Node.js Runtime**: Node.js **v22.x** or higher (required for native `node:sqlite` database support and ES module compatibility). Verify with `node -v`.
3. **Project Installed & Configured**: The `dg-domain-core` repository cloned and present on the server filesystem.
4. **Public Registered Domain**: A real, publicly registered domain or subdomain (e.g., `api.example.com`) registered through an accredited public registrar (such as Cloudflare, Namecheap, Google Domains/Squarespace, GoDaddy).
   > *Note: This must be a standard public domain name (e.g. `.com`, `.org`, `.io`, `.net`), NOT a `.dg` prototype name.*
5. **Public DNS A/AAAA Records**: An `A` (IPv4) or `AAAA` (IPv6) DNS record pointing your domain (e.g. `api.example.com`) to your server's public IP address.
6. **Open Firewall Ports**: Inbound network ports **80** (HTTP) and **443** (HTTPS) allowed in your firewall (`ufw allow 80/tcp`, `ufw allow 443/tcp`, or cloud provider security group).

---

### B. Running the Backend

#### 1. Install Dependencies
Navigate to the project root and install production dependencies:
```bash
npm install
```

#### 2. Verify Port and Bind Address in `server.ts`
Inspection of `server.ts` confirms:
- **Port**: Default is `3000`, configurable via the `PORT` environment variable:
  ```typescript
  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
  ```
- **Bind Address**: In `server.ts`, the default bind call is:
  ```typescript
  app.listen(PORT, '0.0.0.0', () => { ... });
  ```
- **Security Recommendation**: When running behind a local reverse proxy on the same server, bind the application strictly to local loopback (`127.0.0.1`) or firewall port 3000 from external access (`ufw deny 3000/tcp`). This prevents external clients from bypassing the reverse proxy's TLS termination and security headers.

#### 3. Build & Start the Server
For production:
```bash
# Compile static client assets
npm run build

# Start the Node.js production server
NODE_ENV=production PORT=3000 npm start
```

#### 4. Test Local Health Endpoint
Verify the backend responds locally on the server before connecting the proxy:
```bash
curl -i http://127.0.0.1:3000/api/v1/health
```
Expected output (`200 OK`):
```json
{
  "status": "ok",
  "service": "dg-domain-core",
  "namespace": ".dg",
  "statusNotice": "Phase 1 Prototype Overlay - Non-delegated TLD"
}
```

---

### C. Nginx Configuration

[Nginx](https://nginx.org/) is a high-performance web server and reverse proxy.

#### 1. Install Nginx and Certbot (Let's Encrypt)
On Debian/Ubuntu:
```bash
sudo apt update
sudo apt install -y nginx certbot python3-certbot-nginx
```

#### 2. Create Site Configuration File
Create `/etc/nginx/sites-available/dg-domain-core`:
*(Replace `api.example.com` with your real public domain).*

```nginx
# HTTP - Redirect all traffic to HTTPS
server {
    listen 80;
    listen [::]:80;
    server_name api.example.com;

    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}

# HTTPS - Terminate TLS and Proxy to Local Backend
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name api.example.com;

    # SSL Certificates (managed by Certbot)
    ssl_certificate /etc/letsencrypt/live/api.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.example.com/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    # Security Headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # Upstream Proxy to DG Domain Core (Port 3000)
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;

        # Preserve Client IP & Host Headers
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket & Persistent Connections
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        # Buffer & Timeout Settings
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
        proxy_buffering off;
    }
}
```

#### 3. Validate Configuration and Obtain Certificate
```bash
# Enable site in Nginx
sudo ln -s /etc/nginx/sites-available/dg-domain-core /etc/nginx/sites-enabled/

# Validate syntax
sudo nginx -t

# Obtain Let's Encrypt TLS certificate (requires valid DNS pointing to this server)
sudo certbot --nginx -d api.example.com

# Reload Nginx
sudo systemctl reload nginx
```

---

### D. Caddy Configuration

[Caddy](https://caddyserver.com/) automatically handles certificate issuance and periodic renewal with zero manual certificate management scripts.

#### 1. Install Caddy
```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install caddy
```

#### 2. Configure `/etc/caddy/Caddyfile`
Edit `/etc/caddy/Caddyfile` with your public domain placeholder:

```caddy
api.example.com {
    # Reverse proxy to DG Domain Core backend on port 3000
    reverse_proxy 127.0.0.1:3000 {
        header_up Host {host}
        header_up X-Real-IP {remote_host}
        header_up X-Forwarded-For {remote_host}
        header_up X-Forwarded-Proto {scheme}
    }

    # Security Response Headers
    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
        X-Content-Type-Options "nosniff"
        X-Frame-Options "DENY"
        Referrer-Policy "strict-origin-when-cross-origin"
    }

    # JSON Access Logs
    log {
        output file /var/log/caddy/dg_domain_core_access.log
        format json
    }
}
```

#### 3. Validate and Reload Caddy
```bash
# Validate Caddyfile formatting
caddy validate --config /etc/caddy/Caddyfile

# Reload Caddy service
sudo systemctl reload caddy
```
*When DNS records and ports 80/443 are reachable, Caddy automatically provisions and renews TLS certificates via Let's Encrypt or ZeroSSL.*

---

### E. Security, Process Management & Persistence

1. **Secret Management (`DG_ADMIN_SECRET`)**:
   - In production mode (`NODE_ENV=production`), DG Domain Core **strictly refuses** empty or default development keys.
   - Generate a strong, unguessable 256-bit secret:
     ```bash
     openssl rand -hex 32
     ```
   - Store it securely in a server-side environment file (e.g. `/etc/dg-domain-core.env` with `chmod 600` permissions). **Never** hardcode or commit secrets to Git.

2. **Database Persistence & Backups (`data/dg_core.db`)**:
   - All domain registrations, resource records, and audit logs are stored in `data/dg_core.db` via SQLite.
   - Ensure the `data/` directory is persistent and writeable by the service user.
   - Regular backups can be performed safely online using SQLite's backup command:
     ```bash
     sqlite3 data/dg_core.db ".backup data/dg_core_backup_$(date +%Y%m%d).db"
     ```

3. **Process Management (`systemd`) vs. Development Server**:
   - Do **NOT** use `npm run dev` or interactive shell sessions in production. The Vite development server is not hardened and stops if the terminal disconnects.
   - Use `systemd` to keep the backend running reliably across server restarts:

   Create `/etc/systemd/system/dg-core.service`:
   ```ini
   [Unit]
   Description=DG Domain Core Service
   After=network.target

   [Service]
   Type=simple
   User=www-data
   WorkingDirectory=/var/www/dg-domain-core
   EnvironmentFile=/etc/dg-domain-core.env
   Environment=NODE_ENV=production
   Environment=PORT=3000
   Environment=DG_DB_PATH=/var/www/dg-domain-core/data/dg_core.db
   ExecStart=/usr/bin/npm start
   Restart=always
   RestartSec=5

   # Process Isolation Hardening
   NoNewPrivileges=true
   PrivateTmp=true

   [Install]
   WantedBy=multi-user.target
   ```

   Enable and start the daemon:
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable dg-core
   sudo systemctl start dg-core
   ```

4. **Rate Limiting & Abuse Prevention**:
   - The application enforces in-memory sliding-window rate limiting on registration and query endpoints.
   - Reverse proxies forward real client IPs via `X-Forwarded-For` and `X-Real-IP` so rate limiting applies per unique client rather than treating all proxied requests as coming from localhost.

5. **Current Environment Status**:
   - The current AI Studio preview sandbox is a local development environment. It is **not** a public Internet server and does not expose a public HTTPS port directly. Setting up Nginx or Caddy is required on your self-hosted server.

---

### F. Verification & Health Checks

Once Nginx or Caddy is running and the domain DNS has propagated, verify public HTTPS connectivity from an external machine:

#### 1. Verify HTTPS Health Endpoint
```bash
curl -i https://api.example.com/api/v1/health
```
Expected response: HTTP `200 OK` with JSON health status.

#### 2. Query Prototype Domain Resolution via Public API
```bash
curl -i "https://api.example.com/api/v1/resolve?name=deepgroup.dg&type=A"
```
Expected response:
```json
{
  "name": "deepgroup.dg",
  "type": "A",
  "status": "NOERROR",
  "answers": [
    { "name": "deepgroup.dg", "type": "A", "data": "10.0.0.1", "ttl": 300 }
  ],
  "authoritative": true,
  "disclaimer": "PROTOTYPE NAMESPACE NOTICE: ..."
}
```

#### 3. DNS Scope Distinction (Important)
- **What this verifies**: This verifies that your public domain (`api.example.com`) successfully routes HTTPS traffic to your DG Domain Core API and returns query results over HTTP/DoH.
- **What this does NOT do**: This does **not** make `.dg` an official public Internet Top-Level Domain. Public internet resolvers (like Google DNS `8.8.8.8` or Cloudflare `1.1.1.1`) will **not** resolve `http://deepgroup.dg/` in a web browser without an overlay proxy or client DoH configuration.

---

### G. Free vs. Paid Infrastructure Options

- **Free Open Source Software**: Both **Nginx** and **Caddy** are free, open-source software (FOSS) licensed under BSD and Apache 2.0. Automated SSL certificates from **Let's Encrypt** and **ZeroSSL** are 100% free of charge.
- **Infrastructure Costs**:
  - A server (VPS or cloud instance) may have hosting costs, though free-tier VPS instances (e.g., Oracle Cloud Always Free tier) are available.
  - A public domain name (e.g., `example.com`) generally incurs an annual registration fee from a public domain registrar (typically $8–$15/year for `.com`), though some free dynamic DNS providers (e.g., DuckDNS, No-IP) can provide free subdomains for testing.
  - Setting up the reverse proxy itself does not require paid software licenses.
