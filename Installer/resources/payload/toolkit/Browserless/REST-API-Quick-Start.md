# Browserless REST API Quick Start

## 1) Prerequisites
- Browserless account and API token
- Region endpoint (`production-sfo`, `production-lon`, or `production-ams`)

## 2) First Request (`/scrape`)

### cURL
```bash
curl -X POST "https://production-sfo.browserless.io/scrape?token=YOUR_API_TOKEN_HERE" \
	-H "Content-Type: application/json" \
	-d '{"url":"https://example.com","elements":[{"selector":"h1"}]}'
```

### Node.js
```js
const response = await fetch("https://production-sfo.browserless.io/scrape?token=YOUR_API_TOKEN_HERE", {
	method: "POST",
	headers: { "Content-Type": "application/json" },
	body: JSON.stringify({
		url: "https://example.com",
		elements: [{ selector: "h1" }]
	})
});

const data = await response.json();
console.log(data);
```

### Python
```python
import requests

response = requests.post(
		"https://production-sfo.browserless.io/scrape?token=YOUR_API_TOKEN_HERE",
		json={
				"url": "https://example.com",
				"elements": [{"selector": "h1"}]
		}
)

print(response.json())
```

## 3) Endpoint Selector
| API | Best Use |
| --- | --- |
| `/content` | Rendered HTML/text |
| `/scrape` | Structured data extraction |
| `/screenshot` | Page or element screenshots |
| `/pdf` | PDF generation |
| `/function` | Custom Puppeteer logic |
| `/download` | Downloaded file retrieval |
| `/export` | Native content export/packaging |
| `/unblock` | Bot/CAPTCHA bypass flow |
| `/performance` | Lighthouse audits |

## 4) Important Constraints
- REST calls are stateless and single-action.
- Session state/cookies are not persisted between requests.
- For advanced anti-bot workflows, use BrowserQL.

## 5) Docs
- REST APIs: https://docs.browserless.io/rest-apis/intro
- BrowserQL: https://docs.browserless.io/browserql/start
- Launch parameters: https://docs.browserless.io/rest-apis/launch-parameters