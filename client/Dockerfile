# Use a lightweight Node runtime base
FROM node:22-slim

# Accept values from Cloud Build substitutions as build args
ARG VITE_APP_API_URL
ARG VITE_APP_GOOGLE_CLIENT_ID

# Set environment variables so build and runtime can see them
ENV VITE_APP_API_URL=${VITE_APP_API_URL}
ENV VITE_APP_GOOGLE_CLIENT_ID=${VITE_APP_GOOGLE_CLIENT_ID}

# Set working directory
WORKDIR /app

# Copy project files
COPY . .

# Install dependencies
RUN npm install

# Run Vite build, making sure environment variables are injected at build time
RUN VITE_APP_API_URL=$VITE_APP_API_URL \
    VITE_APP_GOOGLE_CLIENT_ID=$VITE_APP_GOOGLE_CLIENT_ID \
    npm run build

# Install a simple static file server
RUN npm install -g serve

# Expose the port Serve will run on
EXPOSE 8080

# Command to run the static server
CMD ["serve", "-s", "dist", "-l", "8080"]
