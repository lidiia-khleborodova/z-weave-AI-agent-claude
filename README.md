# Z-Emotion Help Center Agent

```

## Setup

**1. Install dependencies**
```bash
npm install
```

**2. Create `.env` from the example**
```bash
cp .env.example .env
```

Fill in the values:

```
ZENDESK_SUBDOMAIN=help.z-emotion.com
ZENDESK_EMAIL=your-email@z-emotion.com
ZENDESK_API_TOKEN=your_zendesk_api_token
ANTHROPIC_API_KEY=your_anthropic_api_key
PORT=3000
```

**3. Add the pattern CSV**

Place the pattern CSV file at:
```
data/zls links sample.csv
```

Expected columns: `Name`, `Link`, `Gender`, `Type`

**4. Start the server**
```bash
npm run dev
```

On first start it will fetch all published Zendesk articles (this takes ~30 seconds).

## API

### `POST /chat`

Ask a question. Response streams as plain text.

**Request**
```json
{ "question": "how do I reset my password?" }
```

**Example**
```bash
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d "{\"question\": \"find me a women's jacket pattern\"}"
```

### `GET /health`

Returns server status and number of loaded articles.

```json
{ "status": "ok", "articles": 326 }
```
