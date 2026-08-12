.PHONY: help dev test test-e2e build lint migrate migrate-deploy logs port-forward helm-lint helm-template helm-dev

help:
	@echo "Available commands:"
	@echo "  make dev              - Start local environment with Docker Compose"
	@echo "  make build            - Build multi-stage production Docker image"
	@echo "  make test             - Run unit tests with Jest"
	@echo "  make test-e2e         - Run E2E integration tests"
	@echo "  make lint             - Run ESLint & Type check"
	@echo "  make migrate          - Run Prisma dev migrations"
	@echo "  make migrate-deploy   - Run Prisma production migrations"
	@echo "  make helm-lint        - Lint Helm chart templates"
	@echo "  make helm-template    - Render Helm templates for dev environment"
	@echo "  make helm-dev         - Install/Upgrade Helm chart in local hwala-dev namespace"
	@echo "  make logs             - Stream Kubernetes API logs"
	@echo "  make port-forward     - Port-forward API service to localhost:3000"

dev:
	docker-compose -f docker-compose.prod.yml up --build -d

build:
	docker build -t hwala-core:latest .

test:
	npm test

test-e2e:
	npm run test:e2e

lint:
	npm run lint && npx tsc --noEmit

migrate:
	npx prisma migrate dev

migrate-deploy:
	npx prisma migrate deploy

helm-lint:
	helm lint deploy/helm/hwala-core/

helm-template:
	helm template hwala-core deploy/helm/hwala-core/ --values deploy/helm/hwala-core/values.yaml

helm-dev:
	helm upgrade --install hwala-core deploy/helm/hwala-core/ --namespace hwala-dev --create-namespace --values deploy/helm/hwala-core/values.yaml

logs:
	kubectl logs -f -n hwala-dev deployment/hwala-core-api

port-forward:
	kubectl port-forward -n hwala-dev svc/hwala-core-api 3000:3000
