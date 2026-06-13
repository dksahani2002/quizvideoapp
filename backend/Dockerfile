FROM node:20-bullseye

# Install system dependencies (ffmpeg, Python, pip)
RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    python3-pip \
    python3-venv \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install Node dependencies
RUN npm install

# Create Python venv and install packages
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
RUN pip install instagrapi yt-dlp

# Copy source and bundled assets (fonts/audio)
COPY src ./src
COPY assets ./assets
# Secrets and overrides are injected at runtime (docker-compose env_file / environment).
# .env is gitignored and excluded from build context; dotenv still loads this path at startup.
RUN printf '# See docker-compose environment and env_file\n' > .env

# Build TypeScript
RUN npm run build

# Create directories for outputs and cache
RUN mkdir -p output/videos temp cache/tts fonts

# Copy fonts if directory exists (skipped if not present)

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/health', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

CMD ["npm", "start"]
