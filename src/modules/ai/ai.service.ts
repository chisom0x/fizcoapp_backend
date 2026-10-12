import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

export interface ParsedGadgetResult {
  title: string;
  description: string;
  brand: string;
  model: string;
  storage?: string;
  condition?: string;
  color?: string;
  others?: string;
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly apiUrl: string;
  private readonly apiKey: string;

  constructor(private readonly configService: ConfigService) {
    this.apiUrl =
      this.configService.get<string>('LAOZHANG_API_URL') ||
      'https://api.laozhang.ai/v1/chat/completions';
    this.apiKey =
      this.configService.get<string>('LAOZHANG_API_KEY') || '';
  }

  /**
   * Parse natural language gadget inventory text into structured data using GPT-4o
   */
  async parseProductInput(rawInput: string): Promise<ParsedGadgetResult> {
    const trimmed = rawInput.trim();
    if (!trimmed) {
      return {
        title: 'New Gadget',
        description: 'In stock',
        brand: 'Unknown',
        model: 'Gadget',
      };
    }

    try {
      const prompt = `
You are an expert gadget inventory parser for a consumer electronics and smartphone marketplace called Fizco.
Analyze the following natural language seller input and extract gadget details:
Input: "${trimmed}"

Return ONLY a valid JSON object (with no markdown, no backticks, no code fence) with the following structure:
{
  "brand": "string (e.g. Apple, Samsung, Google, Sony, Dell, HP, etc.)",
  "model": "string (e.g. iPhone 12 Pro Max, Galaxy S23 Ultra, MacBook Pro 14 M2, etc.)",
  "title": "string (The extracted gadget title, formatted cleanly e.g. 'iPhone 12 Pro Max' or 'Samsung Galaxy S23 Ultra')",
  "description": "string (A clean, elegant summary of all the other information mentioned like storage, condition, accessories, color, battery health, e.g. '256GB, Graphite, UK Used, 88% battery health')",
  "storage": "string or null (e.g. '256GB', '512GB', '16GB RAM / 512GB SSD')",
  "condition": "string or null (e.g. 'Brand New Sealed', 'Clean UK Used', 'Open Box', 'Fair')",
  "color": "string or null (e.g. 'Pacific Blue', 'Titanium Black', 'Space Grey')",
  "others": "string or null (Any extra notes like warranty, carrier lock, battery percentage, accessories)"
}
`;

      const response = await axios.post(
        this.apiUrl,
        {
          model: 'gpt-4o',
          messages: [
            {
              role: 'system',
              content:
                'You extract gadget specifications into strict valid JSON format. Never include markdown codeblocks or conversational text.',
            },
            {
              role: 'user',
              content: prompt,
            },
          ],
          temperature: 0.1,
          response_format: { type: 'json_object' },
        },
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
          },
          timeout: 15000,
        },
      );

      const content = response.data?.choices?.[0]?.message?.content;
      if (content) {
        const cleanJson = content
          .replace(/```json/gi, '')
          .replace(/```/g, '')
          .trim();
        const parsed = JSON.parse(cleanJson);

        return {
          title: parsed.title || `${parsed.brand || ''} ${parsed.model || ''}`.trim() || trimmed,
          description: parsed.description || 'In stock',
          brand: parsed.brand || 'Unknown',
          model: parsed.model || parsed.title || trimmed,
          storage: parsed.storage || undefined,
          condition: parsed.condition || undefined,
          color: parsed.color || undefined,
          others: parsed.others || undefined,
        };
      }
    } catch (error) {
      this.logger.error(
        `AI extraction failed for input: "${trimmed}". Falling back to heuristic parser.`,
        error instanceof Error ? error.message : String(error),
      );
    }

    // Heuristic fallback
    return this.fallbackParse(trimmed);
  }

  /**
   * Fallback heuristic parser in case of network issues with the AI endpoint
   */
  private fallbackParse(text: string): ParsedGadgetResult {
    const words = text.split(/[\s,]+/);
    const title = words.slice(0, 4).join(' ');
    const desc = words.slice(4).join(' ') || 'In stock';

    let brand = 'Other';
    if (/iphone|macbook|ipad|airpods|apple/i.test(text)) brand = 'Apple';
    else if (/samsung|galaxy/i.test(text)) brand = 'Samsung';
    else if (/pixel|google/i.test(text)) brand = 'Google';
    else if (/sony|playstation/i.test(text)) brand = 'Sony';

    return {
      title,
      description: desc,
      brand,
      model: title,
      others: text,
    };
  }
}
