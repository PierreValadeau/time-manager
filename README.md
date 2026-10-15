# Time Manager

Time tracking application for Trinity Market: employees clock in and out, managers handle their teams and follow KPIs.

**Stack:** React + Vite, Express + Prisma, PostgreSQL, TypeScript, Vitest, Docker Compose.

## Getting started

```bash
cp backend/.env.example backend/.env
docker compose up --build
```

In `backend/.env`, set `JWT_SECRET` to a random string of at least 32 characters (the API refuses to sign tokens without it):

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

- Frontend: http://localhost:5173
- API: http://localhost:3000/api/v1/health

After pulling changes to dependencies or to the Prisma schema, run `docker compose up --build -V`.

## Tests

```bash
cd backend && npm test    # or: cd frontend && npm test
```

Outside Docker, run `npm ci` then `npx prisma generate` in `backend/` first.

`npm test` runs the backend tests that mock Prisma. The tests in `backend/tests/db` use a real PostgreSQL database, which they empty before each test, so they only accept a database whose name ends with `_test`:

```bash
docker compose exec db createdb -U tm timemanager_test   # once
cd backend
export DATABASE_URL=postgresql://tm:tm@localhost:5433/timemanager_test
npx prisma migrate deploy
npm run test:db        # DB tests only
npm run test:coverage  # all tests + coverage report in backend/coverage
```

The CI runs `npm run test:coverage` against a PostgreSQL service and fails below the thresholds set in `backend/vitest.config.mts`. The HTML report is uploaded as the `backend-coverage` artifact.

## Contributing

- Branch: Jira key, from `develop` (`KAN-123`)
- Commits: `feat: ...`, `fix: ...`, `chore: ...`
- Pull request to `develop`: `type: description #KAN-123`
