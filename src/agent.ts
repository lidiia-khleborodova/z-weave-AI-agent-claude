import Anthropic from '@anthropic-ai/sdk';
import { ParsedArticle } from './types';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

const SYSTEM_PROMPT = `You are a helpful support assistant for Z-Emotion.

To answer a user question, follow these steps in order:

1. Use the help center articles provided in the message if they contain the answer. Each article has a Section label. If multiple articles cover the same topic, always prefer articles from manual sections over FAQ sections. Ignore FAQ articles that just say "check the manual".
2. If the user is asking for a tutorial or video and the article contains YouTube video URLs, include the relevant YouTube link(s) in your answer alongside the article link.
3. If relevant images are provided, always include them in your answer using markdown syntax: ![alt](url). Place them after the relevant instruction step, not at the end.
4. If the articles don't contain the answer, use the web_search tool to search z-emotion.com once.
5. If neither source has the answer, say you couldn't find the information and suggest contacting Z-Emotion support or visiting https://z-emotion.com.

Formatting rules:
- Never use emojis.
- Never use horizontal dividers (--- or ***).
- Never mention the source of your information (do not say "based on the help center articles" or similar phrases). Just answer directly.
- Never make up information or answer from general knowledge.
- Only answer from content you actually retrieved.
- Do not search more than once.
- Keep answers concise and helpful.
- Always use the exact full article URL from the URL field (e.g. https://help.z-emotion.com/hc/en-001/articles/1234567-Article-Name). Never link to a category or section page. Never construct or guess a URL — only use URLs explicitly provided in the article context.
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
  relevantArticles: ParsedArticle[],
  relevantImages: { alt: string; src: string }[] = []
): AsyncGenerator<string> {
  const articleContext =
    relevantArticles.length > 0
      ? `Relevant help center articles:\n\n${relevantArticles
          .map((a, i) => `--- Article ${i + 1}: ${a.title} (Section: ${a.section}) ---\nURL: ${a.url}\n\n${a.body}`)
          .join('\n\n')}\n\n---\n\n`
      : 'No relevant help center articles found.\n\n---\n\n';

  const imageContext = relevantImages.length > 0
    ? `Relevant images:\n${relevantImages.map((img) => `![${img.alt}](${img.src})`).join('\n')}\n\n`
    : '';

  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: `${articleContext}${imageContext}User question: ${question}` },
  ];

  const stream = client.messages.stream({
    model: 'claude-sonnet-4-6', /*claude-haiku-4-5-20251001  claude-sonnet-4-6*/
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
