# Contractor safety portal

One codebase, deployed separately for each client: their own GitHub repo, Railway project, database and web address.
Node.js / Express / PostgreSQL on Railway. Starts empty.

What it does:

- Operatives register, with a training matrix (cards, tickets, expiry dates, copies of certificates) and expiry warnings.
- Toolbox talks: write once, send the link on WhatsApp; operatives read, answer the questions and sign. Register of who has and hasn't signed.
- Jobs with RAMS, drawings and permits: one pack link per job; operatives read and sign each RAMS on their phone. New revisions are re-signed.
- Signatures from anyone not on the register are kept and matched later.
- Branding (name, colour, logo) and the training list are set in Settings, so no code changes per client.

## Deploy for a new client

1. New GitHub repo (e.g. `solix-safety-portal`), upload everything in this folder.
2. Railway: New Project > Deploy from GitHub repo > pick the repo. Then New > Database > PostgreSQL.
3. Variables on the portal service:
   - `DATABASE_URL` = `${{Postgres.DATABASE_URL}}`
   - `SETUP_KEY` = any long phrase (used once to create the first admin)
   - `NODE_ENV` = `production`
   - `PRESET` = `glazing`, `plumbing` or `general` (the starting training list; only read on first boot)
   - `COMPANY_NAME` = the client's name (optional, can be set in Settings instead)
   - `PUBLIC_URL` = the final address if using a custom domain (optional; used in links and QR codes)
4. Settings > Networking > Generate Domain.
5. Open `/admin`, enter the setup key, create the first admin. Then Settings: logo and brand colour.

The database schema is created and updated automatically on every start.
