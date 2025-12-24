# Deployment Guide (Vercel)

The app is optimized for deployment on [Vercel](https://vercel.com), which handles both the Frontend (React) and the Serverless Back-end (API functions).

## Prerequisites

1.  **Vercel Account**: Sign up at vercel.com.
2.  **Supabase Project**: You already have this.
3.  **GitHub Repository**: Push this code to a GitHub repository.

## Step-by-Step Deployment

1.  **Import to Vercel**
    *   Go to Vercel Dashboard -> **Add New...** -> **Project**.
    *   Select your GitHub repository.

2.  **Project Configuration**
    *   **Root Directory**: `.` (Leave as default)
    *   **Framework Preset**: Create React App (or Other)
    *   **Build Command**: `cd frontend && npm install && npm run build`
        *   **Important**: Enter the command exactly as above. **Do not** add quotes around it.
    *   **Output Directory**: `frontend/build`
    *   **Install Command**: `cd frontend && npm install`
        *   **Important**: Enter exactly as above. **Do not** add quotes.

3.  **Environment Variables**
    Add the following variables in the Vercel Project Settings:

    | Variable | Value | Description |
    | :--- | :--- | :--- |
    | `REACT_APP_SUPABASE_URL` | `https://your-project.supabase.co` | From Supabase |
    | `REACT_APP_SUPABASE_ANON_KEY` | `eyJ...` | From Supabase |
    | `SUPABASE_URL` | `https://your-project.supabase.co` | *Same as above (for API)* |
    | `SUPABASE_SERVICE_ROLE_KEY` | `eyJ...` | **Secret key** (for API) |
    | `SUPABASE_JWT_SECRET` | `super-secret-jwt` | Found in Supabase -> Settings -> API |

4.  **Deploy**
    *   Click **Deploy**.
    *   Vercel will build the frontend and deploy the `/api` functions.

## Local Development (Serverless)

To run the app locally with Serverless Functions, use the Vercel CLI:

1.  Install Vercel CLI: `npm i -g vercel`
2.  Link Project: `vercel link`
3.  Run Dev: `vercel dev`

This will start a local server (usually port 3000) that handles both the frontend and the `/api/verify-code` function.
