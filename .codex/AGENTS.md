# ForgeHustle Project Overview

ForgeHustle is a multi-service application consisting of a React frontend, an ElysiaJS backend, and a Go-based captcha service.

## Project Structure

- `fg-react-ts/`: Frontend application (React 19, TypeScript, Vite).
- `forgehustle-elysia-ts/`: Core backend service (ElysiaJS, Bun, Drizzle ORM).
- `GoCaptcha/`: Specialized captcha service (Go Fiber, Redis).

## Technologies & Architecture

### Frontend (`fg-react-ts`)
- **Framework:** React 19, TypeScript, Vite
- **Routing:** TanStack Router (Type-safe routing)
- **State Management:** Zustand
- **Authentication:** Better Auth (Client-side integration)
- **Styling:** Tailwind CSS 4, Radix UI (Primitives), Lucide Icons
- **Features:** Integrates `go-captcha-react` for security.
- **Port:** `3000`

### Backend (`forgehustle-elysia-ts`)
- **Runtime:** Bun
- **Framework:** ElysiaJS
- **Authentication:** Better Auth (Server-side implementation with OpenAPI support)
- **ORM:** Drizzle ORM
- **Database:** MySQL (TiDB Cloud)
- **Validation:** Valibot
- **Port:** `5000`

### Captcha Service (`GoCaptcha`)
- **Language:** Go
- **Framework:** Go Fiber
- **Storage:** Redis (Upstash)
- **Functionality:** Provides Rotate, Slide, Drag, and Click captcha types.
- **Port:** `7000`

## Getting Started

### Prerequisites
- [Bun](https://bun.sh/) installed.
- [Go](https://golang.org/) installed.
- Access to MySQL and Redis (credentials are in local `.env` files).

### Running the Services

#### 1. Backend (ElysiaJS)
```bash
cd forgehustle-elysia-ts
bun install
bun run dev
```
*Note: Ensure `APP_PORT=5000` is set in `.env`.*

#### 2. Captcha Service (Go)
```bash
cd GoCaptcha
go run main.go
```
*Note: Starts on port `7000`.*

#### 3. Frontend (React)
```bash
cd fg-react-ts
bun install
bun run dev
```
*Note: Starts on port `3000` and connects to both backends.*

## Development Conventions

- **Auth:** All protected routes in Elysia use the `auth` macro provided by the `BetterAuthRoute`.
- **API Communication:** Frontend uses `@better-fetch/fetch` and custom hooks for API calls.
- **Schema:** Database migrations are managed via Drizzle Kit. Run `bun run db-generate` and `bun run db-migrate` for changes.
- **Soft Deletion:** Use soft deletion by default for application/business entities.
  - Add a nullable `deletedAt` timestamp column (and `deletedBy` when auditability is required).
  - Exclude soft-deleted rows in normal reads/lists by default (`deletedAt IS NULL`).
  - Do not hard-delete in regular app flows unless explicitly required for maintenance or compliance.
## Workflow & Environment

- **Ecosystem:** Treat only `fg-react-ts` (React) and `forgehustle-elysia-ts` (ElysiaJS) as **Bun** ecosystem projects, using Bun package manager and runtime there. Do not apply Bun tooling to non-JS services like `GoCaptcha`.
- **Context & Skills:** Always use **Context7** (`resolve-library-id`, `query-docs`) when implementing new features or fixing code for specific libraries or frameworks. Use relevant **Agent Skills** (`activate_skill`) to follow the best patterns, guidelines, and practices established for the project's technologies (e.g., React, ElysiaJS, Better Auth).
- **Git Operations:** Do **NOT** stage, commit, push, or execute any other git commands autonomously. These actions must only be performed when explicitly requested by the user.
- **Process Management:** Do **NOT** execute development servers (`bun run dev`), test suites (`bun run test`), or production builds (`bun run build`) unless explicitly requested.
- **Server Status:** Development servers for all services are already running; do not attempt to start them manually.

## Key Configuration Files
- `forgehustle-elysia-ts/src/auth/better-auth.ts`: Better Auth server configuration.
- `fg-react-ts/src/api/auth/index.ts`: Better Auth client configuration.
- `forgehustle-elysia-ts/drizzle.config.ts`: Database and ORM settings.
- `GoCaptcha/config/captcha.go`: Captcha generation settings.
