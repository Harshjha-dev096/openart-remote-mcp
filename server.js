require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { chromium } = require("playwright");
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StreamableHTTPServerTransport } = require("@modelcontextprotocol/sdk/server/streamableHttp.js");
const z = require("zod/v4");

const app = express();

app.use(cors());
app.use(express.json());

/* =========================
   MCP TRANSPORT HANDLER
========================= */

const transportHandler = express.Router();

let browser;
let page;
let generationQueue = Promise.resolve();

async function generateImage(prompt) {
  if (!prompt) {
    throw new Error("Prompt required");
  }

  /* Launch browser once */
  if (!browser) {
    browser = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox"
      ]
    });

    const context = await browser.newContext();

    page = await context.newPage();
  }

  /* Open OpenArt */
  await page.goto("https://openart.ai/create", {
    waitUntil: "networkidle"
  });

  await page.waitForTimeout(5000);

  /* Find prompt textarea */
  const textarea = page.locator("textarea").first();

  /* Fill prompt */
  await textarea.fill(prompt);

  /* Submit */
  await page.keyboard.press("Enter");

  /* Wait for generation */
  await page.waitForTimeout(15000);

  return {
    success: true,
    message: "Image generation started",
    prompt
  };
}

function queueImageGeneration(prompt) {
  const run = generationQueue.then(() => generateImage(prompt));

  generationQueue = run.catch(() => {});

  return run;
}

function createMcpServer() {
  const mcpServer = new McpServer({
    name: "openart-remote-mcp",
    version: "1.0.0"
  });

  mcpServer.registerTool("generate_image", {
    title: "Generate Image",
    description: "Start an image generation on OpenArt using the provided prompt.",
    inputSchema: {
      prompt: z.string().min(1).describe("The image prompt to send to OpenArt.")
    }
  }, async ({ prompt }) => {
    const result = await queueImageGeneration(prompt);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2)
        }
      ]
    };
  });

  return mcpServer;
}

/* =========================
   ROOT CHECK
========================= */

app.get("/", (req, res) => {
  res.json({
    status: "OpenArt Remote MCP Running"
  });
});

/* =========================
   MCP ROOT
========================= */

transportHandler.get("/", (req, res) => {
  res.json({
    name: "openart-mcp",
    status: "running",
    mcpEndpoint: "/mcp",
    restEndpoint: "/mcp/generate"
  });
});

/* =========================
   MCP STREAMABLE HTTP API
========================= */

transportHandler.post("/", async (req, res) => {
  const mcpServer = createMcpServer();

  try {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined
    });

    await mcpServer.connect(transport);
    await transport.handleRequest(req, res, req.body);

    res.on("close", () => {
      transport.close();
      mcpServer.close();
    });
  } catch (error) {
    console.error(error);

    if (!res.headersSent) {
      return res.status(500).json({
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: "Internal server error"
        },
        id: null
      });
    }
  }
});

/* =========================
   GENERATE IMAGE
========================= */

transportHandler.post("/generate", async (req, res) => {
  try {
    const { prompt } = req.body;

    if (!prompt) {
      return res.status(400).json({
        error: "Prompt required"
      });
    }

    const result = await queueImageGeneration(prompt);

    return res.json(result);

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      error: error.message
    });
  }
});

/* =========================
   IMPORTANT MCP ROUTE
========================= */

app.use("/mcp", transportHandler);

/* =========================
   START SERVER
========================= */

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`MCP Server running on port ${PORT}`);
});
