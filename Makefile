.PHONY: up down logs ps install dev typecheck test

up:        ## Start all services
	docker compose up --build
down:      ## Stop all services
	docker compose down
logs:      ## Tail logs
	docker compose logs -f
ps:        ## List services
	docker compose ps
install:   ## Install JS deps (workspaces) + Python deps
	npm install
	cd ai-service && python3 -m pip install -r requirements.txt
dev:       ## Run server + client locally (needs postgres/redis running)
	npm run dev --workspace=server &
	npm run dev --workspace=client
typecheck: ## Typecheck TS workspaces
	npm run typecheck --workspaces
test:      ## Run ai-service tests
	cd ai-service && python3 -m pytest tests -q
