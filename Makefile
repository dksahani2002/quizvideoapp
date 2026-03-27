.PHONY: help dev build start video upload clean install

help:
	@echo "Available commands:"
	@echo "  make install    - Install dependencies"
	@echo "  make dev        - Run in development mode"
	@echo "  make build      - Build TypeScript"
	@echo "  make start      - Run production build"
	@echo "  make video      - Generate videos"
	@echo "  make upload     - Upload videos"
	@echo "  make clean      - Clean build artifacts"

install:
	npm install

dev:
	npm run dev

build:
	npm run build

start: build
	npm start

video:
	npm run video

upload:
	npm run upload

clean:
	npm run clean
