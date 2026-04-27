import Anthropic from '@anthropic-ai/sdk';
import { searchArticles, getAllArticles } from './search';
import { searchPatterns, formatPatternResults } from './patterns';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

const SYSTEM_PROMPT = `You are a helpful support assistant for Z-Emotion.

Tools: search_articles (help center), get_latest_version (release notes), search_patterns (asset library patterns), web_search (web, only if search_articles fails), web_fetch (only if user provides a URL).

Rules:
- Always call search_articles first. If it returns no results or doesn't answer, use web_search before giving up.
- Prefer manual section articles over FAQ.
- Include YouTube links if the user asked for a tutorial and the article has them.
- Include images using markdown: ![alt](url). Place after the relevant step.
- Answer only from retrieved content. Never use general knowledge.
- End every answer with a markdown link to the source article: [Title](url).
- No emojis, no dividers, no filler phrases ("Let me check" etc.), no mention of sources.
- If no answer found, suggest https://z-emotion.com or contacting support.
- If user writes in another language, search in English, reply in their language.`;

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'search_articles',
    description: 'Search Z-Emotion help center articles by semantic similarity. Returns the most relevant articles for the query.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'The search query in English' },
        top_n: { type: 'number', description: 'Number of articles to return (default 3, max 5)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_latest_version',
    description: 'Returns the latest release notes for a specific Z-Emotion app by sorting version numbers. Use when the user asks about the latest version, recent updates, or changelog.',
    input_schema: {
      type: 'object' as const,
      properties: {
        app: { type: 'string', description: 'The app name: "z-weave", "z-maya", or "z-unreal"' },
      },
      required: ['app'],
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
    const topN = Math.min((input.top_n as number | undefined) ?? 3, 5);
    const articles = await searchArticles(query, topN);
    if (articles.length === 0) return 'No articles found.';
    const allImages = articles.flatMap((a) => a.images.filter((img) => img.alt && !/^Screenshot\s[\d\-. ]+\.png$/i.test(img.alt)));
    const imageSection = allImages.length > 0
      ? `\n\nRelevant images:\n${allImages.map((img) => `![${img.alt}](${img.src})`).join('\n')}`
      : '';
    const articleText = articles.map((a) =>
      `Title: ${a.title}\nSection: ${a.section}\nURL: ${a.url}\n\n${a.body}`
    ).join('\n\n---\n\n');
    console.log('[search_articles]', articles.map((a) => `"${a.title}" (${a.section})`).join(', '));
    return articleText + imageSection;
  }

  if (name === 'get_latest_version') {
    const app = (input.app as string).toLowerCase();
    const parseVersion = (title: string): number[] => {
      const match = title.match(/^(\d+)\.(\d+)(?:\.(\d+))?/);
      return match ? [+match[1], +match[2], +(match[3] ?? 0)] : [-1, -1, -1];
    };
    const compareVersions = (a: number[], b: number[]): number => {
      for (let i = 0; i < 3; i++) if (b[i] !== a[i]) return b[i] - a[i];
      return 0;
    };
    const appArticles = getAllArticles().filter((a) => a.section.toLowerCase().includes(app));
    const versionArticles = appArticles
      .filter((a) => /^\d+\.\d+/.test(a.title))
      .sort((a, b) => compareVersions(parseVersion(a.title), parseVersion(b.title)))
      .slice(0, 3);
    if (versionArticles.length === 0) return `No release notes found for ${app}.`;
    console.log('[get_latest_version]', versionArticles.map((a) => `"${a.title}"`).join(', '));
    return versionArticles.map((a) => `Title: ${a.title}\nURL: ${a.url}\n\n${a.body}`).join('\n\n---\n\n');
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

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        fullText += event.delta.text;
        yield { chunk: event.delta.text };
      }
    }

    const response = await stream.finalMessage();
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
