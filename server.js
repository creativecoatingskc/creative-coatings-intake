import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const PORT = Number(process.env.PORT || 8787);
const MCP_PATH = "/mcp";
const WIDGET_URI = "ui://creative-coatings/project-intake-v1.html";
const widgetHtml = readFileSync("public/intake-widget.html", "utf8");

function createAppServer() {
  const server = new McpServer(
    { name: "creative-coatings-project-intake", version: "0.1.0" },
    {
      instructions:
        "Use open_project_intake whenever the user asks to start, create, or fill out a Creative Coatings new project intake. The UI is the primary intake experience. Employees should not have to type option numbers; the widget provides clickable controls.",
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
          _meta: {
            ui: {
              prefersBorder: true,
            },
          },
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
        "Open the guided Creative Coatings employee project intake with clickable buttons and one-question-at-a-time routing.",
      inputSchema: {},
      outputSchema: {
        mode: z.literal("new_project_intake"),
        version: z.string(),
      },
      _meta: {
        ui: { resourceUri: WIDGET_URI },
        "openai/toolInvocation/invoking": "Opening project intake...",
        "openai/toolInvocation/invoked": "Project intake opened.",
      },
    },
    async () => ({
      structuredContent: { mode: "new_project_intake", version: "0.1.0" },
      content: [
        {
          type: "text",
          text: "Creative Coatings Project Intake is open. Complete the guided questions in the intake panel.",
        },
      ],
    })
  );

  registerAppTool(
    server,
    "submit_project_intake",
    {
      title: "Submit Creative Coatings project intake",
      description:
        "Validate a completed Creative Coatings project intake and return the Printavo-ready summary.",
      inputSchema: {
        customer: z.object({
          name: z.string().min(1),
          phone: z.string().min(1),
          email: z.string().min(1),
        }),
        category: z.string().min(1),
        answers: z.record(z.any()),
        status: z.enum(["READY FOR QUOTE", "ESTIMATOR REVIEW REQUIRED", "INTAKE INCOMPLETE"]),
        missing: z.array(z.string()).default([]),
        summary: z.string().min(1),
      },
      outputSchema: {
        accepted: z.boolean(),
        status: z.string(),
        summary: z.string(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({ status, summary }) => ({
      structuredContent: { accepted: true, status, summary },
      content: [{ type: "text", text: summary }],
    })
  );

  return server;
}

const httpServer = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (req.method === "OPTIONS" && url.pathname === MCP_PATH) {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "content-type, mcp-session-id",
      "Access-Control-Expose-Headers": "Mcp-Session-Id",
    });
    res.end();
    return;
  }

  if (req.method === "GET" && url.pathname === "/") {
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    res.end("Creative Coatings Project Intake MCP server");
    return;
  }

  if (req.method === "GET" && url.pathname === "/health") {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true, service: "creative-coatings-project-intake" }));
    return;
  }

  if (url.pathname === MCP_PATH && ["POST", "GET", "DELETE"].includes(req.method || "")) {
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
      console.error(error);
      if (!res.headersSent) res.writeHead(500).end("Internal server error");
    }
    return;
  }

  res.writeHead(404).end("Not Found");
});

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`Creative Coatings intake MCP listening on http://0.0.0.0:${PORT}${MCP_PATH}`);
});
