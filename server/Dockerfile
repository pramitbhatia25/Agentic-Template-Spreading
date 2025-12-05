# Use the official Python slim image for smaller size
FROM python:3.11-slim

# Create a non-root user
RUN useradd -m -u 1000 appuser

# Install Python dependencies
COPY requirements.txt requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Set the working directory and environment variable
ENV APP_HOME /ATS
WORKDIR $APP_HOME

# Copy local code to the container image
COPY . .

# Change ownership of the application files
RUN chown -R appuser:appuser $APP_HOME

# Switch to non-root user
USER appuser

# Expose the port the app runs on
EXPOSE 8080

# Set the entry point to run your Python script with Gunicorn
ENTRYPOINT ["gunicorn", "--bind", "0.0.0.0:8080", "app:app"]
