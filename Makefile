.PHONY: help install dev ui build start test clean video

help:
	@echo "MCQ Shorts monorepo — run from repo root after: make install"
	@echo ""
	@echo "  make dev     API server (backend)"
	@echo "  make ui      React UI with hot reload (Vite, port 5173)"
	@echo "  make build   Production build (backend + frontend)"
	@echo "  make start   Run compiled API (node dist)"
	@echo "  make test    Smoke test (health, auth, TTS preview)"
	@echo "  make clean   Remove backend dist/"
	@echo "  make video   MCQ video CLI (needs OPENAI_API_KEY in env)"

install:
	npm install

dev:
	npm run dev

ui:
	npm run ui

build:
	npm run build

start:
	npm run start

test:
	npm run test

clean:
	npm run clean

video:
	npm run video
