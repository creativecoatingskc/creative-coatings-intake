# Creative Coatings Project Intake App

A ChatGPT app / MCP server for the Creative Coatings employee project intake with clickable controls.

## What this app does

- Opens a guided New Project Intake inside ChatGPT.
- Asks customer name, phone, and email one at a time.
- Uses clickable controls for project categories and follow-up choices.
- Routes into Creative Coatings service-specific intake branches.
- Enforces key scope rules such as chrome-delete emblem and grille handling.
- Produces a Printavo-ready project summary and intake status.

## Files included for Render

This package is ready to deploy to Render.

- `render.yaml` - Render Blueprint configuration
- `server.js` - Node/MCP server
- `public/intake-widget.html` - interactive employee intake UI
- `package.json` - Node dependencies
- `.gitignore` - prevents local junk files from being committed

## Step 1 - Create a GitHub repository

1. Sign in to GitHub.
2. Click **New repository**.
3. Name it `creative-coatings-intake`.
4. Keep it **Private** unless you intentionally want the source public.
5. Create the repository.
6. Upload all files from this folder to the root of the repository.
7. Commit the files.

Important: `render.yaml`, `package.json`, and `server.js` must be at the repository root, not inside a second nested folder.

## Step 2 - Deploy on Render

1. Sign in to Render.
2. Connect your GitHub account if prompted.
3. Choose **New > Blueprint**.
4. Select the `creative-coatings-intake` repository.
5. Render will detect `render.yaml`.
6. Apply the Blueprint and let the first deploy finish.

The included Blueprint uses Render's free web-service plan for testing. Free services can spin down after inactivity, so the first request after a period of inactivity may take longer. Upgrade later if you want it always warm for employees.

## Step 3 - Verify the deployment

Render will give you a public URL similar to:

```text
https://creative-coatings-intake.onrender.com
```

Open:

```text
https://YOUR-RENDER-URL/health
```

You should see a small JSON response with `"ok": true`.

Your ChatGPT MCP endpoint is:

```text
https://YOUR-RENDER-URL/mcp
```

## Step 4 - Connect it to the Creative Coatings ChatGPT workspace

In the Creative Coatings ChatGPT workspace, add the deployed app as a custom MCP/app connection and use the Render URL ending in `/mcp`.

Then open a new chat, select or mention the app, and say:

```text
Start a new project intake.
```

The employee should receive the interactive intake panel with clickable choices.

## Local test (optional)

Requirements: Node 18+

```bash
npm install
npm start
```

Local MCP endpoint:

```text
http://localhost:8787/mcp
```

Health endpoint:

```text
http://localhost:8787/health
```

## Important production note

This first version keeps intake state in the ChatGPT widget experience and does not yet use durable business storage. Do not treat it as the permanent system of record yet.

The intended workflow for this version is:

```text
Employee -> ChatGPT intake app -> validated Printavo-ready summary -> Printavo
```

A later version can add saved/resumable intakes and direct Printavo integration.
