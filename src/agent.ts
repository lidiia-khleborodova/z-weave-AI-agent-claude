import Anthropic from '@anthropic-ai/sdk';
import { searchArticles, getRelevantImages } from './search';
import { searchPatterns, formatPatternResults } from './patterns';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

const SYSTEM_PROMPT = `You are a helpful support assistant for Z-Emotion.

You have access to the following tools:
- search_articles: Search the Z-Emotion help center articles. Use this for any question about how to use Z-Emotion software (z-weave, z-maya, z-unreal), features, installation, settings, tutorials, etc.
- search_patterns: Search the Z-Emotion asset library for downloadable sewing patterns. Use this only when the user is asking to find or download a pattern file.
- web_search: Search the web. If search_articles returns no results or the results don't answer the question, always use web_search before giving up.
- web_fetch: Fetch a specific URL. Use this only if you have a specific URL to retrieve.

Guidelines:
- Always call search_articles first for any product-related question. If it returns no results or doesn't answer the question, always follow up with web_search before giving up.
- When articles are returned, prefer content from manual sections over FAQ sections.
- If the article contains YouTube video URLs and the user asked for a tutorial or video, include the relevant YouTube link(s) in your answer.
- If relevant images are provided in the search results, include them using markdown: ![alt](url). Place images after the relevant instruction step.
- Never make up information or answer from general knowledge.
- Only answer from content you actually retrieved.
- Never use emojis.
- Never use horizontal dividers (--- or ***).
- Never mention the source of your information. Just answer directly.
- Keep answers concise and helpful.
- If you cannot find the answer, say so and suggest contacting Z-Emotion support or visiting https://z-emotion.com.
- If the user writes in a language other than English, search in English, then reply in the user's language.`;

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'search_articles',
    description: 'Search Z-Emotion help center articles by semantic similarity. Returns the most relevant articles for the query.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'The search query in English' },
        top_n: { type: 'number', description: 'Number of articles to return (default 5, max 10)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'search_patterns',
    description: 'Search the Z-Emotion asset library for downloadable sewing patterns (ZLS files). Use only when the user wants to find or download a pattern.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'The pattern search query' },
      },
      required: ['query'],
    },
  },
];

const BUILTIN_TOOLS = [
  { type: 'web_search_20250305', name: 'web_search', allowed_domains: ['z-emotion.com'] } as Anthropic.WebSearchTool20250305,
  { type: 'web_fetch_20250910', name: 'web_fetch', max_uses: 3 } as any,
];

async function executeTool(name: string, input: Record<string, unknown>): Promise<string> {
  if (name === 'search_articles') {
    const query = input.query as string;
    const topN = Math.min((input.top_n as number | undefined) ?? 5, 10);
    const articles = await searchArticles(query, topN);
    if (articles.length === 0) return 'No articles found.';
    const images = await getRelevantImages(query, articles);
    const imageSection = images.length > 0
      ? `\n\nRelevant images:\n${images.map((img) => `![${img.alt}](${img.src})`).join('\n')}`
      : '';
    const articleText = articles.map((a) =>
      `Title: ${a.title}\nSection: ${a.section}\nURL: ${a.url}\n\n${a.body}`
    ).join('\n\n---\n\n');
    console.log('[search_articles]', articles.map((a) => `"${a.title}" (${a.section})`).join(', '));
    return articleText + imageSection;
  }

  if (name === 'search_patterns') {
    const query = input.query as string;
    const patterns = await searchPatterns(query);
    return formatPatternResults(patterns);
  }

  return 'Unknown tool.';
}

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
  history: Anthropic.MessageParam[],
): AsyncGenerator<{ chunk?: string; assistantMessage?: Anthropic.MessageParam }> {
  const messages: Anthropic.MessageParam[] = [
    ...history,
    { role: 'user', content: question },
  ];

  while (true) {
    const stream = client.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      tools: [...TOOLS, ...BUILTIN_TOOLS],
      messages,
    });

    let fullText = '';
    const contentBlocks: Anthropic.ContentBlock[] = [];

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        fullText += event.delta.text;
        yield { chunk: event.delta.text };
      }
    }

    const response = await stream.finalMessage();

    // collect all content blocks from the response
    for (const block of response.content) {
      contentBlocks.push(block);
    }

    messages.push({ role: 'assistant', content: response.content });

    if (response.stop_reason === 'end_turn') {
      yield {
        assistantMessage: { role: 'assistant', content: fullText },
      };
      break;
    }

    if (response.stop_reason === 'tool_use') {
      const toolUseBlocks = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
      );

      const toolResults: Anthropic.ToolResultBlockParam[] = await Promise.all(
        toolUseBlocks.map(async (toolUse) => {
          const result = await executeTool(toolUse.name, toolUse.input as Record<string, unknown>);
          return {
            type: 'tool_result' as const,
            tool_use_id: toolUse.id,
            content: result,
          };
        })
      );

      messages.push({ role: 'user', content: toolResults });
      continue;
    }

    // unexpected stop reason
    break;
  }
}
