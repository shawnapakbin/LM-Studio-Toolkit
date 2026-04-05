# AI Integrations

Add agentic browsing to your AI. Browserless runs managed, stealth-enabled browsers that your agent can control to plan, act, and observe the web. Use it two ways: as an agent's browser (LLM-directed) or as a reliable tool inside your workflow.

Before you start

- Create an account and get your API token from the Browserless dashboard.
- You'll pass it as the token query parameter.
- Choose a regional endpoint (for example, production-sfo).

## What is agentic browsing?​

Agentic browsing lets an AI system decide what to do next based on what it sees in the browser. The model plans, takes an action in the page, observes the result, then repeats until the goal is reached. Browserless provides the robust browser runtime for this loop—stealth, proxy support, CAPTCHA solving, and persistent sessions—without you managing infrastructure.

## Choose a path​

### Agentic (LLM-directed)​

Use Browserless as the browser your agent controls via WebSocket or tools.

- Browserless MCP Server — Connect Claude Desktop, Cursor, VS Code, and Windsurf to the Browserless power scraper via the Model Context Protocol
- Browser Use — Agentic browsing in Python backed by Browserless
- Stagehand — AI browser automation with natural language and code, powered by Browserless
- Vercel AI SDK — Build AI handlers and tools that call Browserless from Next.js
- LangChain — Use Browserless tools and loaders inside chains and agents
- AgentKit — Build fault-tolerant AI agents with Browserless browser tools via Inngest
- Claude Agent SDK — Build autonomous AI agents powered by Claude that browse with stealth mode, CAPTCHA solving, and residential proxies
- Claude Code + Playwright — Control a stealth-enabled, CAPTCHA-solving Browserless browser from Claude Code via Playwright MCP
- Anthropic Computer Use — Scalable AI browser automation using Claude's screenshot + action loop with Browserless cloud browsers
- Agent Browser — Headless browser automation CLI for AI agents, powered by Browserless
- OpenAI CUA — Screenshot-driven browser automation with OpenAI's Computer Use Agent and Browserless

### Workflow and no-code tools​

Call Browserless as a reliable API inside your automation.

- n8n — Drag-and-drop workflows with Browserless REST and BQL
- Make — No-code automation calling Browserless
- Zapier — Trigger Browserless actions from Zapier apps

## What you can build​

- Research agents that browse, click, and extract answers from multi-step sites
- Automated form fill and verification flows with screenshots and PDF receipts
- Structured scraping pipelines that bypass bot detection, then hand off clean sessions to Puppeteer or Playwright

## Capabilities you get out of the box​

Stealth and anti-bot resilience, optional residential proxies, CAPTCHA solving and Cloudflare verification, persistent sessions and reconnection, regional endpoints, and BrowserQL for complex multi-step automation. Explore [REST APIs](https://docs.browserless.io/rest-apis/screenshot-api) and [BrowserQL](https://docs.browserless.io/browserql/start).

# Add Browser Capabilities to AI with Browser Use

[Browser Use](https://github.com/browser-use/browser-use) is a Python library that allows AI agents to control a browser. By integrating Browserless with Browser Use, you can provide your AI applications with powerful web browsing capabilities without managing browser infrastructure.

## Prerequisites​

- Python 3.11+
- Browserless API Token (available in your account dashboard)
- LLM provider API key (OpenAI used in this guide; get your key from OpenAI's API keys page)

### Tooling​

- Virtual environment: python -m venv is the recommended, built-in way to create a virtual environment (no additional installation required).
- Optional tools:

uv - Fast Python package installer and resolver
conda - Package and environment manager

## Step-by-Step Setup​

1. Set your Browserless token + LLM API key

You'll need three environment variables:

- BROWSERLESS_TOKEN - Your Browserless token (get it from your Browserless Account Dashboard)
- OPENAI_API_KEY - Your OpenAI key (get it from OpenAI's API keys page)
- BROWSERLESS_WS_URL - Browserless WebSocket URL (default: wss://production-sfo.browserless.io)

**Note:** While other LLM providers can be used, this guide uses OpenAI for the examples.

See the [Environment Variables + .env file](https://docs.browserless.io/ai-integrations/browser-use/python#environment-variables--env-file) section below for detailed setup instructions.

2. Create a virtual environment

Set up a Python virtual environment to manage your dependencies. The built-in `venv` module is recommended as it requires no additional installs:

- venv (recommended)
- Optional: Using uv
- Optional: Using conda

- macOS/Linux
- Windows (CMD)

```
# Verify Python version (should be 3.11+)python3 --version# Create virtual environmentpython3 -m venv .venvsource .venv/bin/activate
```

```
# Verify Python version (should be 3.11+)py --version# Create virtual environmentpy -m venv .venv.venv\Scripts\activate
```

If you have [uv](https://github.com/astral-sh/uv) installed, you can use it as an alternative:

```
python -m venv .venvsource .venv/bin/activate  # On Windows (CMD): .venv\Scripts\activate
```

After activation, install dependencies with `uv pip install` (see step 3).

If you have [conda](https://docs.conda.io/en/latest/miniconda.html) installed, you can use it as an alternative:

```
conda create -n browserless-env python=3.11conda activate browserless-env
```

**Note:** The default path is `venv` + `pip`. `uv` and `conda` are optional alternatives.

3. Install required packages

Make sure your virtual environment is activated, then install the required packages:

- pip (default)
- Optional: Using uv

- macOS/Linux
- Windows

```
# Make sure your virtual environment is activatedsource .venv/bin/activate# Install required packagespip install browser-use python-dotenv openai
```

```
# Make sure your virtual environment is activated.venv\Scripts\activate# Install required packagespip install browser-use python-dotenv openai
```

If you're using `uv` (see step 2), install with:

```
# Make sure your virtual environment is activatedsource .venv/bin/activate  # macOS/Linux# or.venv\Scripts\activate  # Windows CMD# Install required packagesuv pip install browser-use python-dotenv openai
```

**Note:** The quickstart uses `uv pip install`, not `uv add` or `uv init`.

4. Environment Variables + .env file

Create a `.env` file in your project directory with the following variables:

```
BROWSERLESS_TOKEN=your_browserless_token_hereOPENAI_API_KEY=your_openai_key_hereBROWSERLESS_WS_URL=wss://production-sfo.browserless.io
```

**Note:** This guide uses `BROWSERLESS_TOKEN` to match the repository standard. Other scripts in this repository also use `BROWSERLESS_TOKEN` for consistency.

**Important:** Do not commit `.env` to version control. Add `.env` to your `.gitignore` file.

If you prefer to set environment variables directly (without a `.env` file):

- macOS/Linux
- Windows (PowerShell)
- Windows (CMD)

```
export BROWSERLESS_TOKEN=your_browserless_token_hereexport OPENAI_API_KEY=your_openai_key_hereexport BROWSERLESS_WS_URL=wss://production-sfo.browserless.io
```

```
$env:BROWSERLESS_TOKEN="your_browserless_token_here"$env:OPENAI_API_KEY="your_openai_key_here"$env:BROWSERLESS_WS_URL="wss://production-sfo.browserless.io"
```

```
set BROWSERLESS_TOKEN=your_browserless_token_hereset OPENAI_API_KEY=your_openai_key_hereset BROWSERLESS_WS_URL=wss://production-sfo.browserless.io
```

**Note:** The examples in this guide use `python-dotenv` to automatically load the `.env` file.

5. Create the main.py file

Create a new file named `main.py` with the following complete code:

```
from browser_use import Agent, BrowserSessionfrom browser_use.llm import ChatOpenAIfrom dotenv import load_dotenvimport osimport asyncio# Load environment variables from .env fileload_dotenv()async def main():    # Validate required environment variables    browserless_token = os.getenv('BROWSERLESS_TOKEN')    openai_key = os.getenv('OPENAI_API_KEY')    browserless_ws_url = os.getenv('BROWSERLESS_WS_URL', 'wss://production-sfo.browserless.io')        if not browserless_token:        raise RuntimeError("BROWSERLESS_TOKEN environment variable is required. Get your token from https://browserless.io/account/")    if not openai_key:        raise RuntimeError("OPENAI_API_KEY environment variable is required. Get your key from https://platform.openai.com/api-keys")        # Create browser session using BROWSERLESS_WS_URL    browser_session = BrowserSession(        cdp_url=f"{browserless_ws_url}?token={browserless_token}"    )    # Setup LLM    llm = ChatOpenAI(model="gpt-4o-mini", api_key=openai_key)    # Create and run agent with a simple task    agent = Agent(        task="Go to https://example.com and tell me the main heading on the page",        llm=llm,        browser_session=browser_session    )        result = await agent.run()    print(result)if __name__ == "__main__":    asyncio.run(main())
```

6. Run your application

Make sure your virtual environment is activated, then run your application:

- macOS/Linux
- Windows

```
# Make sure your virtual environment is activatedsource .venv/bin/activate# Run your applicationpython main.py
```

```
# Make sure your virtual environment is activated.venv\Scripts\activate# Run your applicationpython main.py
```

You should see output indicating that the browser is initialized and the agent is running.

## How It Works​

1. Connection Setup: Browser Use connects to Browserless using the WebSocket endpoint with your API token
2. Agent Configuration: The AI agent is configured with a task and a language model
3. Automation: The agent uses the browser to navigate and interact with websites
4. LLM Integration: The agent leverages an LLM (like GPT-4o) to interpret web content and make decisions

## Complete Example with Cloud Browser​

Here's a complete example that demonstrates the modern `BrowserSession` approach with proper environment variable handling:

```
"""Simple browser-use + Browserless.io connection example"""import asyncioimport osfrom browser_use import Agentfrom browser_use.browser import BrowserSessionfrom browser_use.llm import ChatOpenAIfrom dotenv import load_dotenv# Load environment variables from .env fileload_dotenv()async def main():    # Validate required environment variables    browserless_token = os.getenv('BROWSERLESS_TOKEN')    openai_key = os.getenv('OPENAI_API_KEY')    browserless_ws_url = os.getenv('BROWSERLESS_WS_URL', 'wss://production-sfo.browserless.io')        if not browserless_token:        raise RuntimeError("BROWSERLESS_TOKEN environment variable is required. Get your token from https://browserless.io/account/")    if not openai_key:        raise RuntimeError("OPENAI_API_KEY environment variable is required. Get your key from https://platform.openai.com/api-keys")        # Setup LLM    llm = ChatOpenAI(model="gpt-4o-mini", api_key=openai_key)        # Setup browser session using BROWSERLESS_WS_URL    url = f"{browserless_ws_url}?token={browserless_token}"    browser_session = BrowserSession(cdp_url=url)    print("🌐 Using cloud browser")        # Create and run agent    agent = Agent(        task="Go to https://example.com and tell me the main heading",        llm=llm,        browser_session=browser_session    )        result = await agent.run(max_steps=5)    print(f"✅ Done! Result: {type(result).__name__}")if __name__ == "__main__":    asyncio.run(main())
```

## Advanced / Bot-Protected Sites​

For sites with bot protection (like eBay), you may need additional configuration:

```
from browser_use import Agent, BrowserSessionfrom browser_use.llm import ChatOpenAIfrom dotenv import load_dotenvimport osimport asyncioload_dotenv()async def main():    browserless_token = os.getenv('BROWSERLESS_TOKEN')    openai_key = os.getenv('OPENAI_API_KEY')    browserless_ws_url = os.getenv('BROWSERLESS_WS_URL', 'wss://production-sfo.browserless.io')        if not browserless_token:        raise RuntimeError("BROWSERLESS_TOKEN environment variable is required")    if not openai_key:        raise RuntimeError("OPENAI_API_KEY environment variable is required")        # Use stealth mode and residential proxy for bot-protected sites    browser_session = BrowserSession(        cdp_url=f"{browserless_ws_url}?token={browserless_token}&stealth=true&proxy=residential"    )    llm = ChatOpenAI(model="gpt-4o-mini", api_key=openai_key)    agent = Agent(        task="Find me the top cheapest trainer on ebay.co.uk",        llm=llm,        browser_session=browser_session    )        result = await agent.run()    print(result)if __name__ == "__main__":    asyncio.run(main())
```

## Additional Configuration Options​

### Using Different Browserless Regions​

You can connect to different Browserless regions for better performance by setting `BROWSERLESS_WS_URL` in your `.env` file:

```
# US West Coast (default)BROWSERLESS_WS_URL=wss://production-sfo.browserless.io# Europe (London)BROWSERLESS_WS_URL=wss://production-lon.browserless.io
```

### Proxy Support​

You can enable a residential proxy for improved website compatibility:

```
browserless_ws_url = os.getenv('BROWSERLESS_WS_URL', 'wss://production-sfo.browserless.io')browserless_token = os.getenv('BROWSERLESS_TOKEN')browser_session = BrowserSession(    cdp_url=f"{browserless_ws_url}?token={browserless_token}&proxy=residential")
```

### Stealth Mode and Proxy Support​

Enable stealth mode and residential proxies for better website compatibility:

```
browserless_ws_url = os.getenv('BROWSERLESS_WS_URL', 'wss://production-sfo.browserless.io')browserless_token = os.getenv('BROWSERLESS_TOKEN')browser_session = BrowserSession(    cdp_url=f"{browserless_ws_url}?token={browserless_token}&stealth=true&proxy=residential")
```

### Custom Browser Configuration​

Configure browser settings using BrowserProfile:

```
from browser_use.browser import BrowserProfilebrowserless_ws_url = os.getenv('BROWSERLESS_WS_URL', 'wss://production-sfo.browserless.io')browserless_token = os.getenv('BROWSERLESS_TOKEN')browser_session = BrowserSession(    cdp_url=f"{browserless_ws_url}?token={browserless_token}",    browser_profile=BrowserProfile(        user_agent="Custom User Agent",        viewport_size={"width": 1920, "height": 1080},        headless=True,    ))
```

## Troubleshooting​

### Missing Environment Variables​

**Error**: `RuntimeError: BROWSERLESS_TOKEN environment variable is required`

**Solution**: Ensure your `.env` file contains `BROWSERLESS_TOKEN` and `OPENAI_API_KEY`, or set them as environment variables. Verify the file is in the same directory as your script.

### .env File Not Being Loaded​

**Error**: Environment variables are `None` even though they're in `.env`

**Solution**:

- Ensure python-dotenv is installed: pip install python-dotenv
- Call load_dotenv() at the top of your script (before accessing environment variables)
- Verify the .env file is in the same directory as your script

### uv Issues​

**Error**: `uv add` command fails or doesn't work as expected

**Solution**: The quickstart uses `uv pip install` instead of `uv add`. The `uv add` command requires a project to be initialized with `uv init`, which is not needed for the quickstart. Use `uv pip install browser-use python-dotenv` after activating your virtual environment.

### Windows-Specific Problems​

**Error**: `ExecutionPolicy` error when activating virtual environment in PowerShell

**Solution**: Run PowerShell as Administrator and execute:

```
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

Alternatively, use Command Prompt (CMD) instead of PowerShell, or use `python -m venv` and activate with `.venv\Scripts\activate.bat`.

**Error**: Environment variables not persisting

**Solution**: In PowerShell, use `$env:VARIABLE_NAME="value"`. In CMD, use `set VARIABLE_NAME=value`. For persistence, add them to your `.env` file instead.

### Connection / Endpoint Issues​

**Error**: Connection timeout or failed to connect

**Solution**:

- Verify BROWSERLESS_WS_URL is set correctly (default: wss://production-sfo.browserless.io)
- Check that your BROWSERLESS_TOKEN is valid and active
- Try a different region endpoint if you're experiencing latency issues
- Ensure your network allows WebSocket connections

For more information about browser automation with Browserless, please refer to:

- Browser Use Documentation
- Browserless BaaS Documentation
- Integrating with other LLM providers

# Vercel AI SDK Integration

This guide demonstrates how to build a fully functional AI-powered browser automation application using Browserless.io, Vercel AI SDK, and Next.js. The application allows AI agents to control browsers through natural language instructions, enabling tasks like web scraping, form filling, and content extraction.

## Introduction​

This integration combines three powerful technologies:

- Browserless.io: A headless browser service that provides browser automation capabilities
- Vercel AI SDK: A toolkit for building AI-powered applications
- Next.js: A React framework for building web applications

Together, these technologies enable you to create applications where AI can understand and execute browser automation tasks through natural language.

## Prerequisites​

- Node.js 18 or higher
- Vercel account
- Browserless.io API token
- OpenAI API key (or other supported LLM provider)

## Step 1: Project Setup​

### Create a Next.js Project​

```
npx create-next-app@latest browserless-aicd browserless-ai
```

### Install Required Packages​

```
npm install @vercel/ai @browserless/ai puppeteer-core openai zod prettier
```

### Configure Environment Variables​

Create a `.env.local` file in your project root:

```
BROWSERLESS_API_KEY=your_browserless_api_keyOPENAI_API_KEY=your_openai_api_key
```

## Step 2: Core Components​

### Browser Service​

Create `src/lib/browser.ts`:

```
import puppeteer from 'puppeteer-core';import { z } from 'zod';// Schema for browser settingsconst BrowserSettingsSchema = z.object({  viewport: z.object({    width: z.number().default(1920),    height: z.number().default(1080),  }),  userAgent: z.string().optional(),  timeout: z.number().default(30000),});export type BrowserSettings = z.infer<typeof BrowserSettingsSchema>;export class BrowserlessService {  private static instance: BrowserlessService;  private browser: puppeteer.Browser | null = null;  private settings: BrowserSettings;  private constructor(settings: Partial<BrowserSettings> = {}) {    this.settings = BrowserSettingsSchema.parse(settings);  }  static getInstance(settings?: Partial<BrowserSettings>): BrowserlessService {    if (!BrowserlessService.instance) {      BrowserlessService.instance = new BrowserlessService(settings);    }    return BrowserlessService.instance;  }  async getBrowser(): Promise<puppeteer.Browser> {    if (!this.browser) {      this.browser = await puppeteer.connect({        browserWSEndpoint: `wss://production-sfo.browserless.io?token=${process.env.BROWSERLESS_API_KEY}`,        defaultViewport: this.settings.viewport,      });    }    return this.browser;  }  async close() {    if (this.browser) {      await this.browser.close();      this.browser = null;    }  }}
```

### AI Route Handler​

Create `src/app/api/chat/route.ts`:

```
import { OpenAIStream, StreamingTextResponse } from 'ai';import { BrowserlessService } from '@/lib/browser';import OpenAI from 'openai';import { z } from 'zod';// Schema for chat messagesconst MessageSchema = z.object({  role: z.enum(['user', 'assistant', 'system']),  content: z.string(),});const openai = new OpenAI({  apiKey: process.env.OPENAI_API_KEY,});export async function POST(req: Request) {  try {    const { messages } = await req.json();        // Validate messages    const validatedMessages = z.array(MessageSchema).parse(messages);        const browserService = BrowserlessService.getInstance();    const browser = await browserService.getBrowser();    const page = await browser.newPage();    // Process the message and perform browser actions    const response = await openai.chat.completions.create({      model: 'gpt-4-turbo',      stream: true,      messages: [        {          role: 'system',          content: `You are a browser automation assistant. You can:          1. Navigate to URLs          2. Extract information from pages          3. Fill out forms          4. Take screenshots          5. Click elements          6. Type text          Always respond with clear instructions for the browser.`        },        ...validatedMessages,      ],    });    const stream = OpenAIStream(response, {      async onCompletion(completion) {        try {          // Process the AI's response and perform browser actions          if (completion.includes('navigate to')) {            const url = completion.match(/navigate to (https?:\/\/[^\s]+)/)?.[1];            if (url) {              await page.goto(url, { waitUntil: 'networkidle0' });            }          }                    if (completion.includes('click')) {            const selector = completion.match(/click "([^"]+)"/)?.[1];            if (selector) {              await page.click(selector);            }          }                    if (completion.includes('type')) {            const [selector, text] = completion.match(/type "([^"]+)" into "([^"]+)"/)?.slice(1) || [];            if (selector && text) {              await page.type(selector, text);            }          }                    // Add more action handlers as needed        } catch (error) {          console.error('Error executing browser action:', error);        }      },    });    return new StreamingTextResponse(stream);  } catch (error) {    console.error('Error processing request:', error);    return new Response(      JSON.stringify({ error: 'Failed to process request' }),      { status: 500 }    );  }}
```

### Chat Interface​

Create `src/app/page.tsx`:

```
'use client';import { useChat } from 'ai/react';import { useState } from 'react';export default function Chat() {  const { messages, input, handleInputChange, handleSubmit, isLoading } = useChat();  const [isProcessing, setIsProcessing] = useState(false);  return (    <div className="flex flex-col w-full max-w-2xl mx-auto p-4">      <div className="flex-1 overflow-y-auto mb-4">        {messages.map((message) => (          <div            key={message.id}            className={`p-4 mb-4 rounded-lg ${              message.role === 'user'                ? 'bg-blue-100 ml-auto'                : 'bg-gray-100 mr-auto'            }`}          >            <div className="whitespace-pre-wrap">{message.content}</div>          </div>        ))}      </div>      <form onSubmit={handleSubmit} className="flex gap-2">        <input          className="flex-1 p-2 border border-gray-300 rounded-lg"          value={input}          placeholder="Ask the AI to perform browser actions..."          onChange={handleInputChange}          disabled={isLoading || isProcessing}        />        <button          type="submit"          className="px-4 py-2 bg-blue-500 text-white rounded-lg disabled:opacity-50"          disabled={isLoading || isProcessing}        >          Send        </button>      </form>    </div>  );}
```

## Step 3: Advanced Features​

### Session Management​

Create `src/lib/session.ts`:

```
import { BrowserlessService } from './browser';import puppeteer from 'puppeteer-core';export class BrowserSession {  private static sessions: Map<string, {    page: puppeteer.Page;    lastActive: number;  }> = new Map();  private static readonly SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes  static async getSession(sessionId: string): Promise<puppeteer.Page> {    const session = this.sessions.get(sessionId);        if (session && Date.now() - session.lastActive < this.SESSION_TIMEOUT) {      session.lastActive = Date.now();      return session.page;    }    const browser = await BrowserlessService.getInstance().getBrowser();    const page = await browser.newPage();        this.sessions.set(sessionId, {      page,      lastActive: Date.now(),    });    return page;  }  static async cleanup() {    const now = Date.now();    for (const [sessionId, session] of this.sessions.entries()) {      if (now - session.lastActive > this.SESSION_TIMEOUT) {        await session.page.close();        this.sessions.delete(sessionId);      }    }  }}
```

### Error Handling Middleware​

Create `src/middleware.ts`:

```
import { NextResponse } from 'next/server';import { z } from 'zod';export async function middleware(request: Request) {  try {    // Add rate limiting    const ip = request.headers.get('x-forwarded-for') || 'unknown';    // Implement your rate limiting logic here    // Validate request body    if (request.method === 'POST') {      const body = await request.json();      // Add your validation logic here    }    return NextResponse.next();  } catch (error) {    console.error('Middleware error:', error);    return new NextResponse(      JSON.stringify({ error: 'Internal server error' }),      { status: 500 }    );  }}
```

## Step 4: Testing​

### Local Testing​

1. Start the development server:

```
npm run dev
```

1. Test the API endpoints:

```
curl -X POST http://localhost:3000/api/chat \  -H "Content-Type: application/json" \  -d '{"messages": [{"role": "user", "content": "Navigate to example.com"}]}'
```

### Production Testing​

1. Deploy to Vercel:

```
vercel
```

1. Test the deployed endpoints:

```
curl -X POST https://your-app.vercel.app/api/chat \  -H "Content-Type: application/json" \  -d '{"messages": [{"role": "user", "content": "Navigate to example.com"}]}'
```

## Step 5: Deployment​

### Vercel Deployment​

1. Push your code to GitHub
2. Import the project in Vercel
3. Add your environment variables:

BROWSERLESS_API_KEY
OPENAI_API_KEY
4. Deploy!

### Environment Configuration​

Configure your Vercel project settings:

```
{  "buildCommand": "next build",  "outputDirectory": ".next",  "framework": "nextjs",  "installCommand": "npm install",  "regions": ["sfo1"]}
```

## Best Practices​

1. Resource Management

Always close browser pages when done
Implement session timeouts
Clean up unused resources
2. Error Handling

Implement comprehensive error handling
Log errors appropriately
Provide meaningful error messages
3. Security

Validate all inputs
Implement rate limiting
Use environment variables for sensitive data
4. Performance

Use appropriate timeouts
Implement caching where possible
Optimize browser operations
5. Monitoring

Set up error tracking
Monitor API usage
Track performance metrics

## Troubleshooting​

### Common Issues​

1. Connection Errors

Check your Browserless.io API key
Verify network connectivity
Check firewall settings
2. Timeout Errors

Increase timeout values
Optimize browser operations
Implement retry logic
3. Rate Limit Errors

Implement proper rate limiting
Monitor API usage
Consider upgrading your plan

### Debugging Tips​

1. Enable verbose logging:

```
process.env.DEBUG = 'browserless:*';
```

1. Use the Browserless.io dashboard to monitor sessions
2. Implement request logging:

```
console.log('Request:', {  url: request.url,  method: request.method,  headers: Object.fromEntries(request.headers),});
```

## Additional Resources​

- Browserless.io Documentation
- Vercel AI SDK Documentation
- Next.js Documentation
- OpenAI API Documentation

# Add Web Scraping Capabilities to AI with LangChain

[LangChain](https://www.langchain.com/) is a framework for developing applications powered by language models. By integrating Browserless with LangChain, you can provide your AI applications with powerful web scraping and content processing capabilities without managing browser infrastructure.

## Prerequisites​

- Python 3.8 or higher
- An active Browserless API Token (available in your account dashboard)
- Basic understanding of LangChain concepts

## Step-by-Step Setup​

1. Get your API Key

Go to your [Browserless Account Dashboard](https://browserless.io/account/) and copy your API token.

Then set the `BROWSERLESS_API_TOKEN` environment variable in your `.env` file:

- .env file
- Command line

```
BROWSERLESS_API_TOKEN=your-token-here
```

```
export BROWSERLESS_API_TOKEN=your-token-here
```

2. Create a virtual environment

Set up a Python virtual environment to manage your dependencies:

- venv
- conda

```
python -m venv .venvsource .venv/bin/activate  # On Windows: .venv\Scripts\activate
```

```
conda create -n langchain-env python=3.8conda activate langchain-env
```

3. Install required packages

Install LangChain and other required packages:

- pip
- Poetry

```
pip install langchain-community python-dotenv
```

```
poetry add langchain-community python-dotenv
```

4. Create your first script

Create a file named `scraper.py` with the following complete code:

```
from dotenv import load_dotenvimport osfrom langchain_community.document_loaders import BrowserlessLoaderdef main():    # Load environment variables    load_dotenv()        # Initialize the loader with your API token    loader = BrowserlessLoader(        api_token=os.getenv("BROWSERLESS_API_TOKEN"),        urls=["https://example.com"],        text_content=True  # Get text content instead of raw HTML    )    # Load and process the documents    documents = loader.load()        # Print the results    for doc in documents:        print(f"Source: {doc.metadata.get('source')}")        print(f"Content: {doc.page_content[:200]}...")if __name__ == "__main__":    main()
```

5. Run your application

Run your application with the following command:

```
python scraper.py
```

You should see output showing the scraped content from the example website.

## How It Works​

**1. Connection Setup**: BrowserlessLoader connects to Browserless using your API token

**2. Content Loading**: The loader fetches and processes web content

**3. Document Creation**: Content is converted into LangChain Documents

**4. Processing**: Documents can be further processed with LangChain's tools

## Advanced Configuration​

### Multiple URLs​

Process multiple websites in a single operation:

```
loader = BrowserlessLoader(    api_token=api_token,    urls=[        "https://example1.com",        "https://example2.com",        "https://example3.com"    ])
```

### Raw HTML Mode​

Get raw HTML content instead of text:

```
loader = BrowserlessLoader(    api_token=api_token,    urls=["https://example.com"],    text_content=False)
```

## Performance Optimization​

1. Batch Processing

Process multiple URLs in batches
Implement proper error handling
Use async/await for better performance
2. Resource Management

Monitor memory usage
Implement proper cleanup
Handle timeouts appropriately

## Security Best Practices​

1. API Token Management

Never commit tokens to version control
Use environment variables
Rotate tokens regularly
2. Input Validation

Validate URLs before processing
Implement rate limiting
Handle sensitive data appropriately

## Common Use Cases​

### News Aggregation​

```
def aggregate_news(api_token, news_sites):    loader = BrowserlessLoader(        api_token=api_token,        urls=news_sites,        text_content=True    )    documents = loader.load()        # Process and analyze the news content    for doc in documents:        print(f"Source: {doc.metadata.get('source')}")        print(f"Content: {doc.page_content[:200]}...")
```

### Content Analysis​

```
from langchain.text_splitter import RecursiveCharacterTextSplitterdef analyze_content(api_token, url):    # Load content    loader = BrowserlessLoader(        api_token=api_token,        urls=[url],        text_content=True    )    documents = loader.load()        # Split content into chunks    text_splitter = RecursiveCharacterTextSplitter(        chunk_size=1000,        chunk_overlap=200    )    chunks = text_splitter.split_documents(documents)        # Process chunks    for chunk in chunks:        print(f"Chunk: {chunk.page_content[:100]}...")
```

For more advanced usage scenarios, please refer to:

- LangChain Documentation
- Browserless BaaS Documentation
- Integrating with other LLM providers

# n8n integration templates

Use n8n's HTTP Request node to call Browserless REST endpoints and BrowserQL. Copy a template below, paste it into your workflow, and replace the token value with your API token.

Before you copy

Store your API token in n8n Credentials and reference it in the HTTP Request node as the `token` query parameter.

## Quickstart: Take a screenshot​

1. Create a new workflowSign in to your n8n instance and create a new workflow.
2. Add a manual triggerAdd a manual trigger node to control when the workflow runs.
3. Add HTTP Request nodeAdd an HTTP Request node and configure it:
Method: POST
URL: https://production-sfo.browserless.io/screenshot?token=YOUR_TOKEN
Body: {"url": "https://example.com"}
4. Execute the workflowClick "Execute workflow" to capture a screenshot. The response will contain the image buffer.

Copy the templates below to quickly add other Browserless endpoints to your workflows.

Your browser does not support the video tag.

## Templates​

### Screenshot​

Capture a screenshot of any URL. POST `https://production-sfo.browserless.io/screenshot` with `url` in the body.

Use it to: visual monitoring, creating thumbnails, documenting web content.

Learn more about the [Screenshot API](https://docs.browserless.io/rest-apis/screenshot-api).

{
  "nodes": [
    {
      "parameters": {},
      "type": "n8n-nodes-base.manualTrigger",
      "typeVersion": 1,
      "position": [
        0,
        0
      ],
      "id": "73479c89-44a3-4f49-ba59-97f99a23f5b9",
      "name": "When clicking 'Execute workflow'"
    },
    {
      "parameters": {
        "method": "POST",
        "url": "https://production-sfo.browserless.io/screenshot",
        "sendQuery": true,
        "queryParameters": {
          "parameters": [
            {
              "name": "token",
              "value": "YOUR_API_TOKEN_HERE"
            }
          ]
        },
        "sendBody": true,
        "bodyParameters": {
          "parameters": [
            {
              "name": "url",
              "value": "https://www.example.com"
            }
          ]
        },
        "options": {}
      },
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [
        240,
        -80
      ],
      "id": "afd7858f-1db8-4251-b3f9-aaa6a1f8ad95",
      "name": "Screenshot buffer"
    },
    {
      "parameters": {
        "method": "POST",
        "url": "https://production-sfo.browserless.io/screenshot",
        "sendQuery": true,
        "queryParameters": {
          "parameters": [
            {
              "name": "token",
              "value": "YOUR_API_TOKEN_HERE"
            }
          ]
        },
        "sendBody": true,
        "specifyBody": "json",
        "jsonBody": "{\n  \"url\": \"https://www.example.com\",\n  \"options\": {\n    \"encoding\": \"base64\"\n  }\n}",
        "options": {
          "redirect": {
            "redirect": {}
          }
        }
      },
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [
        240,
        128
      ],
      "id": "d2ba4e93-62ff-49ed-874a-78c077045b9d",
      "name": "Screenshot base64"
    },
    {
      "parameters": {
        "content": "## Take a Screenshot\nYou can generate a screenshot as a **Buffer or Base64** Learn more about the [Screenshot API here.](https://docs.browserless.io/rest-apis/screenshot-api)",
        "width": 304
      },
      "type": "n8n-nodes-base.stickyNote",
      "position": [
        -368,
        0
      ],
      "typeVersion": 1,
      "id": "82d552de-4927-4c8d-8ec1-8956d939d155",
      "name": "Sticky Note"
    }
  ],
  "connections": {
    "When clicking 'Execute workflow'": {
      "main": [
        [
          {
            "node": "Screenshot buffer",
            "type": "main",
            "index": 0
          },
          {
            "node": "Screenshot base64",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Screenshot buffer": {
      "main": [
        []
      ]
    }
  },
  "pinData": {},
  "meta": {
    "templateCredsSetupCompleted": true,
    "instanceId": "72f423f1e1c447db670aa3dc4919caee6676a7384f1dac4911c50b24b11b1249"
  }
}
Copy Screenshot Template to Clipboard

### PDF​

Generate a PDF from a URL. POST `https://production-sfo.browserless.io/pdf` with `url` in the body.

Use it to: creating printable versions, archiving web pages, generating reports.

Learn more about the [PDF API](https://docs.browserless.io/rest-apis/pdf-api).

{
  "nodes": [
    {
      "parameters": {},
      "type": "n8n-nodes-base.manualTrigger",
      "typeVersion": 1,
      "position": [
        -64,
        -48
      ],
      "id": "f7231783-1ab2-4587-bdaf-5139d2dfad95",
      "name": "When clicking 'Execute workflow'"
    },
    {
      "parameters": {
        "content": "## Generate a PDF\nYou can generate a PDF Learn more about the [PDF API here.](https://docs.browserless.io/rest-apis/pdf-api)",
        "width": 304
      },
      "type": "n8n-nodes-base.stickyNote",
      "position": [
        -432,
        -48
      ],
      "typeVersion": 1,
      "id": "82cceda8-fee2-42f9-abef-a6178b8f9e69",
      "name": "Sticky Note"
    },
    {
      "parameters": {
        "method": "POST",
        "url": "https://production-sfo.browserless.io/pdf",
        "sendQuery": true,
        "queryParameters": {
          "parameters": [
            {
              "name": "token",
              "value": "YOUR_API_TOKEN_HERE"
            }
          ]
        },
        "sendBody": true,
        "bodyParameters": {
          "parameters": [
            {
              "name": "url",
              "value": "https://www.example.com"
            }
          ]
        },
        "options": {}
      },
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [
        144,
        -48
      ],
      "id": "3373552b-36c4-4061-bd38-40398211904d",
      "name": "PDF"
    }
  ],
  "connections": {
    "When clicking 'Execute workflow'": {
      "main": [
        [
          {
            "node": "PDF",
            "type": "main",
            "index": 0
          }
        ]
      ]
    }
  },
  "pinData": {},
  "meta": {
    "templateCredsSetupCompleted": true,
    "instanceId": "72f423f1e1c447db670aa3dc4919caee6676a7384f1dac4911c50b24b11b1249"
  }
}
Copy PDF Template to Clipboard

### Content​

Fetch the page HTML. POST `https://production-sfo.browserless.io/content` with `url` in the body.

Use it to: web scraping, content analysis, data extraction.

Learn more about the [Content API](https://docs.browserless.io/rest-apis/content).

{
  "nodes": [
    {
      "parameters": {},
      "type": "n8n-nodes-base.manualTrigger",
      "typeVersion": 1,
      "position": [
        432,
        -144
      ],
      "id": "dc05fa4c-e60d-4082-8a1f-158e28032c38",
      "name": "When clicking 'Execute workflow'"
    },
    {
      "parameters": {
        "content": "## Scrape content\nFetch the HTML content of a site, read more about the [Content API here.](https://docs.browserless.io/rest-apis/content)",
        "width": 304
      },
      "type": "n8n-nodes-base.stickyNote",
      "position": [
        64,
        -144
      ],
      "typeVersion": 1,
      "id": "4f000aa2-aeb9-4bb9-83f6-5a5f9b0baec4",
      "name": "Sticky Note"
    },
    {
      "parameters": {
        "method": "POST",
        "url": "https://production-sfo.browserless.io/content",
        "sendQuery": true,
        "queryParameters": {
          "parameters": [
            {
              "name": "token",
              "value": "YOUR_API_TOKEN_HERE"
            }
          ]
        },
        "sendBody": true,
        "bodyParameters": {
          "parameters": [
            {
              "name": "url",
              "value": "https://www.example.com"
            }
          ]
        },
        "options": {}
      },
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [
        640,
        -144
      ],
      "id": "a3aa914f-8f37-404d-b7c6-5f5c3493a303",
      "name": "Content"
    }
  ],
  "connections": {
    "When clicking 'Execute workflow'": {
      "main": [
        [
          {
            "node": "Content",
            "type": "main",
            "index": 0
          }
        ]
      ]
    }
  },
  "pinData": {},
  "meta": {
    "templateCredsSetupCompleted": true,
    "instanceId": "72f423f1e1c447db670aa3dc4919caee6676a7384f1dac4911c50b24b11b1249"
  }
}
Copy Content Template to Clipboard

### Unblock​

Bypass bot detection and optionally return session details (cookies, browserWSEndpoint, content, screenshot). POST `https://production-sfo.browserless.io/unblock` with `url` and flags.

Use it to: accessing protected content, handling CAPTCHAs, managing cookies and sessions.

Learn more about the [Unblock API](https://docs.browserless.io/rest-apis/unblock).

{
  "nodes": [
    {
      "parameters": {},
      "type": "n8n-nodes-base.manualTrigger",
      "typeVersion": 1,
      "position": [
        -64,
        -48
      ],
      "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "name": "When clicking 'Execute workflow'"
    },
    {
      "parameters": {
        "content": "## Unblock\nBypass common anti-bot measures, read more about the [Unblock API here.](https://docs.browserless.io/rest-apis/unblock)",
        "width": 304
      },
      "type": "n8n-nodes-base.stickyNote",
      "position": [
        -432,
        -48
      ],
      "typeVersion": 1,
      "id": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
      "name": "Sticky Note"
    },
    {
      "parameters": {
        "method": "POST",
        "url": "https://production-sfo.browserless.io/unblock",
        "sendQuery": true,
        "queryParameters": {
          "parameters": [
            {
              "name": "token",
              "value": "YOUR_API_TOKEN_HERE"
            }
          ]
        },
        "sendBody": true,
        "bodyParameters": {
          "parameters": [
            {
              "name": "url",
              "value": "https://www.example.com"
            },
            {
              "name": "cookies",
              "value": "true"
            },
            {
              "name": "browserWSEndpoint",
              "value": "true"
            },
            {
              "name": "content",
              "value": "true"
            },
            {
              "name": "screenshot",
              "value": "true"
            }
          ]
        },
        "options": {}
      },
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [
        144,
        -48
      ],
      "id": "c3d4e5f6-a789-0123-cdef-123456789012",
      "name": "Unblock"
    }
  ],
  "connections": {
    "When clicking 'Execute workflow'": {
      "main": [
        [
          {
            "node": "Unblock",
            "type": "main",
            "index": 0
          }
        ]
      ]
    }
  },
  "pinData": {},
  "meta": {
    "templateCredsSetupCompleted": true,
    "instanceId": "72f423f1e1c447db670aa3dc4919caee6676a7384f1dac4911c50b24b11b1249"
  }
}
Copy Unblock Template to Clipboard

### Scrape​

Extract structured data with CSS selectors. POST `https://production-sfo.browserless.io/scrape` with `elements` array.

Use it to: extracting specific content, structured data collection, automated data gathering.

Learn more about the [Scrape API](https://docs.browserless.io/rest-apis/scrape).

{
  "nodes": [
    {
      "parameters": {},
      "type": "n8n-nodes-base.manualTrigger",
      "typeVersion": 1,
      "position": [
        -64,
        -48
      ],
      "id": "j7k8l9m0-n1o2-3456-jklm-no7890123456",
      "name": "When clicking 'Execute workflow'"
    },
    {
      "parameters": {
        "content": "## Scrape\nExtract structured data from web pages using CSS selectors, read more about the [Scrape API here.](https://docs.browserless.io/rest-apis/scrape)",
        "width": 304
      },
      "type": "n8n-nodes-base.stickyNote",
      "position": [
        -432,
        -48
      ],
      "typeVersion": 1,
      "id": "k8l9m0n1-o2p3-4567-klmn-op8901234567",
      "name": "Sticky Note"
    },
    {
      "parameters": {
        "method": "POST",
        "url": "https://production-sfo.browserless.io/scrape",
        "sendQuery": true,
        "queryParameters": {
          "parameters": [
            {
              "name": "token",
              "value": "YOUR_API_TOKEN_HERE"
            }
          ]
        },
        "sendBody": true,
        "contentType": "raw",
        "rawContentType": "application/json",
        "body": "{\"url\": \"https://www.example.com\", \"elements\": [{\"selector\": \"h1\"}, {\"selector\": \"p\"}]}"
      },
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [
        144,
        -48
      ],
      "id": "l9m0n1o2-p3q4-5678-lmno-pq9012345678",
      "name": "Scrape"
    }
  ],
  "connections": {
    "When clicking 'Execute workflow'": {
      "main": [
        [
          {
            "node": "Scrape",
            "type": "main",
            "index": 0
          }
        ]
      ]
    }
  },
  "pinData": {},
  "meta": {
    "templateCredsSetupCompleted": true,
    "instanceId": "72f423f1e1c447db670aa3dc4919caee6676a7384f1dac4911c50b24b11b1249"
  }
}
Copy Scrape Template to Clipboard

### Browser Query Language (BQL)​

Run BrowserQL (GraphQL) to automate multi-step flows. POST `https://production-sfo.browserless.io/chrome/bql` with a GraphQL query.

Use it to: complex form filling, multi-step workflows, custom browser automation.

Learn more about [BrowserQL](https://docs.browserless.io/browserql/start).

{
  "nodes": [
    {
      "parameters": {},
      "type": "n8n-nodes-base.manualTrigger",
      "typeVersion": 1,
      "position": [
        -64,
        -48
      ],
      "id": "d1e2f3a4-b5c6-7890-defg-hi1234567890",
      "name": "When clicking 'Execute workflow'"
    },
    {
      "parameters": {
        "content": "## Browser Query Language (BQL)\nExecute complex browser automation using GraphQL, read more about [BQL here.](https://docs.browserless.io/browserql/start)",
        "width": 304
      },
      "type": "n8n-nodes-base.stickyNote",
      "position": [
        -432,
        -48
      ],
      "typeVersion": 1,
      "id": "e2f3a4b5-c6d7-8901-efgh-ij2345678901",
      "name": "Sticky Note"
    },
    {
      "parameters": {
        "method": "POST",
        "url": "https://production-sfo.browserless.io/chrome/bql",
        "sendQuery": true,
        "queryParameters": {
          "parameters": [
            {
              "name": "token",
              "value": "YOUR_API_TOKEN_HERE"
            }
          ]
        },
        "sendBody": true,
        "contentType": "raw",
        "rawContentType": "application/json",
        "body": "{\"query\": \"mutation FormExample {\\n  goto(url: \\\"https://www.browserless.io/practice-form\\\") {\\n    status\\n  }\\n select(selector:\\\"#Contact-Subject\\\",value:\\\"support\\\"){     time   } \\n typeEmail: type(text: \\\"john@email.com\\\", selector: \\\"#Email\\\") {\\n    time\\n  }\\n  typeMessage: type(\\n    selector: \\\"#Message\\\"\\n    text: \\\"Hello world!\\\"\\n  ) {\\n    time\\n  }\\n  solve(\\n    type: cloudflare\\n  ){\\n    solved\\n  }\\n waitForTimeout(time:3000){time}\\n screenshot{\\n    base64\\n  }\\n}\", \"variables\": {}, \"operationName\": \"FormExample\"}"
      },
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [
        144,
        -48
      ],
      "id": "f3a4b5c6-d7e8-9012-fghi-jk3456789012",
      "name": "BQL"
    }
  ],
  "connections": {
    "When clicking 'Execute workflow'": {
      "main": [
        [
          {
            "node": "BQL",
            "type": "main",
            "index": 0
          }
        ]
      ]
    }
  },
  "pinData": {},
  "meta": {
    "templateCredsSetupCompleted": true,
    "instanceId": "72f423f1e1c447db670aa3dc4919caee6676a7384f1dac4911c50b24b11b1249"
  }
}
Copy BQL Template to Clipboard

### Function​

Run custom JavaScript in a browser context. POST `https://production-sfo.browserless.io/function` with JS code.

Use it to: custom browser automation, complex data extraction, multi-step workflows.

Learn more about the [Function API](https://docs.browserless.io/rest-apis/function).

{
  "nodes": [
    {
      "parameters": {},
      "type": "n8n-nodes-base.manualTrigger",
      "typeVersion": 1,
      "position": [
        -64,
        -48
      ],
      "id": "g4h5i6j7-k8l9-0123-ghij-kl4567890123",
      "name": "When clicking 'Execute workflow'"
    },
    {
      "parameters": {
        "content": "## Function\nExecute custom JavaScript code in a browser context, read more about the [Function API here.](https://docs.browserless.io/rest-apis/function)",
        "width": 304
      },
      "type": "n8n-nodes-base.stickyNote",
      "position": [
        -432,
        -48
      ],
      "typeVersion": 1,
      "id": "h5i6j7k8-l9m0-1234-hijk-lm5678901234",
      "name": "Sticky Note"
    },
    {
      "parameters": {
        "method": "POST",
        "url": "https://production-sfo.browserless.io/function",
        "sendQuery": true,
        "queryParameters": {
          "parameters": [
            {
              "name": "token",
              "value": "YOUR_API_TOKEN_HERE"
            }
          ]
        },
        "sendBody": true,
        "contentType": "raw",
        "rawContentType": "application/javascript",
        "body": "export default async function ({ page }) {await page.goto(\"https://example.com/\");\n  const url = await page.content();\n  const buffer = await page.pdf({ format: \"A4\" });\n  const base64PDF = buffer.toString('base64');\n  const screenshot = await page.screenshot({ encoding: \"base64\" });\n\n  return {\n    data: {\n      url,\n      screenshot,\n      base64PDF\n    },\n    type: \"application/json\",\n  };\n}"
      },
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [
        144,
        -48
      ],
      "id": "i6j7k8l9-m0n1-2345-ijkl-mn6789012345",
      "name": "Function"
    }
  ],
  "connections": {
    "When clicking 'Execute workflow'": {
      "main": [
        [
          {
            "node": "Function",
            "type": "main",
            "index": 0
          }
        ]
      ]
    }
  },
  "pinData": {},
  "meta": {
    "templateCredsSetupCompleted": true,
    "instanceId": "72f423f1e1c447db670aa3dc4919caee6676a7384f1dac4911c50b24b11b1249"
  }
}
Copy Function Template to Clipboard

## Best practices for n8n​

**Binary vs base64**: For screenshots and PDFs, enable the "Download" option in n8n to handle binary responses, or request `encoding: "base64"` in the body to receive JSON responses.

**Timeouts and retries**: Long-running pages may exceed default timeouts. Configure timeout settings in your HTTP Request node and add retry logic for reliability.

**Security**: Store your API token in n8n Credentials or environment variables. Never hardcode tokens in plain text within your workflow templates.

**Regional endpoints**: Choose a regional endpoint close to your location for lower latency. Available regions include `production-sfo` (US West), `production-lon` (UK), and `production-ams` (Netherlands).

# Using Browserless with Make.com

Make.com (formerly Integromat) is a powerful visual automation platform that allows you to connect different services and automate tasks. This guide will show you how to use Browserless with Make.com to automate browser-based tasks.

## Getting Started​

1. Sign Up for Make.comCreate a free account on Make.com to get started with automation workflows.
2. Navigate to ScenariosOnce logged in, go to the Scenarios section where you can create and manage your automation workflows.
3. Create a New ScenarioClick on "Create a new scenario" to start building your automation workflow with Browserless.
4. Add HTTP ModuleSearch for and add the HTTP module to your scenario. This will allow you to make requests to Browserless APIs.
5. Select Make a RequestChoose the "Make a Request" action from the HTTP module options.
6. Configure BrowserlessConfigure your HTTP request with the Browserless endpoint and your API token. See the examples below for specific endpoint configurations.

For the templates below, remember to replace `YOUR_API_TOKEN_HERE` with your actual Browserless API token.

## Prerequisites​

- A Browserless account with an API token
- A Make.com account (free or paid)

## Available Endpoints​

### Screenshot​

The `/screenshot` endpoint allows you to capture screenshots of web pages. This is useful for:

- Visual monitoring of websites
- Creating thumbnails
- Documenting web content

[Learn more about the Screenshot API](https://docs.browserless.io/rest-apis/screenshot-api)

#### HTTP Module Configuration​

1. Add an HTTP module and select the Make a Request action
2. Set URL to https://production-sfo.browserless.io/screenshot?token=YOUR_API_TOKEN_HERE
3. Set Method to POST
4. Set Body type to Raw
5. Set Content type to application/json
6. Add this JSON to the Request content:

```
{  "url": "https://www.example.com"}
```

### PDF Generation​

The `/pdf` endpoint generates PDF documents from web pages. This is useful for:

- Creating printable versions of web content
- Archiving web pages
- Generating reports

[Learn more about the PDF API](https://docs.browserless.io/rest-apis/pdf-api)

#### HTTP Module Configuration​

1. Add an HTTP module and select the Make a Request action
2. Set URL to https://production-sfo.browserless.io/pdf?token=YOUR_API_TOKEN_HERE
3. Set Method to POST
4. Set Body type to Raw
5. Set Content type to application/json
6. Add this JSON to the Request content:

```
{  "url": "https://www.example.com"}
```

### Content Extraction​

The `/content` endpoint extracts the HTML content from web pages. This is useful for:

- Web scraping
- Content analysis
- Data extraction

[Learn more about the Content API](https://docs.browserless.io/rest-apis/content)

#### HTTP Module Configuration​

1. Add an HTTP module and select the Make a Request action
2. Set URL to https://production-sfo.browserless.io/content?token=YOUR_API_TOKEN_HERE
3. Set Method to POST
4. Set Body type to Raw
5. Set Content type to application/json
6. Add this JSON to the Request content:

```
{  "url": "https://www.example.com"}
```

### Unblock​

The `/unblock` endpoint helps bypass common anti-bot measures. This is useful for:

- Accessing protected content
- Handling CAPTCHAs
- Managing cookies and sessions

[Learn more about the Unblock API](https://docs.browserless.io/rest-apis/unblock)

#### HTTP Module Configuration​

1. Add an HTTP module and select the Make a Request action
2. Set URL to https://production-sfo.browserless.io/unblock?token=YOUR_API_TOKEN_HERE
3. Set Method to POST
4. Set Body type to Raw
5. Set Content type to application/json
6. Add this JSON to the Request content:

```
{  "url": "https://www.example.com",  "cookies": true,  "browserWSEndpoint": true,  "content": true,  "screenshot": true}
```

### Browser Query Language (BQL)​

The `/chrome/bql` endpoint allows you to execute complex browser automation tasks using GraphQL. This is useful for:

- Complex form filling
- Multi-step workflows
- Custom browser automation

[Learn more about BQL](https://docs.browserless.io/browserql/start)

#### HTTP Module Configuration​

1. Add an HTTP module and select the Make a Request action
2. Set URL to https://production-sfo.browserless.io/chrome/bql?token=YOUR_API_TOKEN_HERE
3. Set Method to POST
4. Set Body type to Raw
5. Set Content type to application/json
6. Add this JSON to the Request content:

```
{  "query": "mutation FormExample {\n  goto(url: \"https://www.browserless.io/practice-form\") {\n    status\n  }\n select(selector:\"#Contact-Subject\",value:\"support\"){     time   } \n typeEmail: type(text: \"john@email.com\", selector: \"#Email\") {\n    time\n  }\n  typeMessage: type(\n    selector: \"#Message\"\n    text: \"Hello world!\"\n  ) {\n    time\n  }\n  solve(\n    type: cloudflare\n  ){\n    solved\n  }\n waitForTimeout(time:3000){time}\n screenshot{\n    base64\n  }\n}",  "variables": {},  "operationName": "FormExample"}
```

### Function​

The `/function` endpoint allows you to execute custom JavaScript code in a browser context. This is useful for:

- Custom browser automation
- Complex data extraction
- Multi-step workflows

[Learn more about the Function API](https://docs.browserless.io/rest-apis/function)

#### HTTP Module Configuration​

1. Add an HTTP module and select the Make a Request action
2. Set URL to https://production-sfo.browserless.io/function?token=YOUR_API_TOKEN_HERE
3. Set Method to POST
4. Set Body type to Raw
5. Set Content type to application/javascript
6. Add this JavaScript to the Request content:

```
export default async function ({ page }) {  await page.goto("https://example.com/");  const url = await page.content();  const buffer = await page.pdf({ format: "A4" });  const base64PDF = buffer.toString('base64');  const screenshot = await page.screenshot({ encoding: "base64" });  return {    data: {      url,      screenshot,      base64PDF    },    type: "application/json",  };}
```

# Using Browserless with Zapier

Use Zapier to orchestrate Browserless through our [REST APIs](https://docs.browserless.io/rest-apis/intro). This will allow you to tigger real Chrome sessions to take screenshots, generate PDFs, fetch HTML, run BQL flows, or execute custom functions, then pass results to apps like Google Drive, Slack, or Gmail.
There are two ways to use Browserless with Zapier:

- Browserless Zapier Integration: our custom app with built‑in actions like Screenshot, PDF, Content, Stats, Scrape, and BQL. No paid Zapier account required.
- Webhooks by Zapier: call Browserless REST/BQL endpoints directly with Webhooks by Zapier which requires a paid Zapier account.

## Browserless Zapier Integration​

Connect your Browserless account and use prebuilt actions and fill in the required fields.

### Connect Browserless​

1. In Zapier, create a Zap and add the Browserless app as an action.
2. Click “Connect a new account”.
3. Enter:

Account Name: any label to recognize your account
API token: your Browserless API token from the dashboard
4. Zapier will verify the token by calling the Browserless version endpoint.

### Built-in REST APIs​

- Screenshot: capture a screenshot from a URL.
- PDF: generate a PDF from a URL.
- Content: fetch rendered HTML/content from a URL.
- Scrape: scrape data from a URL.
- Stats: retrieve account stats.
- BQL: run multi‑step BrowserQL flows.

Each action exposes “Quick Options” (URL, `waitUntil`, flags) and an “Advanced - Raw JSON” input that overrides quick options if you define the full JSON body.

## Webhooks by Zapier​

Leverage Webhooks by Zapier to run our REST APIs as you would with any HTTP Request and implement our REST APIs directly.

warning

Webhooks by Zapier requires a paid Zapier account.

For the templates below, remember to replace `YOUR_API_TOKEN_HERE` with your actual Browserless API token.

### Example workflow: Daily Visual Check​

**Trigger** — Schedule by Zapier: run every hour

**Action** — Webhooks by Zapier (POST):

- URL: https://production-sfo.browserless.io/screenshot?token=YOUR_API_TOKEN_HERE&headless=false&stealth=true&--window-size=1440,1000&--lang=en-US
- Payload (JSON):

```
{  "url": "https://www.ebay.com/sch/i.html?_nkw=nintendo+switch",  "options": {    "fullPage": true,    "type": "png",    "viewport": { "width": 1440, "height": 1000 }  }}
```

**Optional** — Gmail (Send Email): attach the file taken from browserless.

### Implementing REST APIs​

You can implement all our REST APIs using Webhooks by Zapier as documented below.
Zapier has an AI Beta "Copilot", you can copy paste the below information and it'll configure the webhook for you.

#### Screenshot​

**Use Webhooks by Zapier → POST** to `/screenshot` for visual monitoring, thumbnails, and documentation images.

**Zapier Webhook POST Configuration**

1. Add Webhooks by Zapier to your Zap
2. Choose POST as the event
3. Set URL to https://production-sfo.browserless.io/screenshot?token=YOUR_API_TOKEN_HERE
4. Set Payload Type to JSON
5. Add these data fields:

url: https://www.example.com

[Learn more about the Screenshot API](https://docs.browserless.io/rest-apis/screenshot-api)

#### PDF Generation​

**Use Webhooks by Zapier → POST** to `/pdf` for printable reports and archival documents.

**Zapier Webhook POST Configuration**

1. Add Webhooks by Zapier to your Zap
2. Choose POST as the event
3. Set URL to https://production-sfo.browserless.io/pdf?token=YOUR_API_TOKEN_HERE
4. Set Payload Type to JSON
5. Add these data fields:

url: https://www.example.com

[Learn more about the PDF API](https://docs.browserless.io/rest-apis/pdf-api)

#### Content Extraction​

**Use Webhooks by Zapier → POST** to `/content` for rendered HTML analysis and web scraping.

**Zapier Webhook POST Configuration**

1. Add Webhooks by Zapier to your Zap
2. Choose POST as the event
3. Set URL to https://production-sfo.browserless.io/content?token=YOUR_API_TOKEN_HERE
4. Set Payload Type to JSON
5. Add these data fields:

url: https://www.example.com

[Learn more about the Content API](https://docs.browserless.io/rest-apis/content)

#### Unblock​

**Use Webhooks by Zapier → POST** to `/unblock` for bypassing anti-bot measures and accessing protected content.

**Zapier Webhook POST Configuration**

1. Add Webhooks by Zapier to your Zap
2. Choose POST as the event
3. Set URL to https://production-sfo.browserless.io/unblock?token=YOUR_API_TOKEN_HERE
4. Set Payload Type to JSON
5. Add these data fields:

url: https://www.example.com
cookies: true
browserWSEndpoint: true
content: true
screenshot: true

[Learn more about the Unblock API](https://docs.browserless.io/rest-apis/unblock)

#### Browser Query Language (BQL)​

**Use Webhooks by Zapier → POST** to `/chrome/bql` for multi-step BrowserQL automation workflows.

**Zapier Webhook POST Configuration**

1. Add Webhooks by Zapier to your Zap
2. Choose POST as the event
3. Set URL to https://production-sfo.browserless.io/chrome/bql?token=YOUR_API_TOKEN_HERE
4. Set Payload Type to JSON
5. Add these data fields:

query: mutation FormExample {\n  goto(url: \"https://www.browserless.io/practice-form\") {\n    status\n  }\n select(selector:\"#Contact-Subject\",value:\"support\"){     time   } \n typeEmail: type(text: \"john@email.com\", selector: \"#Email\") {\n    time\n  }\n  typeMessage: type(\n    selector: \"#Message\"\n    text: \"Hello world!\"\n  ) {\n    time\n  }\n  solve(\n    type: cloudflare\n  ){\n    solved\n  }\n waitForTimeout(time:3000){time}\n screenshot{\n    base64\n  }\n}
variables: {}
operationName: FormExample

[Learn more about BQL](https://docs.browserless.io/browserql/start)

#### Function​

**Use Webhooks by Zapier → POST** to `/function` for custom JavaScript execution in a real browser context.

**Zapier Webhook POST Configuration**

1. Add Webhooks by Zapier to your Zap
2. Choose POST as the event
3. Set URL to https://production-sfo.browserless.io/function?token=YOUR_API_TOKEN_HERE
4. Set Payload Type to Raw
5. Set Content Type to application/javascript
6. Add this JavaScript to the Data field:

```
export default async function ({ page }) {  await page.goto("https://example.com/");  const url = await page.content();  const buffer = await page.pdf({ format: "A4" });  const base64PDF = buffer.toString('base64');  const screenshot = await page.screenshot({ encoding: "base64" });  return {    data: {      url,      screenshot,      base64PDF    },    type: "application/json",  };}
```

[Learn more about the Function API](https://docs.browserless.io/rest-apis/function)

# OpenClaw Integration

[OpenClaw](https://openclaw.ai/) is an open-source personal AI assistant that runs locally and can autonomously browse the web, fill out forms, scrape data, and interact with online services. By connecting OpenClaw to Browserless, you offload browser execution to the cloud — gaining stealth, residential proxies, CAPTCHA solving, and scalable sessions without running a local browser.

## Why use Browserless with OpenClaw?​

OpenClaw's built-in managed browser works well for local tasks, but cloud and headless deployments (servers, Docker, CI) have no display. Browserless solves this and adds a host of other features:

- Stealth and anti-bot resilience — bypass bot detection that trips up standard Chromium
- CAPTCHA and Cloudflare solving — automatically handle verification challenges
- Residential proxies — rotate IPs to avoid rate limits and geo-restrictions
- No local browser required — ideal for headless servers, Docker, and cloud VMs
- Regional endpoints — choose US West, UK, or Amsterdam for lower latency

## Prerequisites​

- OpenClaw installed and running (openclaw onboard completed)
- A Browserless API token (available in your account dashboard)

## Step 1: Get your API token​

Go to your [Browserless Account Dashboard](https://browserless.io/account/) and copy your API token. You will add it to your OpenClaw configuration in the next step.

tip

Store your token in an environment variable instead of hardcoding it in config files:

```
export BROWSERLESS_API_TOKEN="your-token-here"
```

## Step 2: Configure a Browserless browser profile​

OpenClaw uses browser profiles defined in `~/.openclaw/openclaw.json`. Add a `browserless` profile that points to a Browserless regional endpoint via its CDP URL.

Open your config file and add the following:

```
// ~/.openclaw/openclaw.json{  browser: {    enabled: true,    defaultProfile: "browserless",    remoteCdpTimeoutMs: 2000,    remoteCdpHandshakeTimeoutMs: 4000,    profiles: {      browserless: {        cdpUrl: "https://production-sfo.browserless.io?token=YOUR_API_TOKEN",        color: "#FF4500"      }    }  }}
```

Replace `YOUR_API_TOKEN` with your actual Browserless token, or use an environment variable reference if your setup supports it.

### Choose a regional endpoint​

Pick the region closest to you for lower latency:

| Region | CDP URL |
| --- | --- |
| US West | https://production-sfo.browserless.io?token=YOUR_API_TOKEN |
| Europe UK | https://production-lon.browserless.io?token=YOUR_API_TOKEN |
| Europe Amsterdam | https://production-ams.browserless.io?token=YOUR_API_TOKEN |

## Step 3: Verify the connection​

Confirm that OpenClaw can reach the Browserless endpoint:

```
openclaw browser status
```

You should see the `browserless` profile listed as reachable. If the profile shows as unreachable, double-check your API token and network connectivity.

You can also start a quick browser session and take a screenshot to validate:

```
openclaw browser startopenclaw browser screenshot
```

## Step 4: Use browser automation​

Once connected, OpenClaw's AI can use Browserless just like a local browser. Ask it to perform tasks in natural language through your preferred chat interface (WhatsApp, Discord, Slack, etc.):

- "Go to example.com and take a screenshot"
- "Fill out the contact form on browserless.io/practice-form"
- "Scrape the pricing table from that page"

OpenClaw will route all browser actions through Browserless automatically.

### Using the CLI directly​

You can also drive the browser with OpenClaw's CLI commands:

```
# Navigate to a pageopenclaw browser navigate "https://example.com"# Take a snapshot (returns element references for interaction)openclaw browser snapshot --efficient# Click an element by referenceopenclaw browser click @e1# Take a full-page screenshotopenclaw browser screenshot --full-page
```

note

Always take a new snapshot after every action — element references (`@e1`, `@e2`, etc.) become stale when the DOM changes.

## Keeping a local profile alongside Browserless​

You can define multiple profiles and switch between them. This is useful for local development (managed browser) and production (Browserless):

```
// ~/.openclaw/openclaw.json{  browser: {    enabled: true,    defaultProfile: "browserless",    profiles: {      local: {        cdpPort: 18800,        color: "#0066CC"      },      browserless: {        cdpUrl: "https://production-sfo.browserless.io?token=YOUR_API_TOKEN",        color: "#FF4500"      }    }  }}
```

Switch profiles on any command with the `?profile=<name>` parameter, or change `defaultProfile` in your config.

## Troubleshooting​

### Connection timeout​

If `openclaw browser status` shows the Browserless profile as unreachable:

1. Verify your API token is correct and active in the Browserless dashboard
2. Increase timeout values:
{  browser: {    remoteCdpTimeoutMs: 5000,    remoteCdpHandshakeTimeoutMs: 8000  }}
3. Check that outbound HTTPS traffic on port 443 is allowed by your firewall

### Playwright not installed​

Some advanced OpenClaw browser features (element snapshots, PDFs, AI snapshots) require Playwright. If you see 501 errors, install it:

```
npm install playwright
```

### Rate limit or plan errors​

If you hit rate limits, check your usage in the [Browserless dashboard](https://browserless.io/account/) and consider upgrading your plan. Browserless returns HTTP 429 when concurrency or request limits are exceeded.

## Additional resources​

- OpenClaw Documentation
- OpenClaw Browser Tool Reference
- Browserless Connection URLs
- Browserless REST APIs
- BrowserQL

# AgentKit Integration

[AgentKit](https://agentkit.inngest.com/) is a TypeScript framework by Inngest for building fault-tolerant AI agents with tools, state, and multi-agent networks. By connecting AgentKit to Browserless, your agents can browse the web with stealth capabilities, CAPTCHA solving, and residential proxies without managing browser infrastructure.

## Prerequisites​

- Node.js 18 or higher
- Browserless API token (available in your account dashboard)
- An LLM API key (Anthropic, OpenAI, etc.), required for the agent to reason and call tools

## Step-by-Step Setup​

### 1. Get your API keys​

Go to your [Browserless Account Dashboard](https://www.browserless.io/account/) and copy your API token.

Then set your environment variables:

- .env file
- Command line

```
BROWSERLESS_API_KEY=your-browserless-tokenANTHROPIC_API_KEY=your-anthropic-key
```

```
export BROWSERLESS_API_KEY=your-browserless-tokenexport ANTHROPIC_API_KEY=your-anthropic-key
```

### 2. Install dependencies​

AgentKit requires `inngest` as a peer dependency. Install both alongside Playwright and Zod:

- npm
- yarn
- pnpm

```
npm install @inngest/agent-kit inngest playwright-core zod
```

```
yarn add @inngest/agent-kit inngest playwright-core zod
```

```
pnpm add @inngest/agent-kit inngest playwright-core zod
```

### 3. Create a Browserless tool​

Create a file called `index.ts`. Start by defining a tool that connects to Browserless using Playwright's `connectOverCDP` method:

```
import { createTool } from "@inngest/agent-kit";import { z } from "zod";import { chromium } from "playwright-core";const scrapeHackerNews = createTool({  name: "scrape_hackernews",  description: "Get the top stories from Hacker News",  parameters: z.object({    limit: z.number().describe("Number of stories to fetch").default(5),  }),  handler: async ({ limit }, { step }) => {    const scrape = async () => {      const browser = await chromium.connectOverCDP(        `wss://production-sfo.browserless.io?token=${process.env.BROWSERLESS_API_KEY}`      );      try {        const page = await browser.newPage();        await page.goto("https://news.ycombinator.com");        const stories = await page.evaluate((limit) => {          const items = document.querySelectorAll(".athing");          return Array.from(items)            .slice(0, limit)            .map((item) => {              const titleEl = item.querySelector(".titleline > a");              const subtext = item.nextElementSibling;              const scoreEl = subtext?.querySelector(".score");              return {                title: titleEl?.textContent,                url: titleEl?.getAttribute("href"),                points: scoreEl?.textContent || "0 points",              };            });        }, limit);        return stories;      } finally {        await browser.close();      }    };    return await step?.run("scrape-hn", scrape) ?? await scrape();  },});
```

When running inside an Inngest function, `step.run()` ensures the operation only executes once, even if the agent retries. The `?? await scrape()` fallback lets the same tool work in standalone mode without Inngest.

### 4. Create an agent and network​

Add the agent and network definitions to the same file. Pass the tool directly to the agent's `tools` array:

```
import {  anthropic,  createAgent,  createNetwork,} from "@inngest/agent-kit";const newsAgent = createAgent({  name: "hackernews_agent",  description: "Fetches and summarizes Hacker News stories",  system: "You fetch top stories from Hacker News and provide summaries.",  tools: [scrapeHackerNews],});const network = createNetwork({  name: "news_network",  agents: [newsAgent],  maxIter: 3,  defaultModel: anthropic({    model: "claude-sonnet-4-20250514",    defaultParameters: {      max_tokens: 4096,    },  }),});
```

### 5. Run the agent​

Add the following to the same file to run the network with a prompt:

```
const result = await network.run(  "Get the top 5 stories from Hacker News and summarize them");console.log(result);
```

Run the script:

```
npx tsx ./index.ts
```

You should see the agent fetch and summarize the top Hacker News stories.

## How It Works​

1. Connection: Playwright connects to Browserless via WebSocket using connectOverCDP
2. Tool execution: The agent calls your tool, which runs browser operations through Browserless
3. Cleanup: The browser closes in a finally block to prevent session leaks

## Advanced Configuration​

### Stealth mode​

For sites with bot detection, use a [stealth route](https://docs.browserless.io/baas/bot-detection/stealth):

```
const browser = await chromium.connectOverCDP(  `wss://production-sfo.browserless.io/stealth?token=${process.env.BROWSERLESS_API_KEY}`);
```

### Residential proxies​

Route traffic through residential IPs for geo-targeting and rate-limit avoidance:

```
const browser = await chromium.connectOverCDP(  `wss://production-sfo.browserless.io?token=${process.env.BROWSERLESS_API_KEY}&proxy=residential&proxyCountry=us`);
```

### Regional endpoints​

Pick the region closest to your users or target sites:

| Region | Endpoint |
| --- | --- |
| US West (San Francisco) | wss://production-sfo.browserless.io |
| Europe (London) | wss://production-lon.browserless.io |
| Europe (Amsterdam) | wss://production-ams.browserless.io |

## Resources​

- AgentKit documentation
- Browserless connection options
- Stealth routes
- Proxy configuration

# Stagehand Integration

[Stagehand](https://github.com/browserbase/stagehand) is an open-source AI browser automation framework that lets you control web browsers using natural language and code. By connecting Stagehand to Browserless, you get reliable cloud-hosted browsers without managing Chrome infrastructure yourself, complete with stealth mode, residential proxies, and enterprise-grade reliability.

## Prerequisites​

- Node.js 18 or later
- Browserless API Token (available in your account dashboard)
- An LLM API key (Anthropic, OpenAI, etc.)

## Step-by-Step Setup​

### 1. Get your API keys​

Go to your [Browserless Account Dashboard](https://browserless.io/account/) and copy your API token.

Then set your environment variables:

- .env file
- Command line

```
BROWSERLESS_API_KEY=your-browserless-tokenANTHROPIC_API_KEY=your-anthropic-key
```

```
export BROWSERLESS_API_KEY=your-browserless-tokenexport ANTHROPIC_API_KEY=your-anthropic-key
```

### 2. Install dependencies​

- npm
- pnpm

```
npm install @browserbasehq/stagehand zod
```

```
pnpm add @browserbasehq/stagehand zod
```

### 3. Connect to Browserless​

Pass the Browserless WebSocket URL directly to Stagehand's `cdpUrl` config:

```
import { Stagehand } from "@browserbasehq/stagehand";const stagehand = new Stagehand({  env: "LOCAL",  localBrowserLaunchOptions: {    cdpUrl: `wss://production-sfo.browserless.io?token=${process.env.BROWSERLESS_API_KEY}`,  },  model: "anthropic/claude-sonnet-4-5",});await stagehand.init();
```

### 4. Use your Stagehand automation​

Use Stagehand's page methods with the Browserless-powered browser:

```
import { Stagehand } from "@browserbasehq/stagehand";import { z } from "zod";const stagehand = new Stagehand({  env: "LOCAL",  localBrowserLaunchOptions: {    cdpUrl: `wss://production-sfo.browserless.io?token=${process.env.BROWSERLESS_API_KEY}`,  },  model: "anthropic/claude-sonnet-4-5",});await stagehand.init();const page = stagehand.context.pages()[0];// Navigate to Browserlessawait page.goto("https://www.browserless.io");// act() - Click on Documentationawait stagehand.act("click on the Docs link in the navigation");// extract() - Get documentation sectionsconst docs = await stagehand.extract(  "extract the main documentation categories or sections",  z.object({    sections: z.array(z.object({      title: z.string(),      description: z.string().optional(),    })),  }));console.log("Documentation sections:", docs.sections);// Clean up when doneawait stagehand.close();
```

## Why use Browserless with Stagehand​

- Stealth mode: bypass bot detection by adding /stealth to the endpoint URL
- Residential proxies: route traffic through real residential IPs to avoid blocks
- Global regions: choose from US West (San Francisco), Europe (London), or Europe (Amsterdam) endpoints for lower latency
- No infrastructure: skip managing Chrome installations, updates, or scaling
- Parallel sessions: run multiple browser sessions simultaneously
- Enterprise reliability: 99.9% uptime SLA with automatic failover

## Resources​

- Stagehand Documentation
- Browserless Connection Options
- Stealth Mode
- Proxy Configuration
- Stagehand GitHub Repository

# Agent Browser Integration

[Agent Browser](https://github.com/vercel-labs/agent-browser) is a headless browser automation CLI for AI agents, built with a fast Rust CLI and Node.js fallback. By connecting agent-browser to Browserless, you get cloud-hosted browsers without managing Chrome infrastructure yourself, complete with stealth mode, residential proxies, and enterprise-grade reliability.

## Prerequisites​

- Node.js 18 or later
- agent-browser installed globally or as a project dependency
- Browserless API token (available in your account dashboard)

## Step-by-Step Setup​

### 1. Get your API token​

Go to your [Browserless Account Dashboard](https://browserless.io/account/) and copy your API token.

Then set your environment variable:

- .env file
- Command line

```
BROWSERLESS_API_KEY=your-api-token
```

```
export BROWSERLESS_API_KEY="your-api-token"
```

### 2. Install agent-browser​

- Global (recommended)
- npx (no install)
- Project dependency

```
npm install -g agent-browser
```

```
npx agent-browser open https://example.com
```

```
npm install agent-browser
```

### 3. Connect to Browserless​

Use the `-p browserless` flag to route all browser commands through Browserless:

```
export BROWSERLESS_API_KEY="your-api-token"agent-browser -p browserless open https://example.com
```

Or use environment variables for CI/scripts:

```
export AGENT_BROWSER_PROVIDER=browserlessexport BROWSERLESS_API_KEY="your-api-token"agent-browser open https://example.com
```

When enabled, agent-browser connects to a Browserless cloud session instead of launching a local browser. All commands work identically.

### 4. Run browser automation​

Use agent-browser's CLI commands with the Browserless-powered browser:

```
# Navigate and take a snapshotagent-browser -p browserless open https://www.browserless.ioagent-browser snapshot# Interact using refs from the snapshotagent-browser click @e2agent-browser fill @e3 "test@example.com"# Get text content and screenshotsagent-browser get text @e1agent-browser screenshot page.png# Clean upagent-browser close
```

## Optional Configuration​

Configure Browserless behavior via environment variables:

| Variable | Description | Default |
| --- | --- | --- |
| BROWSERLESS_API_URL | Base API URL (for custom regions or self-hosted) | https://production-sfo.browserless.io |
| BROWSERLESS_BROWSER_TYPE | Type of browser to use (chromium or chrome) | chromium |
| BROWSERLESS_TTL | Session TTL in milliseconds | 300000 |
| BROWSERLESS_STEALTH | Enable stealth mode (true / false) | true |

### Regional endpoints​

Pick the region closest to you for lower latency:

| Region | BROWSERLESS_API_URL value |
| --- | --- |
| US West (San Francisco) | https://production-sfo.browserless.io |
| Europe (London) | https://production-lon.browserless.io |
| Europe (Amsterdam) | https://production-ams.browserless.io |

## Usage with AI Agents​

agent-browser is designed for AI coding assistants and autonomous agents. Add it to your agent's instructions:

```
Use agent-browser to browse the web. Run agent-browser --help for all commands.Core workflow:1. agent-browser -p browserless open <url>2. agent-browser snapshot -i  (get interactive elements with refs @e1, @e2)3. agent-browser click @e1 / fill @e2 "text"  (interact using refs)4. Re-snapshot after page changes
```

For richer context in AI coding assistants (Claude Code, Cursor, Codex, etc.):

```
npx skills add vercel-labs/agent-browser
```

## Why use Browserless with agent-browser​

- Stealth mode: bypass bot detection with stealth enabled by default
- Residential proxies: route traffic through real residential IPs to avoid blocks
- Global regions: choose from US West (San Francisco), Europe (London), or Europe (Amsterdam) endpoints for lower latency
- No infrastructure: skip managing Chrome installations, updates, or scaling
- Parallel sessions: run multiple browser sessions simultaneously
- Enterprise reliability: 99.9% uptime SLA with automatic failover

## Resources​

- Agent Browser Documentation
- Agent Browser GitHub Repository
- Browserless Connection Options
- Stealth Mode
- Proxy Configuration

# Claude Code + Playwright MCP

Claude Code connects to a Browserless cloud browser over CDP using Microsoft's official [Playwright MCP](https://github.com/playwright-community/mcp) server, giving your AI agent managed infrastructure with anti-detection, residential proxies, and automatic CAPTCHA solving — no local browser required.

## Prerequisites​

- A Browserless API token (available in your account dashboard)
- Claude Code CLI installed (npm install -g @anthropic-ai/claude-code)
- Node.js 18 or later (required by the Playwright MCP server)

## Quick start​

Register the Playwright MCP server and point it at your Browserless endpoint:

```
claude mcp add playwright-browserless \  -- npx -y @playwright/mcp@latest \  --cdp-endpoint "wss://production-sfo.browserless.io/stealth?token=YOUR_API_TOKEN&solveCaptchas=true"
```

That single command does three things:

1. Registers Microsoft's official @playwright/mcp server with Claude Code
2. Routes all browser traffic through Browserless's /stealth endpoint (anti-detection enabled)
3. Turns on automatic CAPTCHA solving at the infrastructure level

Start Claude Code and verify:

```
claude
```

Then try:

```
Use playwright to navigate to https://www.google.com and take a snapshot
```

tip

Say "playwright" explicitly in your first message. Claude Code sometimes defaults to running Playwright through bash commands if you don't mention it by name.

## Connection URL anatomy​

The CDP endpoint URL controls which Browserless features are active for the session:

```
wss://production-sfo.browserless.io/stealth?token=YOUR_API_TOKEN&solveCaptchas=true
```

| Segment | Purpose |
| --- | --- |
| production-sfo.browserless.io | Regional endpoint (SFO). Also available: production-lon for EU, production-ams for Amsterdam |
| /stealth | Stealth route — hides automation signals, spoofs fingerprints, reduces bot detection |
| token= | Your Browserless API token |
| solveCaptchas=true | Automatically detects and solves CAPTCHAs in real time |

### Route options​

| Route | Use case |
| --- | --- |
| /stealth | Best for most AI agent workflows. Anti-detection enabled by default |
| / | Standard route. Use when stealth is not needed |

Cloud browser without stealth or CAPTCHA solving

If you don't need anti-detection or automatic CAPTCHA solving and just want Browserless as managed cloud browser infrastructure, use the standard route and omit `solveCaptchas`:

```
claude mcp add playwright-browserless \  -- npx -y @playwright/mcp@latest \  --cdp-endpoint "wss://production-sfo.browserless.io?token=YOUR_API_TOKEN"
```

You still get a fully managed, remote browser — just without the stealth fingerprinting and CAPTCHA solving layers.

### Useful query parameters​

| Parameter | Example | Description |
| --- | --- | --- |
| solveCaptchas | true | Auto-solve CAPTCHAs without any code changes |
| timeout | 300000 | Session timeout in ms (default 30 s, increase for long-running tasks) |
| proxy | residential | Route traffic through residential proxies for additional anti-detection |
| blockAds | true | Block ads and trackers for cleaner page loads |

Combine them as needed:

```
claude mcp add playwright-browserless \  -- npx -y @playwright/mcp@latest \  --cdp-endpoint "wss://production-sfo.browserless.io/stealth?token=YOUR_API_TOKEN&solveCaptchas=true&timeout=300000&proxy=residential"
```

## How stealth mode works​

The [/stealth](https://docs.browserless.io/baas/bot-detection/stealth) route automatically applies anti-detection techniques before your agent interacts with any page:

- Hides navigator.webdriver and other automation signals
- Spoofs browser fingerprints (canvas, WebGL, fonts)
- Randomizes user-agent strings
- Mimics human-like browser behavior patterns

No code or configuration changes needed — the stealth protections are applied at the browser level, transparently to Playwright and Claude Code.

When stealth alone isn't enough (some sites still trigger challenges), `solveCaptchas=true` provides the second layer of defense.

## How automatic CAPTCHA solving works​

With `solveCaptchas=true` in your connection URL, Browserless monitors every page for CAPTCHA challenges and solves them in the background. This happens entirely at the infrastructure layer — Playwright and Claude Code don't need to do anything.

The system:

1. Detects CAPTCHAs by monitoring network requests for known CAPTCHA service patterns (reCAPTCHA, hCaptcha, Cloudflare Turnstile, etc.)
2. Solves them programmatically using Browserless's solving engine
3. Fires CDP events (Browserless.captchaFound, Browserless.captchaAutoSolved) for monitoring

Since solving can take a few seconds to a minute, you'll want to give Claude Code guidance on how to handle this. See [System prompt for Claude Code](https://docs.browserless.io/ai-integrations/claude-code#system-prompt-for-claude-code) below.

note

Each CAPTCHA solve attempt costs 10 units. Using `/stealth` and residential proxies reduces how often CAPTCHAs appear in the first place.

## System prompt for Claude Code​

Claude Code doesn't inherently know that Browserless is handling CAPTCHAs and stealth in the background. Without guidance, it may try to interact with CAPTCHA elements directly or give up when it sees a challenge page.

Add this to your Claude Code system prompt (via `CLAUDE.md` in your project root, or passed via `--system-prompt`):

```
## Browser automation contextYou are connected to a Browserless cloud browser via Playwright MCP. The browserhas stealth anti-detection and automatic CAPTCHA solving enabled at theinfrastructure level. Important behavior guidelines:### CAPTCHA handling- **Do NOT attempt to click, solve, or interact with CAPTCHA elements yourself.**  CAPTCHAs (reCAPTCHA, hCaptcha, Cloudflare Turnstile, etc.) are solved  automatically by the browser infrastructure.- If you detect a CAPTCHA or challenge page, **wait 15-30 seconds**, then take a  new snapshot to check if the page has updated.- If the CAPTCHA is still present after 60 seconds, report it to the user rather  than attempting to interact with it.### Bot detection and blocking- The browser is already running in stealth mode with anti-detection protections.  You do not need to take any special steps to avoid detection.- If a site blocks you or shows a "bot detected" page, wait 10 seconds and retry  once. If still blocked, report it to the user.### Session management- The browser session has a timeout configured by the connection URL. For  long-running tasks, be mindful of the session duration.- Each `browser_navigate` call reuses the same browser context. Cookies and  session state persist across navigations within the same session.### Best practices- Use `browser_snapshot` (accessibility tree) as your primary observation method.  It's faster and more token-efficient than screenshots.- Use `browser_take_screenshot` only when you need to verify visual layout or  see something the accessibility tree doesn't capture.- When filling forms, use `browser_type` for text inputs and `browser_click`  for buttons and checkboxes.
```

### Why this matters​

Without this prompt, Claude Code will:

- See a CAPTCHA element in the accessibility snapshot and try to click it
- Report "I'm unable to proceed because there's a CAPTCHA" before auto-solve finishes
- Attempt its own "stealth" workarounds (modifying user-agent, etc.) that conflict with Browserless's stealth

With this prompt, Claude Code knows to wait and let the infrastructure handle it.

## Example workflows​

### Web research with anti-detection​

```
Navigate to https://www.g2.com/products/browserless/reviews and extractthe 5 most recent reviews. Get the reviewer name, rating, and summaryfor each.
```

Claude Code will navigate via the stealth Browserless browser, handle any Cloudflare challenges automatically, and extract the data from the accessibility tree.

### Form submission through CAPTCHA-protected pages​

```
Go to https://example.com/contact, fill in the form with:- Name: Test User- Email: test@example.com- Message: "I'd like to learn more about your enterprise plan"Then submit the form.
```

If the form has a reCAPTCHA, Browserless solves it transparently before (or during) form submission.

### Multi-step authenticated workflow​

```
1. Navigate to https://app.example.com/login2. Wait for me to log in manually3. Once I confirm, navigate to the settings page and take a screenshot
```

Since Browserless maintains a persistent browser context, cookies and auth state carry through the entire session.

## Configuration options​

### Per-project setup​

Scope the MCP registration to a project so teammates get the same config:

```
claude mcp add --scope project playwright-browserless \  -- npx -y @playwright/mcp@latest \  --cdp-endpoint "wss://production-sfo.browserless.io/stealth?token=YOUR_API_TOKEN&solveCaptchas=true"
```

This writes to `.mcp.json` in the project directory, which you can commit to version control (with token managed via environment variable).

### Using environment variables for the token​

Avoid committing tokens by using an environment variable:

```
export BROWSERLESS_TOKEN="your-api-token"claude mcp add playwright-browserless \  -- npx -y @playwright/mcp@latest \  --cdp-endpoint "wss://production-sfo.browserless.io/stealth?token=${BROWSERLESS_TOKEN}&solveCaptchas=true"
```

### Increasing the session timeout​

For tasks that take more than 30 seconds (the default), increase the timeout:

```
claude mcp add playwright-browserless \  -- npx -y @playwright/mcp@latest \  --cdp-endpoint "wss://production-sfo.browserless.io/stealth?token=YOUR_API_TOKEN&solveCaptchas=true&timeout=300000"
```

`timeout=300000` gives you 5 minutes. Adjust as needed for your workflow.

### Adding residential proxies​

For sites with aggressive geo-based blocking or IP reputation checks:

```
claude mcp add playwright-browserless \  -- npx -y @playwright/mcp@latest \  --cdp-endpoint "wss://production-sfo.browserless.io/stealth?token=YOUR_API_TOKEN&solveCaptchas=true&proxy=residential"
```

See [Proxy configuration](https://docs.browserless.io/baas/features/proxies) for more options including country targeting and sticky sessions.

## Troubleshooting​

### Claude Code tries to solve CAPTCHAs manually​

Add the [system prompt](https://docs.browserless.io/ai-integrations/claude-code#system-prompt-for-claude-code) above to your `CLAUDE.md`. Without it, Claude sees CAPTCHA elements in the accessibility tree and tries to interact with them.

### "Connection timeout" errors​

The Playwright MCP server defaults to a 30-second CDP connection timeout. If Browserless is slow to provision a browser:

```
claude mcp add playwright-browserless \  -- npx -y @playwright/mcp@latest \  --cdp-endpoint "wss://production-sfo.browserless.io/stealth?token=YOUR_API_TOKEN&solveCaptchas=true" \  --cdp-timeout 60000
```

### Claude Code uses bash Playwright instead of MCP​

Say "use Playwright MCP" explicitly in your first message. Claude Code defaults to writing and running Playwright scripts via bash if it doesn't know MCP is available. After the first interaction, it remembers.

### CAPTCHA solving takes too long​

Solving can take up to 60 seconds for complex challenges. If you're hitting timeouts:

1. Increase the session timeout (timeout=300000)
2. Add residential proxies (proxy=residential) to reduce CAPTCHA frequency
3. Use the /stealth route (not /) to prevent most CAPTCHAs from appearing

### Site still detects the browser as a bot​

Layer defenses:

1. Start with the /stealth route (included in the quick start)
2. Add proxy=residential for IP reputation
3. If still blocked, try the Site Unblocking API for the most aggressive anti-detection

## Available Playwright MCP tools​

Once connected, Claude Code has access to these browser automation tools:

| Tool | Description |
| --- | --- |
| browser_navigate | Navigate to a URL |
| browser_snapshot | Capture the accessibility tree (primary observation method) |
| browser_click | Click an element by reference |
| browser_type | Type text into a form field |
| browser_take_screenshot | Capture a PNG screenshot |
| browser_go_back / browser_go_forward | Browser history navigation |
| browser_wait | Wait for a specified duration |
| browser_press_key | Press a keyboard key |
| browser_select_option | Select from a dropdown |
| browser_hover | Hover over an element |
| browser_drag | Drag and drop |
| browser_resize | Resize the browser viewport |
| browser_tab_* | Tab management (new, select, close, list) |
| browser_file_upload | Upload files to file inputs |
| browser_pdf_save | Save page as PDF |

All of these tools execute against your Browserless cloud browser with stealth and CAPTCHA solving active.

## Resources​

- Stealth routes — deep dive on anti-detection techniques
- CAPTCHA solving — programmatic detection and solving via CDP
- Site unblocking — API for the most protected sites
- Session management — persistent sessions, reconnection, live URLs
- Hybrid automation — combine AI automation with human-in-the-loop
- Browserless Account Dashboard — get your API token
- AI Integrations — other AI platform integrations

# Claude Code Plugin

The Browserless plugin for [Claude Code](https://docs.anthropic.com/en/docs/claude-code) gives Claude direct access to the Browserless REST APIs: scrape webpages, take screenshots, generate PDFs, search the web, map site structures, and run custom browser automation — all from natural language.

## Prerequisites​

- An active Browserless API token (available in your account dashboard)
- Claude Code installed

## Installation​

Install the plugin in Claude Code:

Clone the repo and point Claude Code at the plugin directory:

```
git clone https://github.com/browserless/claude-plugin.gitcd claude-pluginclaude --plugin-dir .
```

## Authentication​

Run the auth skill inside Claude Code:

```
/browserless:auth
```

This prompts you for your token and preferred API region (SFO, LON, or a custom URL for private deployments), then saves the credentials to `~/.browserless/.env`.

Alternatively, set the environment variable directly:

```
# On Windows:# set BROWSERLESS_TOKEN=your-token-hereexport BROWSERLESS_TOKEN=your-token-here
```

### Auth Management​

| Command | Description |
| --- | --- |
| /browserless:auth | Interactive setup — set token and region |
| /browserless:auth status | Check if authentication is configured |
| /browserless:auth clear | Remove saved credentials |
| /browserless:auth region | Change API region without re-entering token |

Credentials are stored in `~/.browserless/.env`, but the `BROWSERLESS_TOKEN` environment variable takes precedence if set.

## API Regions​

| Region | URL |
| --- | --- |
| SFO (US West, default) | https://production-sfo.browserless.io |
| LON (Europe) | https://production-lon.browserless.io |
| AMS (Amsterdam) | https://production-ams.browserless.io |
| Custom | Any self-hosted or custom Browserless URL |

## Skills​

Once authenticated, all skills are available as slash commands:

```
/browserless:smart-scrape https://example.com/browserless:screenshot https://example.com/browserless:pdf https://example.com/browserless:search what is browserless/browserless:map https://example.com/browserless:function click the login button on https://example.com
```

| Skill | Command | Description | Example Prompt |
| --- | --- | --- | --- |
| Smart Scrape | /browserless:smart-scrape | Scrape webpages with cascading strategies (HTTP fetch, proxy, headless browser, captcha solving). Returns markdown, HTML, screenshots, PDFs, or links. | summarize the main content of https://news.ycombinator.com |
| Screenshot | /browserless:screenshot | Capture screenshots of webpages. Supports full-page, element-specific, viewport sizing, image formats (PNG/JPEG/WebP), and proxy/geo-targeting. | take a screenshot of https://inet-ip.info/ using a French proxy, wait 5 seconds before taking it |
| PDF | /browserless:pdf | Generate PDFs from webpages or HTML. Supports paper formats, margins, headers/footers, landscape, background graphics, and tagged/accessible PDFs. | save https://en.wikipedia.org/wiki/Headless_browser as a landscape A4 PDF |
| Search | /browserless:search | Search the web and optionally scrape result pages. Supports web, news, and image sources with time-based filtering and content categories. | find recent AI news en español from the last week |
| Map | /browserless:map | Discover and list all URLs on a website. Crawls sitemaps, pages, and subdomains with relevance-based search filtering. | save a list of all URLs on https://browserless.io in json format |
| Function | /browserless:function | Execute custom Puppeteer JavaScript in a cloud browser. Run arbitrary automation scripts, interact with page elements, fill forms, and return structured data. | go to https://news.ycombinator.com and return the top 10 story titles as JSON |

## API Reference​

Each skill maps to a Browserless REST API endpoint. Full API documentation is available at [docs.browserless.io/rest-apis/intro](https://docs.browserless.io/rest-apis/intro).

| Skill | Endpoint |
| --- | --- |
| Smart Scrape | POST /smart-scrape |
| Screenshot | POST /screenshot |
| PDF | POST /pdf |
| Search | POST /search |
| Map | POST /map |
| Function | POST /function |

## Further Reading​

- Browserless Account Dashboard — Get your API token
- REST APIs — Direct REST API access
- AI Integrations — Other AI platform integrations

# Anthropic Computer Use Integration

[Anthropic Computer Use](https://docs.anthropic.com/en/docs/agents-and-tools/computer-use) enables Claude to interact with browsers like a human — taking screenshots, moving the cursor, clicking elements, and typing text. By connecting Computer Use to Browserless, you get cloud-hosted browser infrastructure without managing local browsers, enabling scalable AI-powered browser automation with stealth mode, residential proxies, and enterprise-grade reliability.

## How it works​

This integration uses a **screenshot + action loop** with Playwright CDP:

1. Connect — Playwright connects to Browserless via CDP WebSocket
2. Screenshot — Capture the browser screen as an image
3. Send to Claude — Claude analyzes the screenshot using the Computer Use API
4. Execute action — Claude requests an action (click, type, scroll) and you execute it via Playwright
5. Repeat — Take a new screenshot and continue until the task is complete

Anthropic calls this the "agent loop": Claude responds with a tool use request, and your application responds with the results. You implement the loop that coordinates between Claude and the browser.

## Prerequisites​

- Node.js 18+ (for TypeScript) or Python 3.9+ (for Python)
- Browserless API token (available in your account dashboard)
- Anthropic API key (from your Anthropic Settings)

## Step-by-Step Setup​

### 1. Get your API keys​

Go to your [Browserless Account Dashboard](https://browserless.io/account/) and copy your API token.

Then set your environment variables:

- .env file
- Command line

```
BROWSERLESS_API_KEY=your-browserless-tokenANTHROPIC_API_KEY=your-anthropic-key
```

```
export BROWSERLESS_API_KEY="your-browserless-token"export ANTHROPIC_API_KEY="your-anthropic-key"
```

### 2. Install dependencies​

- TypeScript
- Python

```
npm install playwright-core @anthropic-ai/sdk dotenv typescript ts-node @types/node
```

```
pip install playwright anthropic python-dotenv
```

### 3. Create the agent​

Computer Use requires you to implement the agent loop yourself. Below is a complete working example that navigates to Hacker News and identifies the top post.

Model configuration

When using the Anthropic API directly, you must use the correct combination of **model**, **tool version**, and **beta flag**. Check the [Anthropic Models Documentation](https://docs.anthropic.com/en/docs/about-claude/models) and [Computer Use Documentation](https://docs.anthropic.com/en/docs/agents-and-tools/computer-use) for the latest values.

Current working values (as of this writing):

- Model: claude-sonnet-4-6
- Beta: computer-use-2025-11-24
- Tool type: computer_20251124

- TypeScript
- Python

```
import { chromium, Page } from "playwright-core";import Anthropic from "@anthropic-ai/sdk";import * as dotenv from "dotenv";dotenv.config();const BROWSERLESS_URL = `wss://production-sfo.browserless.io?token=${process.env.BROWSERLESS_API_KEY}`;const DISPLAY_WIDTH = 1024;const DISPLAY_HEIGHT = 768;async function captureScreenshot(page: Page): Promise<string> {  const screenshot = await page.screenshot({ type: "png" });  return screenshot.toString("base64");}async function executeComputerAction(  page: Page,  action: string,  params: Record<string, unknown>): Promise<string> {  const coordinate = params.coordinate as [number, number] | undefined;  switch (action) {    case "screenshot":      return "Screenshot captured";    case "left_click":      if (coordinate) {        await page.mouse.click(coordinate[0], coordinate[1]);        return `Clicked at (${coordinate[0]}, ${coordinate[1]})`;      }      return "Missing coordinate for left_click";    case "type":      await page.keyboard.type(params.text as string);      return `Typed: "${params.text}"`;    case "key":      await page.keyboard.press(params.text as string);      return `Pressed key: ${params.text}`;    case "scroll": {      const direction = params.scroll_direction as string;      const amount = (params.scroll_amount as number) ?? 3;      const scrollCoord = coordinate ?? [DISPLAY_WIDTH / 2, DISPLAY_HEIGHT / 2];      await page.mouse.move(scrollCoord[0], scrollCoord[1]);      const deltaX = direction === "left" ? -amount * 100 : direction === "right" ? amount * 100 : 0;      const deltaY = direction === "down" ? amount * 100 : direction === "up" ? -amount * 100 : 0;      await page.mouse.wheel(deltaX, deltaY);      return `Scrolled ${direction} by ${amount}`;    }    default:      return `Unknown action: ${action}`;  }}async function runComputerUseLoop(  client: Anthropic,  page: Page,  task: string): Promise<string> {  const initialScreenshot = await captureScreenshot(page);  const messages: Anthropic.Beta.Messages.BetaMessageParam[] = [    {      role: "user",      content: [        {          type: "image",          source: {            type: "base64",            media_type: "image/png",            data: initialScreenshot,          },        },        { type: "text", text: task },      ],    },  ];  const tools: Anthropic.Beta.Messages.BetaToolUnion[] = [    {      type: "computer_20251124",      name: "computer",      display_width_px: DISPLAY_WIDTH,      display_height_px: DISPLAY_HEIGHT,    },  ];  const MAX_ITERATIONS = 10;  for (let i = 0; i < MAX_ITERATIONS; i++) {    const response = await client.beta.messages.create({      model: "claude-sonnet-4-6",      max_tokens: 4096,      tools,      messages,      betas: ["computer-use-2025-11-24"],    });    const assistantContent: Anthropic.Beta.Messages.BetaContentBlock[] = [];    const toolResults: Anthropic.Beta.Messages.BetaToolResultBlockParam[] = [];    for (const block of response.content) {      assistantContent.push(block);      if (block.type === "tool_use") {        const input = block.input as Record<string, unknown>;        const action = input.action as string;        if (action === "screenshot") {          const screenshot = await captureScreenshot(page);          toolResults.push({            type: "tool_result",            tool_use_id: block.id,            content: [              {                type: "image",                source: {                  type: "base64",                  media_type: "image/png",                  data: screenshot,                },              },            ],          });        } else {          const result = await executeComputerAction(page, action, input);          toolResults.push({            type: "tool_result",            tool_use_id: block.id,            content: result,          });        }      }    }    messages.push({ role: "assistant", content: assistantContent });    if (toolResults.length === 0) {      return response.content        .filter(          (b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === "text"        )        .map((b) => b.text)        .join("\n");    }    messages.push({ role: "user", content: toolResults });  }  return "Max iterations reached";}async function main() {  const browser = await chromium.connectOverCDP(BROWSERLESS_URL);  const page = await browser.newPage();  await page.setViewportSize({ width: DISPLAY_WIDTH, height: DISPLAY_HEIGHT });  await page.goto("https://news.ycombinator.com", { waitUntil: "networkidle" });  const client = new Anthropic();  const result = await runComputerUseLoop(    client,    page,    "What is the title of the top post on this page? Take a screenshot first to see the page."  );  console.log("Result:", result);  await browser.close();}main();
```

```
import asyncioimport base64import osfrom dotenv import load_dotenvfrom playwright.async_api import async_playwrightimport anthropicload_dotenv()BROWSERLESS_URL = f"wss://production-sfo.browserless.io?token={os.environ['BROWSERLESS_API_KEY']}"DISPLAY_WIDTH = 1024DISPLAY_HEIGHT = 768async def capture_screenshot(page) -> str:    screenshot = await page.screenshot(type="png")    return base64.b64encode(screenshot).decode()async def execute_computer_action(page, action: str, params: dict) -> str:    if action == "screenshot":        return "Screenshot captured"    elif action == "left_click":        x, y = params["coordinate"]        await page.mouse.click(x, y)        return f"Clicked at ({x}, {y})"    elif action == "type":        await page.keyboard.type(params["text"])        return f'Typed: "{params["text"]}"'    elif action == "key":        await page.keyboard.press(params["text"])        return f'Pressed key: {params["text"]}'    elif action == "scroll":        direction = params.get("scroll_direction", "down")        amount = params.get("scroll_amount", 3)        coord = params.get("coordinate", [DISPLAY_WIDTH // 2, DISPLAY_HEIGHT // 2])        await page.mouse.move(coord[0], coord[1])        delta_x = -amount * 100 if direction == "left" else amount * 100 if direction == "right" else 0        delta_y = amount * 100 if direction == "down" else -amount * 100 if direction == "up" else 0        await page.mouse.wheel(delta_x, delta_y)        return f"Scrolled {direction} by {amount}"    return f"Unknown action: {action}"async def run_computer_use_loop(client, page, task: str) -> str:    initial_screenshot = await capture_screenshot(page)    messages = [        {            "role": "user",            "content": [                {                    "type": "image",                    "source": {                        "type": "base64",                        "media_type": "image/png",                        "data": initial_screenshot,                    },                },                {"type": "text", "text": task},            ],        }    ]    tools = [        {            "type": "computer_20251124",            "name": "computer",            "display_width_px": DISPLAY_WIDTH,            "display_height_px": DISPLAY_HEIGHT,        }    ]    max_iterations = 10    for _ in range(max_iterations):        response = await client.beta.messages.create(            model="claude-sonnet-4-6",            max_tokens=4096,            tools=tools,            messages=messages,            betas=["computer-use-2025-11-24"],        )        assistant_content = []        tool_results = []        for block in response.content:            assistant_content.append(block)            if block.type == "tool_use":                action = block.input.get("action")                if action == "screenshot":                    screenshot = await capture_screenshot(page)                    tool_results.append(                        {                            "type": "tool_result",                            "tool_use_id": block.id,                            "content": [                                {                                    "type": "image",                                    "source": {                                        "type": "base64",                                        "media_type": "image/png",                                        "data": screenshot,                                    },                                }                            ],                        }                    )                else:                    result = await execute_computer_action(page, action, block.input)                    tool_results.append(                        {                            "type": "tool_result",                            "tool_use_id": block.id,                            "content": result,                        }                    )        messages.append({"role": "assistant", "content": assistant_content})        if not tool_results:            return "\n".join(b.text for b in response.content if b.type == "text")        messages.append({"role": "user", "content": tool_results})    return "Max iterations reached"async def main():    async with async_playwright() as p:        browser = await p.chromium.connect_over_cdp(BROWSERLESS_URL)        page = await browser.new_page()        await page.set_viewport_size({"width": DISPLAY_WIDTH, "height": DISPLAY_HEIGHT})        await page.goto("https://news.ycombinator.com", wait_until="networkidle")        client = anthropic.AsyncAnthropic()        result = await run_computer_use_loop(            client,            page,            "What is the title of the top post on this page? Take a screenshot first to see the page.",        )        print("Result:", result)        await browser.close()asyncio.run(main())
```

## Available actions​

Claude can request these actions through the Computer Use tool:

| Action | Description |
| --- | --- |
| screenshot | Capture current screen state |
| left_click | Click at coordinates [x, y] |
| right_click | Right-click at coordinates |
| double_click | Double-click at coordinates |
| type | Type a text string |
| key | Press a key or combo via text param (e.g., Enter, ctrl+s) |
| mouse_move | Move cursor to coordinates |
| scroll | Scroll at coordinates with scroll_direction and scroll_amount |

## Advanced Configuration​

### Stealth mode​

For sites with bot detection, use the [stealth route](https://docs.browserless.io/baas/bot-detection/stealth):

- TypeScript
- Python

```
const browser = await chromium.connectOverCDP(  `wss://production-sfo.browserless.io/stealth?token=${process.env.BROWSERLESS_API_KEY}`);
```

```
browser = await p.chromium.connect_over_cdp(    f"wss://production-sfo.browserless.io/stealth?token={os.environ['BROWSERLESS_API_KEY']}")
```

### Residential proxies​

Route traffic through residential IPs for geo-targeting and rate-limit avoidance:

- TypeScript
- Python

```
const browser = await chromium.connectOverCDP(  `wss://production-sfo.browserless.io?token=${process.env.BROWSERLESS_API_KEY}&proxy=residential&proxyCountry=us`);
```

```
browser = await p.chromium.connect_over_cdp(    f"wss://production-sfo.browserless.io?token={os.environ['BROWSERLESS_API_KEY']}&proxy=residential&proxyCountry=us")
```

### Regional endpoints​

Pick the region closest to you for lower latency:

| Region | Endpoint |
| --- | --- |
| US West (San Francisco) | wss://production-sfo.browserless.io |
| Europe (London) | wss://production-lon.browserless.io |
| Europe (Amsterdam) | wss://production-ams.browserless.io |

## Why use Browserless with Anthropic Computer Use​

- Stealth mode: bypass bot detection by adding /stealth to the endpoint URL
- Residential proxies: route traffic through real residential IPs to avoid blocks
- Global regions: choose from US West (San Francisco), Europe (London), or Europe (Amsterdam) endpoints for lower latency
- No infrastructure: skip managing Chrome installations, updates, or scaling
- Parallel sessions: run multiple browser sessions simultaneously
- Enterprise reliability: 99.9% uptime SLA with automatic failover

## Resources​

- Anthropic Computer Use Documentation
- Anthropic Models Documentation
- Computer Use Reference Implementation
- Browserless Connection Options
- Stealth Mode
- Proxy Configuration

# OpenAI CUA Integration

[OpenAI's Computer Use Agent (CUA)](https://developers.openai.com/api/docs/guides/tools-computer-use) analyzes screenshots and returns structured actions — click, type, scroll — that Playwright executes in a Browserless cloud browser. This enables tasks like form filling, web research, and data extraction without managing browser infrastructure yourself.

## How it works​

1. Capture screenshot — take a screenshot of the current browser state
2. Send to CUA model — call the Responses API with a computer tool
3. Execute actions — parse the computer_call response and run actions via Playwright
4. Loop — repeat until the task is complete

## Prerequisites​

- Browserless API token (available in your account dashboard)
- OpenAI API key (get it from OpenAI API Keys)
- Node.js 18+ or Python 3.10+

## Step-by-Step Setup​

In this guide you'll build an example that navigates to Bing, searches for "Browserless.io", and returns a summary of what the company does. We use [stealth mode](https://docs.browserless.io/baas/bot-detection/stealth) to avoid bot detection.

### 1. Set your API keys​

Grab your Browserless token from your [account dashboard](https://browserless.io/account/) and your OpenAI key from [OpenAI API Keys](https://platform.openai.com/api-keys).

- .env file
- Command line

```
BROWSERLESS_API_KEY=your-browserless-tokenOPENAI_API_KEY=your-openai-key
```

```
export BROWSERLESS_API_KEY=your-browserless-tokenexport OPENAI_API_KEY=your-openai-key
```

### 2. Install dependencies​

- TypeScript
- Python

```
npm install openai playwright-core typescript ts-node @types/node
```

```
pip install openai playwright
```

### 3. Connect to Browserless​

Use Playwright's CDP connection with stealth mode (recommended for avoiding bot detection):

- TypeScript
- Python

```
import { chromium, Page } from "playwright-core";import OpenAI from "openai";const client = new OpenAI();const browser = await chromium.connectOverCDP(  `wss://production-sfo.browserless.io/chromium/stealth?token=${process.env.BROWSERLESS_API_KEY}`,  { timeout: 60000 });const context = await browser.newContext({ viewport: { width: 1024, height: 768 } });const page = await context.newPage();
```

```
import osimport base64from openai import OpenAIfrom playwright.async_api import async_playwrightclient = OpenAI()p = await async_playwright().start()browser = await p.chromium.connect_over_cdp(    f"wss://production-sfo.browserless.io/chromium/stealth?token={os.environ['BROWSERLESS_API_KEY']}",    timeout=60000)context = await browser.new_context(viewport={"width": 1024, "height": 768})page = await context.new_page()
```

tip

All subsequent Python snippets in this guide run inside the same `async` function. When you're done, call `await browser.close()` and `await p.stop()` to clean up.

### 4. Navigate and capture the initial screenshot​

Navigate to Bing and capture the initial screenshot to send to the model. Over remote WebSocket connections, standard Playwright screenshots can timeout, so we include a CDP fallback:

- TypeScript
- Python

```
await page.goto("https://www.bing.com", { waitUntil: "networkidle" });async function getScreenshot(page: Page): Promise<string> {  try {    const buffer = await page.screenshot({ timeout: 10000 });    return buffer.toString("base64");  } catch {    // Fallback: use CDP directly    const cdp = await page.context().newCDPSession(page);    const result = await cdp.send("Page.captureScreenshot", { format: "png" });    await cdp.detach();    return result.data;  }}const screenshotBase64 = await getScreenshot(page);
```

```
await page.goto("https://www.bing.com", wait_until="networkidle")async def get_screenshot(page) -> str:    try:        screenshot_bytes = await page.screenshot(timeout=10000)        return base64.b64encode(screenshot_bytes).decode("utf-8")    except Exception:        # Fallback: use CDP directly        cdp = await page.context.new_cdp_session(page)        result = await cdp.send("Page.captureScreenshot", {"format": "png"})        await cdp.detach()        return result["data"]screenshot_base64 = await get_screenshot(page)
```

### 5. Send the initial request to the model​

Define the task and send it along with the screenshot:

- TypeScript
- Python

```
const task = "Search for 'Browserless.io' and tell me what the company does";let response = await client.responses.create({  model: "computer-use-preview",  tools: [    {      type: "computer_use_preview",      display_width: 1024,      display_height: 768,      environment: "browser",    },  ],  input: [    {      role: "user",      content: [        { type: "input_text", text: task },        {          type: "input_image",          image_url: `data:image/png;base64,${screenshotBase64}`,        },      ],    },  ],  truncation: "auto",});
```

```
task = "Search for 'Browserless.io' and tell me what the company does"response = client.responses.create(    model="computer-use-preview",    tools=[        {            "type": "computer_use_preview",            "display_width": 1024,            "display_height": 768,            "environment": "browser",        }    ],    input=[        {            "role": "user",            "content": [                {"type": "input_text", "text": task},                {                    "type": "input_image",                    "image_url": f"data:image/png;base64,{screenshot_base64}",                },            ],        }    ],    truncation="auto",)
```

### 6. Process actions and loop​

The model returns a `computer_call` item with an action to execute. Run the action, capture a new screenshot, and send it back. Repeat until no more `computer_call` items appear (task complete).

note

The model may return key names like `CTRL` or `CMD` that Playwright doesn't recognize. The examples below map these to Playwright's expected format (e.g., `Control`, `Meta`).

- TypeScript
- Python

```
// Map model key names to Playwright key namesconst keyMap: Record<string, string> = {  enter: "Enter", return: "Enter",  ctrl: "Control", cmd: "Meta",  esc: "Escape", backspace: "Backspace",  tab: "Tab", space: "Space",  up: "ArrowUp", down: "ArrowDown",  left: "ArrowLeft", right: "ArrowRight",};while (true) {  const computerCalls = response.output.filter(    (item: { type: string }) => item.type === "computer_call"  );  if (computerCalls.length === 0) {    // Task complete — print result    console.log(response.output_text);    break;  }  const computerCall = computerCalls[0];  const action = computerCall.action;  switch (action.type) {    case "click":      await page.mouse.click(action.x, action.y);      break;    case "double_click":      await page.mouse.dblclick(action.x, action.y);      break;    case "type":      await page.keyboard.type(action.text);      break;    case "keypress": {      const mappedKeys = action.keys.map(        (key: string) => keyMap[key.toLowerCase()] || key      );      await page.keyboard.press(mappedKeys.join("+"));      break;    }    case "scroll":      await page.mouse.move(action.x, action.y);      await page.evaluate(        `window.scrollBy(${action.scroll_x}, ${action.scroll_y})`      );      break;    case "screenshot":      // Model wants a fresh screenshot — just continue      break;  }  // Capture new screenshot and send back  const newScreenshot = await getScreenshot(page);  response = await client.responses.create({    model: "computer-use-preview",    previous_response_id: response.id,    tools: [      {        type: "computer_use_preview",        display_width: 1024,        display_height: 768,        environment: "browser",      },    ],    input: [      {        type: "computer_call_output",        call_id: computerCall.call_id,        output: {          type: "input_image",          image_url: `data:image/png;base64,${newScreenshot}`,        },      },    ],    truncation: "auto",  });}
```

```
# Map model key names to Playwright key nameskey_map = {    "enter": "Enter", "return": "Enter",    "ctrl": "Control", "cmd": "Meta",    "esc": "Escape", "backspace": "Backspace",    "tab": "Tab", "space": "Space",    "up": "ArrowUp", "down": "ArrowDown",    "left": "ArrowLeft", "right": "ArrowRight",}while True:    computer_calls = [        item for item in response.output        if item.type == "computer_call"    ]    if not computer_calls:        # Task complete — print result        print(response.output_text)        break    computer_call = computer_calls[0]    action = computer_call.action    if action.type == "click":        await page.mouse.click(action.x, action.y)    elif action.type == "double_click":        await page.mouse.dblclick(action.x, action.y)    elif action.type == "type":        await page.keyboard.type(action.text)    elif action.type == "keypress":        mapped_keys = [key_map.get(key.lower(), key) for key in action.keys]        await page.keyboard.press("+".join(mapped_keys))    elif action.type == "scroll":        await page.mouse.move(action.x, action.y)        await page.evaluate(            f"window.scrollBy({action.scroll_x}, {action.scroll_y})"        )    elif action.type == "screenshot":        pass  # Model wants a fresh screenshot — just continue    # Capture new screenshot and send back    screenshot_base64 = await get_screenshot(page)    response = client.responses.create(        model="computer-use-preview",        previous_response_id=response.id,        tools=[            {                "type": "computer_use_preview",                "display_width": 1024,                "display_height": 768,                "environment": "browser",            }        ],        input=[            {                "type": "computer_call_output",                "call_id": computer_call.call_id,                "output": {                    "type": "input_image",                    "image_url": f"data:image/png;base64,{screenshot_base64}",                },            }        ],        truncation="auto",    )
```

## Supported actions​

| Action | Properties | Description |
| --- | --- | --- |
| click | x, y, button | Click at coordinates |
| double_click | x, y | Double-click at coordinates |
| type | text | Type text |
| keypress | keys[] | Press keyboard keys |
| scroll | x, y, scroll_x, scroll_y | Scroll at position |
| drag | start_x, start_y, end_x, end_y | Drag from start to end |
| wait | ms | Wait for milliseconds |
| screenshot | - | Request new screenshot |

## Advanced configuration​

### Without stealth mode​

If you don't need anti-detection and just want a managed cloud browser:

- TypeScript
- Python

```
const browser = await chromium.connectOverCDP(  `wss://production-sfo.browserless.io?token=${process.env.BROWSERLESS_API_KEY}`);
```

```
browser = await p.chromium.connect_over_cdp(    f"wss://production-sfo.browserless.io?token={os.environ['BROWSERLESS_API_KEY']}")
```

### Residential proxies​

Route traffic through real residential IPs for additional anti-detection:

- TypeScript
- Python

```
const browser = await chromium.connectOverCDP(  `wss://production-sfo.browserless.io?token=${process.env.BROWSERLESS_API_KEY}&proxy=residential&proxyCountry=us`);
```

```
browser = await p.chromium.connect_over_cdp(    f"wss://production-sfo.browserless.io?token={os.environ['BROWSERLESS_API_KEY']}&proxy=residential&proxyCountry=us")
```

### Regional endpoints​

Connect to the closest region for lower latency. See [Connection URLs](https://docs.browserless.io/overview/connection-urls) for all available endpoints.

## Troubleshooting​

### Screenshot timeout​

If the CDP fallback in Step 4 still times out, try increasing the timeout or check your network connection to Browserless. You can also increase the Playwright connection timeout:

- TypeScript
- Python

```
const browser = await chromium.connectOverCDP(url, { timeout: 120000 });
```

```
browser = await p.chromium.connect_over_cdp(url, timeout=120000)
```

### Model returns unrecognized keys​

The `keyMap` / `key_map` in Step 6 covers the most common mismatches. If you encounter new ones, add them to the map — the Playwright [keyboard API docs](https://playwright.dev/docs/api/class-keyboard) list all valid key names.

## Resources​

- OpenAI Computer Use Guide
- Browserless Connection Options
- Stealth Mode
- Proxy Configuration

# Claude Agent SDK

The [Claude Agent SDK](https://platform.claude.com/docs/en/agent-sdk/overview) lets you build autonomous AI agents powered by Claude. Unlike simple chat completions, agents execute tools autonomously, persist across multiple turns, and use MCP servers to extend capabilities. By connecting to Browserless, your agents can browse bot-protected websites with stealth mode, automatic CAPTCHA solving, and residential proxies. All without local browser infrastructure.

## Prerequisites​

- A Browserless API token (available in your account dashboard)
- An Anthropic API key
- Node.js 18 or later (TypeScript)

## Quick start​

### 1. Set your API keys​

Go to your [Browserless Account Dashboard](https://browserless.io/account/) and copy your API token. You will also need an [Anthropic API key](https://platform.claude.com/settings/keys).

Set both as environment variables:

- .env file
- Command line

```
BROWSERLESS_API_KEY=your-browserless-tokenANTHROPIC_API_KEY=your-anthropic-key
```

```
export BROWSERLESS_API_KEY=your-browserless-tokenexport ANTHROPIC_API_KEY=your-anthropic-key
```

### 2. Install dependencies​

Install the Claude Agent SDK alongside Playwright and Zod:

```
npm install @anthropic-ai/claude-agent-sdk playwright-core zod
```

### 3. Connect to Browserless​

The key change is connecting Playwright to Browserless via CDP instead of launching a local browser:

```
import { chromium } from "playwright-core";// Browserless connection with stealth + CAPTCHA solvingconst BROWSERLESS_URL = `wss://production-sfo.browserless.io/stealth?token=${process.env.BROWSERLESS_API_KEY}&solveCaptchas=true&timeout=300000`;// Connect via CDP (instead of chromium.launch())const browser = await chromium.connectOverCDP(BROWSERLESS_URL);const context = browser.contexts()[0] || await browser.newContext();const page = context.pages()[0] || await context.newPage();
```

### 4. Add system prompt guidance​

Claude doesn't know Browserless handles CAPTCHAs automatically. Add these rules to your system prompt:

```
systemPrompt: `You have access to a Browserless cloud browser via the execute_playwright MCP tool.The browser has stealth mode and automatic CAPTCHA solving enabled at the infrastructure level.IMPORTANT RULES:1. ALWAYS use execute_playwright for web interactions. Do NOT use WebFetch or other tools.2. The 'page' and 'browser' objects are ALREADY CONNECTED. Do NOT call connectOverCDP yourself.3. If you encounter a CAPTCHA or challenge page, wait 15-30 seconds and check again — it will be solved automatically.4. Return data from your code using: return yourData;5. ALWAYS use a long timeout on page.goto() to allow time for CAPTCHA solving.6. Complete ALL your work in a SINGLE execute_playwright call. Do NOT make multiple separate calls.`
```

### 5. Test it​

Run your script with a command and pass a prompt as the argument:

```
npx tsx your-agent.ts "Go to https://news.ycombinator.com and get the top 5 story titles"
```

## Connection URL anatomy​

The Browserless WebSocket URL controls which features are active for the session:

```
wss://production-sfo.browserless.io/stealth?token=YOUR_API_TOKEN&solveCaptchas=true&timeout=300000&proxy=residential&blockAds=true
```

| Segment | Purpose |
| --- | --- |
| production-sfo.browserless.io | Regional endpoint (US West). See Connection URLs for all regions |
| /stealth | Stealth route: hides automation signals, spoofs fingerprints |
| token= | Your Browserless API token |
| solveCaptchas=true | Automatically detects and solves CAPTCHAs (reCAPTCHA, Cloudflare Turnstile, DataDome, and more) |
| timeout=300000 | Session timeout in ms (5 minutes). Allows time for CAPTCHA solving |
| proxy=residential | Route through residential IPs for better IP reputation |
| blockAds=true | Block ads and trackers for cleaner page loads |

Cloud browser without stealth or CAPTCHA solving

If you don't need anti-detection or automatic CAPTCHA solving and just want Browserless as managed cloud browser infrastructure, use the standard route and omit `solveCaptchas`:

```
wss://production-sfo.browserless.io?token=YOUR_API_TOKEN
```

You still get a fully managed, remote browser, just without the stealth fingerprinting and CAPTCHA solving layers.

## How stealth mode works​

The [/stealth](https://docs.browserless.io/baas/bot-detection/stealth) route automatically applies anti-detection techniques before your agent interacts with any page:

- Hides navigator.webdriver and other automation signals
- Spoofs browser fingerprints (canvas, WebGL, fonts)
- Randomizes user-agent strings
- Mimics human-like behavior patterns

No code changes needed. The protections are applied at the browser level, transparently to Playwright and the Claude Agent SDK.

## How automatic CAPTCHA solving works​

With `solveCaptchas=true` in your connection URL, Browserless monitors every page for CAPTCHA challenges and solves them in the background:

1. Detects CAPTCHAs by monitoring network requests for known patterns (reCAPTCHA, Cloudflare Turnstile, DataDome, and more)
2. Solves them programmatically using Browserless's solving engine
3. Continues once solved. Your agent sees the unblocked page

Solving typically takes 15 to 60 seconds depending on complexity. The system prompt should instruct your agent to wait and retry if it encounters a challenge page.

note

Each CAPTCHA solve attempt costs 10 units. Using `/stealth` and residential proxies reduces how often CAPTCHAs appear in the first place.

## Example use cases​

The integration works well for tasks that would normally trigger bot detection:

Scrape bot-protected review sites:

```
"Go to https://www.g2.com/products/browserless-io/reviews and get the reviews"
```

Extract product data from e-commerce:

```
"Navigate to https://www.amazon.com/dp/B09V3KXJPB and get the product title and price"
```

Research news sites:

```
"Go to https://news.ycombinator.com and get the top 5 story titles"
```

Multi-step workflows:

```
"Search Google for 'best headless browser 2026', click the first result, and summarize the page"
```

## Troubleshooting​

### Claude tries to solve CAPTCHAs manually​

Add clear instructions to your system prompt that CAPTCHAs solve automatically and to wait 15 to 30 seconds. See [step 4](https://docs.browserless.io/ai-integrations/claude-agent-sdk#4-add-system-prompt-guidance) above.

### Connection timeout on page.goto()​

Use a long timeout: `page.goto(url, { timeout: 120000, waitUntil: 'domcontentloaded' })`

The default 30-second timeout isn't enough when CAPTCHA solving is happening.

### "Target page, context or browser has been closed"​

This means the Browserless session expired. Solutions:

- Increase session timeout in URL: &timeout=300000 (5 minutes)
- Instruct Claude to complete all work in a single tool call
- The code automatically reconnects on the next tool call

### Site still blocks the browser​

Layer your defenses:

1. Use the /stealth route (anti-detection)
2. Add proxy=residential (IP reputation)
3. Add solveCaptchas=true (CAPTCHA challenges)

### "WebSocket connection failed"​

Check that:

- Your BROWSERLESS_API_KEY is set correctly
- You have available units in your Browserless account
- The regional endpoint is accessible from your network

## Resources​

- Claude Agent SDK documentation
- Stealth routes
- CAPTCHA solving
- Proxy configuration
- Connection URLs