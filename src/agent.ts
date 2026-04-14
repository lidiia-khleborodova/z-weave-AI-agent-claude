import Anthropic from '@anthropic-ai/sdk';
import { ParsedArticle } from './types';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

const SYSTEM_PROMPT = `You are a helpful support assistant for Z-Emotion.

To answer a user question, follow these steps in order:

1. **Check the help center articles** provided in the message. If they contain a clear answer, respond based on them only. Include the article URL when relevant.

2. **If the articles don't contain the answer**, use the web_search tool to search the Z-Emotion website (z-emotion.com). Search only once. If the search returns useful content, use it to answer.

3. **If neither source has the answer**, stop and tell the user honestly that you couldn't find the information, and suggest they contact Z-Emotion support or visit https://z-emotion.com.

Rules:
- Never make up information or answer from general knowledge.
- Only answer from content you actually retrieved.
- Do not search multiple times — one search is enough.
- Keep answers concise and helpful.`;

export async function* askAgent(
  question: string,
  relevantArticles: ParsedArticle[]
): AsyncGenerator<string> {
  const articleContext =
    relevantArticles.length > 0
      ? `Relevant help center articles:\n\n${relevantArticles
          .map((a, i) => `--- Article ${i + 1}: ${a.title} ---\nURL: ${a.url}\n\n${a.body}`)
          .join('\n\n')}\n\n---\n\n`
      : 'No relevant help center articles found.\n\n---\n\n';

  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: `${articleContext}User question: ${question}` },
  ];

  const stream = client.messages.stream({
    model: 'claude-sonnet-4-6',
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    tools: [{ type: 'web_search_20250305', name: 'web_search' } as Anthropic.WebSearchTool20250305],
    messages,
  });

  for await (const event of stream) {
    if (
      event.type === 'content_block_delta' &&
      event.delta.type === 'text_delta'
    ) {
      yield event.delta.text;
    }
  }
}
