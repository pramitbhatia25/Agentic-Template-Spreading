# Agent Management & Deployment Platform - API Design Document

## Overview

This document describes the API design for a platform that enables users to:
- Automatically detect and deploy new agents from the Agentic-Template-Spreading Repository
- Build and deploy agents to Google Cloud Run Jobs via GitHub Actions
- Configure agent-specific environment variables via `.env.example` files
- Discover and make agents available as selectable options in the UI
- Fine-tune agent parameters at request time

### Key Requirements
- Repository structure: Each agent is a folder with required files
- Required files per agent folder: `main.py`, `cloudbuild.yaml`, `Dockerfile`, `requirements.txt`, `.env.example`
- GitHub Actions workflow detects new/modified agent folders on commit
- Automatic build and deployment to Cloud Run Jobs via Cloud Build
- Server auto-discovers deployed agents from Cloud Run
- Frontend allows parameter fine-tuning before job execution

---

## System Architecture

### Components

```
┌─────────────────────────────────────────────────────────┐
│              GitHub Repository                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────┐  │
│  │  client  │  │  server  │  │  agent   │  │ agent_N │  │
│  └──────────┘  └──────────┘  └──────────┘  └─────────┘  │
└────────┬────────────────────────────────────────────────┘
         │
         │ Push/Commit
         │
┌────────▼─────────────────────────────────────────────────┐
│         GitHub Actions Workflow                          │
│  ┌──────────────────────────────────────────────────┐    │
│  │  1. Detect new/modified agent folders            │    │
│  │  2. Validate required files exist                │    │
│  │  3. Trigger Cloud Build for each agent           │    │
│  │  4. Build Docker image → Artifact Registry       │    │
│  │  5. Create/Update Cloud Run Job                  │    │
│  │  6. Update Firestore with agent metadata         │    │
│  └──────────────────────────────────────────────────┘    │
└────────┬─────────────────────────────────────────────────┘
         │
         ├─────────────────┬─────────────────┐
         │                 │                 │
    ┌────▼────┐      ┌─────▼─────┐    ┌─────▼─────┐
    │Firestore│      │Cloud Build│    │Cloud Run  │
    │Database │      │  Service  │    │   Jobs    │
    └────┬────┘      └───────────┘    └─────┬─────┘
         │                                    │
         │                                    │
┌────────▼────────────────────────────────────▼──────────┐
│         Flask API Server                               │
│  ┌──────────────────────────────────────────────┐      │
│  │  Agent Discovery APIs                        │      │
│  │  - Discover Agents (from Firestore)          │      │
│  │  - Get Agent Config (from Firestore)         │      │
│  │  - List Available Agents                     │      │
│  └──────────────────────────────────────────────┘      │
│  ┌──────────────────────────────────────────────┐      │
│  │  Extraction Request APIs                     │      │
│  │  - Create Request (with agent + params)      │      │
│  │  - Trigger Agent Job (with env overrides)    │      │
│  └──────────────────────────────────────────────┘      │
└────────┬───────────────────────────────────────────────┘
         │
         │ HTTP/REST
         │
┌────────▼────────────┐
│   Client UI         │
│  (React App)        │
│  - Agent Selection  │
│  - Param Tuning     │
└─────────────────────┘
```

## Repository Structure

### ATS Repository Layout

```
agentic-template-spreading /
├── client/              # Frontend application
├── server/              # Backend API server
├── agent/               # Default agent (existing)
├── codex_agent/         # Codex agent (existing)
├── my_custom_agent/     # New agent folder
│   ├── app.py           # Agent entry point (required)
│   ├── cloudbuild.yaml  # Cloud Build configuration (required)
│   ├── Dockerfile       # Container definition (required)
│   ├── requirements.txt # Python dependencies (required)
│   └── .env.example     # Environment variable template (required)
└── another_agent/       # Another agent folder
    ├── app.py
    ├── cloudbuild.yaml
    ├── Dockerfile
    ├── requirements.txt
    └── .env.example
```

### Required Files Per Agent Folder

1. **`app.py`**: Main entry point for the agent
   - Must be executable as a Python script
   - Should accept environment variables for configuration
   - Expected to process `REQUEST_ID` from environment

2. **`cloudbuild.yaml`**: Cloud Build configuration
   - Defines build steps (docker build, push)
   - Should use substitution variables for flexibility
   - Must push to Artifact Registry

3. **`Dockerfile`**: Container image definition
   - Installs dependencies from `requirements.txt`
   - Copies agent code
   - Sets entrypoint to run `app.py`

4. **`requirements.txt`**: Python package dependencies
   - Standard pip requirements format
   - Installed during Docker build

5. **`.env.example`**: Environment variable template
   - Defines all configurable parameters for the agent
   - Format: `KEY=value` or `KEY=# description`
   - Used to generate UI form for parameter tuning
   - Example:
     ```
     MAX_RETRIES=3
     TIMEOUT_SECONDS=3600
     MODEL_NAME=gpt-4
     TEMPERATURE=0.7
     CUSTOM_PROMPT=# Optional custom prompt for the agent
     ```

---

## Agent Metadata (Firestore Collection: `agents`)

```json
{
  "agent_id": "string (folder name, e.g., 'my_custom_agent')",
  "name": "string (folder name, used as unique identifier)",
  "display_name": "string (derived from folder name or metadata)",
  "description": "string (optional, from README or metadata)",
  "version": "string (git commit SHA or tag)",
  
  "folder_path": "string (relative path in repo, e.g., 'my_custom_agent')",
  "repository": {
    "url": "string (GitHub repo URL)",
    "branch": "string (default: 'main')",
    "commit_sha": "string (commit that triggered deployment)"
  },
  
  "build_config": {
    "cloudbuild_file_path": "string (e.g., 'my_custom_agent/cloudbuild.yaml')",
    "dockerfile_path": "string (e.g., 'my_custom_agent/Dockerfile')",
    "image_name": "string (Artifact Registry image name, e.g., 'my-custom-agent')",
    "image_tag": "string (default: 'latest')",
    "image_uri": "string (full URI after build)"
  },
  
  "cloud_run_config": {
    "job_id": "string (Cloud Run Job ID, e.g., 'my-custom-agent-job')",
    "job_name": "string (full resource name)",
    "location": "string (GCP region, e.g., 'us-central1')",
    "service_account": "string (service account email)",
    "cpu": "string (e.g., '2')",
    "memory": "string (e.g., '4Gi')",
    "timeout": "string (e.g., '3600s')",
    "max_retries": "integer (default: 3)"
  },
  
  "environment_variables": [
    {
      "name": "string (from .env.example)",
      "default_value": "string (from .env.example)",
      "description": "string (from .env.example comment)",
      "required": "boolean (inferred from .env.example)",
      "type": "string (enum: 'string', 'number', 'boolean')"
    }
  ],
  
  "status": "string (enum: 'pending', 'building', 'deployed', 'failed', 'disabled')",

  "last_build_id": "string (Cloud Build build ID)",
  "last_deployment_time": "timestamp",
  "last_error": "string (error message if failed)",
  
  "metadata": {
    "detected_at": "timestamp (when GitHub Actions detected the folder)",
    "deployed_by": "string (GitHub Actions workflow)",
    "updated_at": "timestamp"
  }
}
```

### Agent Deployment Status (Firestore Collection: `agent_deployments`)

```json
{
  "deployment_id": "string (auto-generated)",
  "agent_id": "string (reference to agents collection)",
  "build_id": "string (Cloud Build build ID)",
  "status": "string (enum: 'queued', 'building', 'pushing', 'deploying', 'success', 'failed')",
  "image_uri": "string (full image URI)",
  "cloud_run_job_name": "string (full job resource name)",
  "started_at": "timestamp",
  "completed_at": "timestamp",
  "error_message": "string (if failed)",
  "logs_url": "string (Cloud Build logs URL)"
}
```

### Extraction Request (existing collection: `extraction_requests`)

Add fields:
```json
{
  // ... existing fields ...
  "agent_id": "string (agent folder name, e.g., 'my_custom_agent')",
  "agent_config": {
    "agent_id": "string",
    "agent_name": "string",
    "custom_env_vars": {
      "KEY": "value (user-tuned parameters from frontend)"
    }
  }
}
```

## API Endpoints

#### 1. Discover Available Agents
```
GET /api/agents/list
```

**Description**: Discovers agents by querying Firestore. This endpoint is called on page-load to refresh the list of available agents.

```json
{
  "agents": [
    {
      "agent_id": "my_custom_agent",
      "name": "my_custom_agent",
      "display_name": "My Custom Agent",
      "description": "Custom processing agent",
      "status": "deployed",
      "cloud_run_job_id": "my-custom-agent-job",
      "location": "us-central1",
      "last_deployment_time": "2024-01-15T10:30:00Z",
      "environment_variables": [
        {
          "name": "MAX_RETRIES",
          "default_value": "3",
          "description": "Maximum number of retry attempts",
          "required": false,
          "type": "number"
        },
        {
          "name": "TIMEOUT_SECONDS",
          "default_value": "3600",
          "description": "Timeout in seconds",
          "required": false,
          "type": "number"
        },
        {
          "name": "MODEL_NAME",
          "default_value": "gpt-4",
          "description": "AI model to use",
          "required": true,
          "type": "string"
        },
        {
          "name": "TEMPERATURE",
          "default_value": "0.7",
          "description": "Model temperature parameter",
          "required": false,
          "type": "number"
        },
        {
          "name": "CUSTOM_PROMPT",
          "default_value": "",
          "description": "Optional custom prompt for the agent",
          "required": false,
          "type": "string"
        }
      ]
    }
  ],
  "total": 5,
  "discovered_at": "2024-01-15T10:35:00Z"
}
```

#### 2. Create Extraction Request (Updated)
```
POST /api/extract
```

**Updated Request Body** (multipart/form-data):
- All existing fields (template file, PDF files)
- New field: `agent_id` (string, optional - if not provided, uses default)
- New field: `agent_params` (JSON string, optional - user-tuned parameters)

**Example**:
```
agent_id: "my_custom_agent"
agent_params: {"MAX_RETRIES": "5", "TEMPERATURE": "0.9", "CUSTOM_PROMPT": "Extract all data"}
```

```json
{
  "requestId": "req123",
  "message": "Request created successfully",
  "status": "pending",
  "agent_id": "my_custom_agent",
  "agent_name": "My Custom Agent",
  "agent_params": {
    "MAX_RETRIES": "5",
    "TEMPERATURE": "0.9",
    "CUSTOM_PROMPT": "Extract all data"
  }
}
```

## Agent Registration Workflow

### Step-by-Step Process

1. **User Creates Agent Folder**
   - Creates new folder in repository (e.g., `my_custom_agent/`)
   - Adds required files:
     - `main.py` (agent entry point)
     - `cloudbuild.yaml` (build configuration)
     - `Dockerfile` (container definition)
     - `requirements.txt` (Python dependencies)
     - `.env.example` (environment variable template)
   - Commits and pushes to GitHub repository

2. **GitHub Actions Detection**
   - GitHub Actions workflow triggers on push/commit
   - Fetches Agents from Firestore
   - Detects New Folders (New Agent Structures)
   - Validates each folder has all required files
   - For each valid agent folder:
     - Extracts agent metadata (folder name, files)
     - Parses `.env.example` for environment variables
     - Creates/updates Firestore document with status `pending`

3. **Automatic Build Trigger**
   - GitHub Actions triggers Cloud Build for each agent:
     - Creates a new cloud build trigger using `cloudbuild.yaml` from agent folder
     - Submits build request to Cloud Build API
   - Cloud Build:
     - Builds Docker image from agent folder
     - Pushes image to Artifact Registry
     - Returns build ID and image URI

4. **Automatic Cloud Run Job Creation/Update**
   - After successful build, GitHub Actions creates/updates Cloud Run Job:
     - Uses image URI from Artifact Registry
     - Configures resources (CPU, memory, timeout) from defaults or config
     - Sets base environment variables (from `.env.example` defaults)
     - Configures service account
     - Job ID format: `{agent-folder-name}-job` (sanitized)
   - Updates Firestore document:
     - Sets status to `deployed`
     - Stores Cloud Run Job name and image URI
     - Records deployment timestamp

5. **Agent Available for Use**
   - Agent appears in frontend agent selection dropdown
   - User can select agent and fine-tune parameters (from `.env.example`)
   - User creates extraction request with agent selection and parameters

### Frontend Parameter Tuning

The frontend generates a form based on agent configuration:

1. User selects agent from dropdown
2. Frontend calls `GET /api/agents/list`
3. Frontend generates form fields from `environment_variables` array:
   - Text input for string types
   - Number input for number types
   - Checkbox for boolean types
   - Shows default values, descriptions, required indicators
4. User adjusts parameters
5. Parameters sent as `agent_params` JSON in extraction request
6. Server applies as environment variable overrides when triggering job

---

**Document Version**: 1.0  
**Last Updated**: 12-19-2025  
**Author**: Pramit Bhatia

