# Yomi Proxy

Yomi Proxy is a simple, single-admin proxy designed for sharing AI API keys. It supports key pooling, rotation, and management for various AI providers, with a user-friendly admin dashboard to monitor and control access.

## Features

- **API Key Pooling & Rotation**: Manage multiple API keys for each provider. The proxy automatically rotates keys to distribute usage.
- **Multi-Provider Support**: Built-in support for major providers like Gemini, OpenAI, DeepSeek, OpenRouter, Mistral, and Claude.
- **Custom Provider Integration**: Easily add and manage custom OpenAI-compatible providers.
- **Local Database Fallback**: If a PostgreSQL `DATABASE_URL` is not provided, the application automatically falls back to a local SQLite database, creating the necessary tables on startup.
- **Admin Dashboard**: A secure admin panel to view stats, manage API keys, configure prompt structures, and manage user tokens.
- **Request Logging**: Detailed logging of all requests made through the proxy, with options for enabling, disabling, or auto-purging logs.
- **User Token Management**: Create and manage user-specific tokens with customizable requests-per-minute (RPM) limits.
- **Dynamic Prompt Engineering**: Customize system prompts and jailbreaks for different providers directly from the admin panel.

## Getting Started

Follow these instructions to get a local copy up and running.

### Prerequisites

- [Node.js](https://nodejs.org/) (v16 or later recommended)
- npm (usually comes with Node.js)

### Installation

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/SaddoSenpai/Yomi-Proxy.git
    cd Yomi-Proxy
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

### Configuration

1.  Create a `.env` file in the root of the project by copying the example file:
    ```bash
    copy .env.example .env
    ```

2.  Edit the `.env` file with your desired settings.

    **Database:**
    - To use a PostgreSQL database, set the `DATABASE_URL`.
    - **For local use**, leave `DATABASE_URL` empty. The application will automatically create and use a `yomi-proxy.db` SQLite file.

    ```env
    # Optional: For PostgreSQL. If left empty, falls back to local SQLite.
    DATABASE_URL="postgresql://user:password@host:port/database"

    # --- Security ---
    # Password for the /admin dashboard
    ADMIN_PASS="your_secure_admin_password"
    # A long, random string for session security
    SESSION_SECRET="your_long_random_session_secret"

    # --- API Keys (add as needed) ---
    # Add one or more keys, separated by commas
    GEMINI_KEY="your_gemini_key_1,your_gemini_key_2"
    OPENAI_KEY="your_openai_key"
    # ... and so on for other providers
    ```

### Running the Application

Start the server with the following command:

```bash
node server.js
```

The application will be available at `http://localhost:3000`.

## Usage

### Proxy Endpoints

The proxy exposes a dynamic endpoint for each configured provider:

`POST /:providerId/v1/chat/completions`

-   `:providerId` should be the lowercase name of the provider (e.g., `openai`, `gemini`, or a custom provider ID).

### Admin Panel

Access the admin dashboard by navigating to `/admin` in your browser. You will be prompted for the admin password set in your `.env` file.
