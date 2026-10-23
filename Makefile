# Common tasks for the room booking system. Run `make help` for a list.
# Requires Docker, Java 21 and Node 22 (only Docker for `make up`).

FRONTEND := frontend
BACKEND  := backend
COMPOSE  := docker compose
PROD     := docker compose -f compose.prod.yaml
E2E_BASE_URL ?= http://localhost:5173
APP_PORT ?= 8088
export APP_PORT

.PHONY: help dev demo test e2e up down reset-db bootstrap-admin prod-up prod-down prod-logs prod-update prod-bootstrap-admin

help: ## Show this list
	@grep -E '^[a-z0-9-]+:.*## ' $(MAKEFILE_LIST) | awk -F ':.*## ' '{printf "  make %-22s %s\n", $$1, $$2}'

$(FRONTEND)/node_modules: $(FRONTEND)/package-lock.json
	cd $(FRONTEND) && npm ci
	@touch $@

dev: $(FRONTEND)/node_modules ## PostgreSQL in Docker, Spring Boot and React (API mode) locally with hot reload
	$(COMPOSE) up -d --wait db
	@echo "Starting backend (:8080), frontend (http://localhost:5173) and the demo it links to (:5174/demo/)."
	@echo "Log in with your own account (first time: 'make bootstrap-admin' in another terminal). Ctrl+C stops all three."
	@# `exec` makes each job the real process, so the trap's kill reaches it.
	@trap 'trap - INT TERM EXIT; kill $$(jobs -p) 2>/dev/null; wait' INT TERM EXIT; \
	  (cd $(BACKEND) && exec ./mvnw -q spring-boot:run -Dspring-boot.run.profiles=dev) & \
	  (cd $(FRONTEND) && exec npm run dev:api -- --strictPort) & \
	  (cd $(FRONTEND) && VITE_LOGIN_URL=http://localhost:5173/ exec npx vite --mode demo --port 5174 --strictPort --base /demo/) & \
	  wait

demo: $(FRONTEND)/node_modules ## Standalone frontend demo with mock data, no backend
	cd $(FRONTEND) && npm run dev

test: $(FRONTEND)/node_modules ## Frontend and backend tests (backend needs Docker for Testcontainers)
	cd $(FRONTEND) && npm test
	cd $(BACKEND) && ./mvnw -q test

e2e: $(FRONTEND)/node_modules ## End-to-end workflow against the local app (make dev, or make up with E2E_BASE_URL=http://localhost:8088), as E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD; creates and archives its own test data through the admin API
	@test -n "$$E2E_ADMIN_EMAIL" -a -n "$$E2E_ADMIN_PASSWORD" || \
	  { echo "Set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD to a system administrator of the local database ('make bootstrap-admin' creates one)."; exit 1; }
	@curl -sf -o /dev/null $(E2E_BASE_URL)/api/auth/csrf || \
	  { echo "No API at $(E2E_BASE_URL). Start it with 'make dev' or 'make up' first."; exit 1; }
	cd $(FRONTEND) && E2E_BASE_URL=$(E2E_BASE_URL) npx vitest run apiWorkflow

up: ## Build and run the complete application in Docker on http://localhost:8088 (APP_PORT to change)
	$(COMPOSE) up -d --build --wait
	@echo "Running on http://localhost:$(APP_PORT). First time: create an administrator with 'make bootstrap-admin'. Stop with 'make down'."

bootstrap-admin: ## Create the first system administrator (prompts for email and password; refuses if one exists)
	$(COMPOSE) run --rm --build backend bootstrap-admin

down: ## Stop the containers (data is kept)
	$(COMPOSE) down

reset-db: ## Delete the development database (asks first)
	@printf "Delete all data in the development database? [y/N] "; read answer; \
	  case "$$answer" in \
	    [yY]*) $(COMPOSE) down -v && echo "Database deleted. It is recreated empty on the next 'make dev' or 'make up'; then run 'make bootstrap-admin'." ;; \
	    *) echo "Cancelled." ;; \
	  esac

# ── Production: compose.prod.yaml with settings in .env (see docs/DEPLOYMENT.md) ──

prod-up: ## Production: start in the background (builds the images the first time)
	$(PROD) up -d --wait

prod-down: ## Production: stop the containers (the database is kept)
	$(PROD) down

prod-logs: ## Production: follow the logs of all services
	$(PROD) logs -f --tail=100

prod-update: ## Production: rebuild the images from this checkout and restart (back up first)
	$(PROD) up -d --build --wait

prod-bootstrap-admin: ## Production: create the first system administrator (interactive)
	$(PROD) run --rm backend bootstrap-admin
