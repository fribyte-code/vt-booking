# Common tasks for the room booking system. Run `make help` for a list.
# Requires Docker, Java 21 and Node 22 (only Docker for `make up`).

FRONTEND := frontend
BACKEND  := backend
COMPOSE  := docker compose
E2E_BASE_URL ?= http://localhost:5173
APP_PORT ?= 8088
export APP_PORT

.PHONY: help dev demo test e2e up down reset-db

help: ## Show this list
	@grep -E '^[a-z0-9-]+:.*## ' $(MAKEFILE_LIST) | awk -F ':.*## ' '{printf "  make %-10s %s\n", $$1, $$2}'

$(FRONTEND)/node_modules: $(FRONTEND)/package-lock.json
	cd $(FRONTEND) && npm ci
	@touch $@

dev: $(FRONTEND)/node_modules ## PostgreSQL in Docker, Spring Boot and React (API mode) locally with hot reload
	$(COMPOSE) up -d --wait db
	@echo "Starting backend (:8080), frontend (http://localhost:5173) and the demo it links to (:5174/demo/)."
	@echo "Log in as kari@example.no / dev. Ctrl+C stops all three."
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

e2e: $(FRONTEND)/node_modules ## End-to-end workflow against a running app (make dev, or make up with E2E_BASE_URL=http://localhost:8088)
	@curl -sf -o /dev/null $(E2E_BASE_URL)/api/auth/csrf || \
	  { echo "No API at $(E2E_BASE_URL). Start it with 'make dev' or 'make up' first."; exit 1; }
	cd $(FRONTEND) && E2E_BASE_URL=$(E2E_BASE_URL) npx vitest run apiWorkflow

up: ## Build and run the complete application in Docker on http://localhost:8088 (APP_PORT to change)
	$(COMPOSE) up -d --build --wait
	@echo "Running on http://localhost:$(APP_PORT). Log in as kari@example.no / dev. Stop with 'make down'."

down: ## Stop the containers (data is kept)
	$(COMPOSE) down

reset-db: ## Delete the development database (asks first)
	@printf "Delete all data in the development database? [y/N] "; read answer; \
	  case "$$answer" in \
	    [yY]*) $(COMPOSE) down -v && echo "Database deleted. It is recreated and seeded on the next 'make dev' or 'make up'." ;; \
	    *) echo "Cancelled." ;; \
	  esac
