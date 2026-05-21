require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { chromium } = require("playwright");

const app = express();

app.use(cors());
app.use(express.json());

let browser;
let page;

app.get("/", (req, res) => {
  res.json({
    status: "OpenArt Remote MCP Running"
  });
});

app.post("/mcp/generate", async (req, res) => {
  try {
    const { prompt } = req.body;

    if (!prompt) {
      return res.status(400).json({
        error: "Prompt required"
      });
    }

    if (!browser) {
      browser = await chromium.launch({
        headless: false
      });

      const context = await browser.newContext();

      page = await context.newPage();
    }

    await page.goto("https://openart.ai/create", {
      waitUntil: "networkidle"
    });

    await page.waitForTimeout(5000);

    const textarea = await page.locator("textarea").first();

    await textarea.fill(prompt);

    await page.keyboard.press("Enter");

    await page.waitForTimeout(15000);

    res.json({
      success: true,
      message: "Image generation started",
      prompt
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: error.message
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`MCP Server running on port ${PORT}`);
});