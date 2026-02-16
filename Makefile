.PHONY: help install dev build start clean test test-unit test-integration test-e2e test-watch test-coverage \
        db-up db-down db-migrate db-migrate-deploy db-generate db-studio db-reset \
        docker-up docker-down docker-build docker-logs docker-restart docker-up-detached \
        ingest ingest-unknown generate-unknown lint typecheck verify

# ─── Help ────────────────────────────────────────────────────────────
help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

# ─── Setup ───────────────────────────────────────────────────────────
install: ## Install all dependencies
	npm ci

# ─── Development ─────────────────────────────────────────────────────
dev: ## Start dev server with hot reload
	npx tsx watch src/index.ts

build: ## Compile TypeScript to dist/
	npx tsc
	rm -rf dist/public && cp -r src/public dist/public

start: ## Run compiled JS from dist/
	node dist/index.js

clean: ## Remove build artifacts
	rm -rf dist node_modules/.cache

# ─── Database (local dev) ───────────────────────────────────────────
db-up: ## Start PostgreSQL container only
	docker compose up -d db

db-down: ## Stop PostgreSQL container
	docker compose down

db-generate: ## Generate Prisma client
	npx prisma generate

db-migrate: ## Create and apply a new migration (dev)
	npx prisma migrate dev

db-migrate-deploy: ## Apply pending migrations (production)
	npx prisma migrate deploy

db-studio: ## Open Prisma Studio GUI
	npx prisma studio

db-reset: ## Reset database (drop + re-migrate)
	npx prisma migrate reset --force

# ─── Testing ─────────────────────────────────────────────────────────
test: ## Run all tests
	npx vitest run

test-unit: ## Run unit tests only
	npx vitest run tests/unit

test-integration: ## Run integration tests only
	npx vitest run tests/integration

test-e2e: ## Run end-to-end tests only
	npx vitest run tests/e2e

test-watch: ## Run tests in watch mode
	npx vitest

test-coverage: ## Run tests with coverage report
	npx vitest run --coverage

# ─── Code Quality ────────────────────────────────────────────────────
typecheck: ## Run TypeScript type checking (no emit)
	npx tsc --noEmit

lint: ## Run ESLint + typecheck
	npx eslint src/ tests/
	npx tsc --noEmit

# ─── Docker (full stack) ────────────────────────────────────────────
docker-up: ## Start all services (app + db)
	docker compose up --build

docker-up-detached: ## Start all services in background
	docker compose up --build -d

docker-down: ## Stop all services
	docker compose down

docker-build: ## Build Docker image without starting
	docker compose build

docker-logs: ## Tail logs from all services
	docker compose logs -f

docker-restart: ## Restart all services
	docker compose down && docker compose up --build -d

# ─── Dataset ─────────────────────────────────────────────────────────
ingest: ## Ingest all 15 dataset messages into running service
	npx tsx scripts/ingest-dataset.ts

generate-unknown: ## Generate local unknown input messages (gitignored)
	npx tsx scripts/generate-unknown-inputs.ts

ingest-unknown: ## Ingest locally generated unknown input messages
	npx tsx scripts/ingest-unknown-inputs.ts

# ─── Verification ────────────────────────────────────────────────────
verify: ## Full verification: typecheck + test + build
	@echo "==> Type checking..."
	npx tsc --noEmit
	@echo "==> Running tests..."
	npx vitest run
	@echo "==> Building..."
	npx tsc
	rm -rf dist/public && cp -r src/public dist/public
	@echo "==> All checks passed!"
