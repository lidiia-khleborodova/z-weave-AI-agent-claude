import Anthropic from '@anthropic-ai/sdk';
import { ParsedArticle } from './types';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

const SYSTEM_PROMPT = `You are a helpful support assistant for Z-Emotion.

To answer a user question, follow these steps in order:

1. Use the help center articles provided in the message if they contain the answer.
2. If the user is asking for a tutorial or video and the article contains YouTube video URLs, include the relevant YouTube link(s) in your answer alongside the article link.
3. If the articles don't contain the answer, use the web_search tool to search z-emotion.com once.
4. If neither source has the answer, say you couldn't find the information and suggest contacting Z-Emotion support or visiting https://z-emotion.com.

Formatting rules:
- Never use emojis.
- Never use horizontal dividers (--- or ***).
- Never mention the source of your information (do not say "based on the help center articles" or similar phrases). Just answer directly.
- Never make up information or answer from general knowledge.
- Only answer from content you actually retrieved.
- Do not search more than once.
- Keep answers concise and helpful.
- Always use the exact full URL from the article (e.g. https://help.z-emotion.com/hc/en-001/articles/1234567-Article-Name). You can list multiple article URLs if needed. Never use a homepage or shortened URL like https://help.z-emotion.com or https://z-emotion.com as a substitute for a specific article link.
- If the user writes in a language other than English, find the answer using the English content, then reply in the user's language.`;

export async function translateToEnglish(text: string): Promise<string> {
  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 256,
    messages: [{
      role: 'user',
      content: `Translate this text to English. Return only the translated text, nothing else.\n\n${text}`,
    }],
  });
  const block = response.content[0];
  return block.type === 'text' ? block.text.trim() : text;
}

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
