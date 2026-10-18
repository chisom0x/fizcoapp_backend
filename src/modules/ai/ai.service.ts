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

export interface CacVerificationResult {
  isValid: boolean;
  confidence: number;
  extractedBusinessName?: string;
  extractedRegistrationNumber?: string;
  reason: string;
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

  /**
   * Validate CAC certificate document against user-provided business details using GPT-4o
   */
  async verifyCacDocument(params: {
    fileBuffer: Buffer;
    mimetype: string;
    filename?: string;
    businessName: string;
    registrationNumber: string;
  }): Promise<CacVerificationResult> {
    const { fileBuffer, mimetype, businessName, registrationNumber } = params;
    const cleanBusinessName = businessName.trim();
    const cleanRegNumber = registrationNumber.trim();

    if (!cleanBusinessName || !cleanRegNumber) {
      return {
        isValid: false,
        confidence: 0,
        reason: 'Both business name and registration number must be provided.',
      };
    }

    try {
      const isPdf =
        mimetype === 'application/pdf' ||
        (params.filename && params.filename.toLowerCase().endsWith('.pdf'));

      const imageBase64Urls: string[] = [];
      let extractedPdfText = '';

      if (isPdf) {
        let parser: any = null;
        try {
          const { PDFParse } = require('pdf-parse');
          parser = new PDFParse({ data: fileBuffer, verbosity: 0 });

          const textResult = await parser.getText();
          if (textResult?.text) {
            extractedPdfText = textResult.text.trim();
          }

          try {
            const screenshotResult = await parser.getScreenshot({
              imageDataUrl: true,
            });
            if (screenshotResult?.pages && Array.isArray(screenshotResult.pages)) {
              for (const page of screenshotResult.pages.slice(0, 3)) {
                if (page.dataUrl) {
                  imageBase64Urls.push(page.dataUrl);
                }
              }
            }
          } catch (canvasErr) {
            this.logger.debug(
              `PDF screenshot rendering skipped/unavailable: ${canvasErr}`,
            );
          }

          // Fallback: If screenshot rendering was unavailable, attempt to extract embedded images
          if (imageBase64Urls.length === 0) {
            try {
              const imageResult = await parser.getImage({ imageDataUrl: true });
              if (imageResult?.pages && Array.isArray(imageResult.pages)) {
                for (const page of imageResult.pages.slice(0, 3)) {
                  for (const img of (page.images || []).slice(0, 2)) {
                    if (img.dataUrl) {
                      imageBase64Urls.push(img.dataUrl);
                    }
                  }
                }
              }
            } catch (imgErr) {
              this.logger.debug(
                `PDF embedded image extraction skipped: ${imgErr}`,
              );
            }
          }
        } catch (pdfErr) {
          this.logger.error(
            `Failed to parse PDF document: ${pdfErr instanceof Error ? pdfErr.message : String(pdfErr)}`,
          );
        } finally {
          if (parser && typeof parser.destroy === 'function') {
            try {
              await parser.destroy();
            } catch (_) {}
          }
        }
      } else {
        // Image file (JPEG, PNG, WEBP, etc.)
        const effectiveMime = mimetype || 'image/jpeg';
        imageBase64Urls.push(
          `data:${effectiveMime};base64,${fileBuffer.toString('base64')}`,
        );
      }

      // If it's a PDF and has no readable text and no screenshot images
      if (isPdf && !extractedPdfText && imageBase64Urls.length === 0) {
        return {
          isValid: false,
          confidence: 0,
          reason:
            'Unable to read or parse the uploaded PDF certificate. Please ensure the file is not corrupted or password-protected.',
        };
      }

      const promptInstructions = `
You are an expert compliance auditor verifying Nigerian Corporate Affairs Commission (CAC) business certificates.
The applicant submitted the following business information:
- User Entered Business Name: "${cleanBusinessName}"
- User Entered Registration Number: "${cleanRegNumber}"

${extractedPdfText ? `Extracted Text from Certificate PDF:\n"""\n${extractedPdfText.slice(0, 4000)}\n"""\n` : ''}

CRITICAL VERIFICATION RULES:
1. Document Legitimacy:
   - Verify if this document is an authentic Nigerian CAC certificate or registration document (e.g., Certificate of Incorporation, Business Name Registration Certificate, CAC Status Report, or Form CAC 1/2).
   - If the document is NOT a CAC certificate, or is unrelated (e.g. random photo, invoice, selfie, driver's license), or is completely illegible, set "isValid": false and explain in "reason".

2. Business Name Match:
   - Extract the registered name shown on the certificate.
   - Compare it against the user-entered name: "${cleanBusinessName}".
   - Normalization: Casing, punctuation, and standard business suffixes (e.g., "Ltd" vs "Limited", "Ent" vs "Enterprises", "Nigeria" vs "Nig", "PLC", "Ventures") can be matched flexibly if they clearly represent the identical registered entity.
   - If the names refer to fundamentally different businesses or different individuals, it MUST FAIL ("isValid": false).

3. Registration Number Match:
   - Extract the RC / BN / IT number shown on the certificate.
   - Compare it against the user-entered registration number: "${cleanRegNumber}".
   - Normalization: Strip prefixes like "RC", "BN", "IT", hyphens, spaces, and leading zeros when comparing the core digits. For example, "RC-1234567" matches "1234567" or "RC1234567".
   - If the registration numbers differ, it MUST FAIL ("isValid": false).

4. Verdict:
   - If and ONLY IF both the business name and registration number match the legitimate CAC document:
     set "isValid": true, and provide a positive "reason" (e.g. "CAC certificate successfully verified. Business name and registration number match.").
   - If either the business name or registration number does NOT match, or if the document is invalid:
     set "isValid": false, and provide a clear, user-friendly "reason" stating specifically what failed (e.g. "The registration number on the certificate (RC 892314) does not match the entered number (${cleanRegNumber})", "The business name on the document ('XYZ Logistics') does not match the entered name ('${cleanBusinessName}')", "The uploaded file is not a valid CAC certificate").

Return ONLY a valid JSON object (no markdown, no backticks, no code fence):
{
  "isValid": boolean,
  "confidence": number between 0 and 1,
  "extractedBusinessName": string or null,
  "extractedRegistrationNumber": string or null,
  "reason": "Clear concise reason explaining success or why verification failed"
}
`;

      const userContent: Array<
        | { type: 'text'; text: string }
        | { type: 'image_url'; image_url: { url: string; detail?: string } }
      > = [{ type: 'text', text: promptInstructions }];

      for (const imgUrl of imageBase64Urls) {
        userContent.push({
          type: 'image_url',
          image_url: {
            url: imgUrl,
            detail: 'high',
          },
        });
      }

      const response = await axios.post(
        this.apiUrl,
        {
          model: 'gpt-4o',
          messages: [
            {
              role: 'system',
              content:
                'You are an authoritative Nigerian CAC (Corporate Affairs Commission) document verification auditor. Output strict JSON only.',
            },
            {
              role: 'user',
              content: userContent,
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
          timeout: 45000,
        },
      );

      const content = response.data?.choices?.[0]?.message?.content;
      if (content) {
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        const cleanJson = (jsonMatch ? jsonMatch[0] : content)
          .replace(/```json/gi, '')
          .replace(/```/g, '')
          .trim();
        const parsed = JSON.parse(cleanJson);

        return {
          isValid: Boolean(parsed.isValid),
          confidence:
            typeof parsed.confidence === 'number'
              ? parsed.confidence
              : parsed.isValid
                ? 0.95
                : 0.2,
          extractedBusinessName: parsed.extractedBusinessName || undefined,
          extractedRegistrationNumber:
            parsed.extractedRegistrationNumber || undefined,
          reason:
            parsed.reason ||
            (parsed.isValid
              ? 'Business verified successfully.'
              : 'CAC details do not match.'),
        };
      }
    } catch (error) {
      this.logger.error(
        `AI CAC verification failed: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      return {
        isValid: false,
        confidence: 0,
        reason:
          'Verification service encountered an issue analyzing the document. Please try again with a clearer image or PDF.',
      };
    }

    return {
      isValid: false,
      confidence: 0,
      reason: 'Could not extract valid verification data from the document.',
    };
  }
}
