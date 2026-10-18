import { getArtworkInvoices } from "./printavo-readonly.js";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import nodemailer from "nodemailer";
import { z } from "zod";
import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

const PORT = Number(process.env.PORT ?? 8787);
const MCP_PATH = "/mcp";
const WIDGET_URI = "ui://widget/project-intake-v8.html";
const widgetHtml = readFileSync("public/intake-widget.html", "utf8");

const SMTP_HOST = process.env.SMTP_HOST ?? "smtp.gmail.com";
const SMTP_PORT = Number(process.env.SMTP_PORT ?? 465);
const SMTP_USER = process.env.SMTP_USER ?? "";
const SMTP_PASS = process.env.SMTP_PASS ?? "";
const INTAKE_TO = process.env.INTAKE_TO ?? "info@creativecoatingskc.com";
const INTAKE_FROM = process.env.INTAKE_FROM ?? SMTP_USER;

async function sendIntakeEmail({ summary, customerName, projectType, intakeStatus }) {
  if (!SMTP_USER || !SMTP_PASS) {
    throw new Error("Email is not configured on the Render service.");
  }

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });

  const subject = `NEW JOB INTAKE - ${customerName || "Customer"} - ${projectType || "New Job"}`;
  const text = [
    "CREATIVE COATINGS - NEW JOB INTAKE",
    "",
    `Status: ${intakeStatus || "Submitted"}`,
    "",
    summary,
    "",
    "---",
    "Submitted automatically through the Creative Coatings New Job Intake.",
  ].join("\n");

  const info = await transporter.sendMail({
    from: INTAKE_FROM,
    to: INTAKE_TO,
    subject,
    text,
  });

  return { messageId: info.messageId, recipient: INTAKE_TO, subject };
}

function createAppServer() {
  const server = new McpServer(
    {
      name: "creative-coatings-project-intake",
      version: "0.2.8",
    },
    {
      instructions:
        "Use open_project_intake to launch the Creative Coatings guided intake. Use submit_project_intake only after the user has completed and confirmed the intake summary.",
    }
  );

  registerAppResource(
    server,
    "creative-coatings-intake-widget",
    WIDGET_URI,
    {},
    async () => ({
      contents: [
        {
          uri: WIDGET_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: widgetHtml,
        },
      ],
    })
  );

  registerAppTool(
    server,
    "open_project_intake",
    {
      title: "Open Creative Coatings project intake",
      description:
        "Use this whenever the user asks to start, create, open, or fill out a Creative Coatings new project intake. Opens the interactive employee intake form with clickable choices.",
      inputSchema: {},
      outputSchema: {
        mode: z.string(),
        version: z.string(),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
      _meta: {
        ui: { resourceUri: WIDGET_URI },
        "openai/toolInvocation/invoking": "Opening project intake...",
        "openai/toolInvocation/invoked": "Project intake opened.",
      },
    },
    async () => ({
      content: [
        {
          type: "text",
          text: "The Creative Coatings Project Intake is open. Complete the guided intake in the interactive panel.",
        },
      ],
      structuredContent: {
        mode: "new_project_intake",
        version: "0.2.6",
      },
    })
  );

  registerAppTool(
    server,
    "submit_project_intake",
    {
      title: "Submit Creative Coatings project intake",
      description:
        "Submit a completed Creative Coatings project intake and email the full summary to the shop.",
      inputSchema: {
        summary: z.string().min(1),
        customerName: z.string().optional(),
        projectType: z.string().optional(),
        intakeStatus: z.string().optional(),
      },
      outputSchema: {
        ok: z.boolean(),
        emailed: z.boolean(),
        recipient: z.string(),
        subject: z.string(),
        messageId: z.string(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      _meta: {
        "openai/toolInvocation/invoking": "Submitting intake...",
        "openai/toolInvocation/invoked": "Intake submitted.",
      },
    },
    async ({ summary, customerName, projectType, intakeStatus }) => {
      const email = await sendIntakeEmail({
        summary,
        customerName,
        projectType,
        intakeStatus,
      });

      return {
        content: [
          {
            type: "text",
            text: `Job intake submitted and emailed to ${email.recipient}.`,
          },
        ],
        structuredContent: {
          ok: true,
          emailed: true,
          recipient: email.recipient,
          subject: email.subject,
          messageId: email.messageId,
        },
      };
    }
  );

  return server;
}

const httpServer = createServer(async (req, res) => {
  if (!req.url) {
    res.writeHead(400).end("Missing URL");
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
  console.log(`${req.method ?? "?"} ${url.pathname}`);

  if (req.method === "OPTIONS" && url.pathname === MCP_PATH) {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      "Access-Control-Allow-Headers": "content-type, mcp-session-id",
      "Access-Control-Expose-Headers": "Mcp-Session-Id",
    });
    res.end();
    return;
  }

  if (req.method === "GET" && url.pathname === "/") {
    res
      .writeHead(200, { "content-type": "text/plain; charset=utf-8" })
      .end("Creative Coatings Project Intake MCP server v0.2.8");
    return;
  }

  if (req.method === "GET" && url.pathname === "/health") {
    res
      .writeHead(200, { "content-type": "application/json; charset=utf-8" })
      .end(
        JSON.stringify({
          ok: true,
          service: "creative-coatings-project-intake",
          version: "0.2.7",
        })
      );
    return;
  }

  // Protected, read-only diagnostic. Never expose customer data without a secret.
  if (url.pathname === "/internal/printavo/artwork-invoices") {
    if (req.method !== "GET") { res.writeHead(405).end("Method not allowed"); return; }
    const secret = process.env.INTEGRATION_ACCESS_TOKEN;
    const supplied = req.headers.authorization;
    if (!secret || !supplied || supplied !== `Bearer ${secret}`) {
      res.writeHead(401).end("Unauthorized");
      return;
    }
    try {
      const result = await getArtworkInvoices();
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }).end(JSON.stringify(result));
    } catch (error) {
      console.error("Printavo read-only test failed:", error.message);
      res.writeHead(502, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }).end(JSON.stringify({ ok: false, error: "Printavo query failed; inspect Render logs" }));
    }
    return;
  }

  const MCP_METHODS = new Set(["POST", "GET", "DELETE"]);
  if (url.pathname === MCP_PATH && req.method && MCP_METHODS.has(req.method)) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");

    const server = createAppServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    res.on("close", () => {
      transport.close();
      server.close();
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch (error) {
      console.error("Error handling MCP request:", error);
      if (!res.headersSent) {
        res.writeHead(500).end("Internal server error");
      }
    }
    return;
  }

  res.writeHead(404).end("Not Found");
});

// Test-only startup probe: verifies Printavo connectivity without logging secrets or invoices.
async function testPrintavoConnection() {
  if (process.env.PRINTAVO_CONNECTION_TEST !== "true") return;
  try {
    const response = await fetch("https://www.printavo.com/api/v2", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        email: process.env.PRINTAVO_EMAIL ?? "",
        token: process.env.PRINTAVO_API_TOKEN ?? "",
      },
      body: JSON.stringify({ query: "{ __typename }" }),
      signal: AbortSignal.timeout(15000),
    });
    const data = await response.json().catch(() => ({}));
    if (response.ok && !data.errors?.length) {
      const schemaResponse = await fetch("https://www.printavo.com/api/v2", {
        method: "POST",
        headers: { "content-type": "application/json", email: process.env.PRINTAVO_EMAIL ?? "", token: process.env.PRINTAVO_API_TOKEN ?? "" },
        body: JSON.stringify({ query: "{ __schema { queryType { fields { name args { name type { kind name ofType { kind name } } } type { kind name ofType { kind name } } } } } }" }),
        signal: AbortSignal.timeout(15000),
      });
      const schema = await schemaResponse.json().catch(() => ({}));
      const fields = schema.data?.__schema?.queryType?.fields ?? [];
      console.log("PRINTAVO_SCHEMA_RESULT", JSON.stringify({
        httpStatus: schemaResponse.status,
        errors: (schema.errors ?? []).map(e => e.extensions?.code ?? "graphql_error"),
        relevantFields: fields.filter(f => /status|invoice/i.test(f.name)),
        introspectionAvailable: Boolean(schema.data?.__schema),
      }));
    }
    console.log("PRINTAVO_TEST_RESULT", JSON.stringify({
      httpStatus: response.status,
      authenticated: response.ok && !data.errors?.length,
      graphqlType: data.data?.__typename ?? null,
      errorCategories: (data.errors ?? []).map(e => e.extensions?.code ?? "graphql_error"),
    }));
  } catch (error) {
    console.log("PRINTAVO_TEST_RESULT", JSON.stringify({ authenticated: false, errorType: error.name }));
  }
}

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`Creative Coatings intake MCP listening on port ${PORT}`);
  void testPrintavoConnection();
});
