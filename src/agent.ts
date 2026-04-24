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
  history: Anthropic.MessageParam[],
  relevantImages: { alt: string; src: string }[] = []
): AsyncGenerator<{ chunk?: string; assistantMessage?: Anthropic.MessageParam }> {
  const imageContext = relevantImages.length > 0
    ? `\n\nRelevant images:\n${relevantImages.map((img) => `![${img.alt}](${img.src})`).join('\n')}`
    : '';

  const userContent: Anthropic.MessageParam['content'] = [
    ...relevantArticles.map((a) => ({
      type: 'search_result' as const,
      source: a.url,
      title: `${a.title} (Section: ${a.section})`,
      content: [{ type: 'text' as const, text: a.body }],
      citations: { enabled: true },
    })),
    {
      type: 'text' as const,
      text: `${imageContext ? imageContext + '\n\n' : ''}User question: ${question}`,
    },
  ];

  const currentMessage: Anthropic.MessageParam = { role: 'user', content: userContent };
  const messages: Anthropic.MessageParam[] = [...history, currentMessage];

  const stream = client.messages.stream({
    model: 'claude-sonnet-4-6',
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    tools: [
      { type: 'web_search_20250305', name: 'web_search' } as Anthropic.WebSearchTool20250305,
      { type: 'web_fetch_20250910', name: 'web_fetch', max_uses: 3 } as any,
    ],
    messages,
  });

  let fullText = '';

  for await (const event of stream) {
    if (
      event.type === 'content_block_delta' &&
      event.delta.type === 'text_delta'
    ) {
      fullText += event.delta.text;
      yield { chunk: event.delta.text };
    }
  }

  const assistantMessage: Anthropic.MessageParam = {
    role: 'assistant',
    content: fullText,
  };

  yield { assistantMessage };
}
