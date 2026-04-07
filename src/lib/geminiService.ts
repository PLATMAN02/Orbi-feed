import { GoogleGenAI, Type, Schema } from '@google/genai';
import { GeneratedToolData } from '../types';

export const generateToolSummary = async (url: string, context: string, providedApiKey?: string): Promise<GeneratedToolData | null> => {
  const apiKey = providedApiKey || import.meta.env.VITE_GEMINI_API_KEY;
  if (!apiKey) {
    console.warn('No Gemini API configured');
    return null;
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    
    const responseSchema: Schema = {
      type: Type.OBJECT,
      properties: {
        name: { type: Type.STRING, description: 'The name of the tool or project.' },
        summary: { type: Type.STRING, description: 'A concise 1-line summary of what it is.' },
        whyItMatters: { type: Type.STRING, description: 'A concise 1-line reason why it matters or its primary value.' },
        category: { type: Type.STRING, description: 'A single word category (e.g., AI, Developer, Productivity).' },
        tags: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'Array of 2-5 relevant tags.' },
      },
      required: ['name', 'summary', 'whyItMatters', 'category', 'tags']
    };

    const prompt = `Analyze this URL and an optional user context.
URL: ${url}
Context: ${context || 'None'}

Extract and summarize the tool as a structured JSON object. Focus on the product/tool itself. 
Rules:
- Keep it concise, factual, and strictly no hype.
- If it's not a tool/launch (e.g., opinion, funding), still try to extract what the tool is conceptually if mentioned, otherwise abstract the topic.
- Reply ONLY with a valid JSON matching the schema.`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: responseSchema,
        temperature: 0.2, // Low temperature for more factual extraction
      }
    });

    if (!response.text) return null;
    
    const data: GeneratedToolData = JSON.parse(response.text);
    return data;
  } catch (err) {
    console.error('Gemini generation error:', err);
    return null;
  }
};
