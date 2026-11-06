.PHONY: dev infra backend worker beat frontend migrate seed test test-backend test-e2e mock-snippe up down
PY=backend/.venv/bin/python

infra:            ## Postgres + Redis only
	docker compose up -d postgres redis
migrate:
	cd backend && .venv/bin/python manage.py migrate
seed:
	cd backend && .venv/bin/python manage.py seed
backend:
	cd backend && .venv/bin/python manage.py runserver 0.0.0.0:8000
worker:
	cd backend && .venv/bin/celery -A config worker -l info --concurrency 2
beat:
	cd backend && .venv/bin/celery -A config beat -l info -s /tmp/celerybeat-schedule
frontend:
	cd frontend && pnpm dev
mock-snippe:      ## Local fake of the Snippe API (development and e2e only)
	cd backend && .venv/bin/python tools/mock_snippe.py
dev: infra migrate ## Everything, in one terminal
	$(MAKE) -j4 backend worker beat frontend
test: test-backend test-e2e
test-backend:      ## Needs Postgres and Redis
	cd backend && .venv/bin/pytest -q
test-e2e:
	cd frontend && pnpm exec playwright test
up:               ## Full production-like stack in Docker
	docker compose up -d --build
down:
	docker compose down
