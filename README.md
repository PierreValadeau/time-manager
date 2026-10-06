# Time Manager

Time tracking application for Trinity Market: employees clock in and out, managers handle their teams and follow KPIs.

**Stack:** React + Vite, Express + Prisma, PostgreSQL, TypeScript, Docker Compose.

## Getting started

```bash
cp backend/.env.example backend/.env
docker compose up --build
```

- Frontend: http://localhost:5173
- API: http://localhost:3000/api/v1/health

After pulling changes to dependencies or to the Prisma schema, run `docker compose up --build -V`.

## Contributing

- Branch: Jira key, from `develop` (`KAN-123`)
- Commits: `feat: ...`, `fix: ...`, `chore: ...`
- Pull request to `develop`: `type: description #KAN-123`
