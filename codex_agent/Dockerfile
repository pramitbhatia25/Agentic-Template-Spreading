# Use the official Python image with a slim Debian base.
# https://hub.docker.com/_/python
FROM python:3.11-slim

# Install Node.js (for Codex CLI) and reduce image size.
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl ca-certificates gnupg && \
    curl -fsSL https://deb.nodesource.com/setup_24.x | bash - && \
    apt-get install -y --no-install-recommends nodejs && \
    npm install -g @openai/codex && \
    rm -rf /var/lib/apt/lists/*

# Install Python dependencies.
COPY requirements.txt requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copy local code to the container image.
ENV APP_HOME /Agentic_Template_Spreading
WORKDIR $APP_HOME
COPY . .

ENTRYPOINT ["python", "main.py"]
