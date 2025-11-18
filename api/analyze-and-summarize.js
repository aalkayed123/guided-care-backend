import { z } from "zod";
import { publicProcedure } from "../../../create-context";
import { generateText } from "@rork-ai/toolkit-sdk";

const analyzeLabReportInputSchema = z.object({
  imageBase64: z.string().describe("Base64 encoded image or PDF"),
  mimeType: z.string().describe("MIME type of the file"),
  language: z.string().optional().describe("Preferred language for response (en/ar)"),
});

type AnalysisResult = {
  patient_name?: string;
  age_gender?: string;
  study?: string;
  summary_for_patient: string;
  impression: string;
  findings: string;
  recommended_next_steps: string;
  specialty_referral?: string;
  triage_urgency: "low" | "medium" | "high" | "normal";
} | {
  error: string;
};

export const analyzeLabReportProcedure = publicProcedure
  .input(analyzeLabReportInputSchema)
  .mutation(async ({ input, ctx }) => {
    console.log("\n\n🔬 ========== LAB REPORT ANALYSIS START ==========");
    console.log("⏰ Timestamp:", new Date().toISOString());
    console.log("📊 Input received:", !!input);
    console.log("📊 Input keys:", input ? Object.keys(input) : "undefined");
    
    if (!input) {
      console.error("❌ Input is undefined!");
      return {
        error: "Invalid request: input is undefined",
        confidence: 0,
      };
    }
    
    if (!input.imageBase64) {
      console.error("❌ imageBase64 is missing!");
      return {
        error: "Invalid request: image data is missing",
        confidence: 0,
      };
    }
    
    console.log("📊 File received ✅");
    console.log("📏 File size:", (input.imageBase64.length / 1024).toFixed(2), "KB");
    console.log("📝 MIME type:", input.mimeType);
    console.log("🌍 Language:", input.language || "en");

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        console.error("⏰ TIMEOUT: Analysis exceeded 5 minutes");
        reject(new Error("Analysis timeout after 5 minutes"));
      }, 300000);
    });

    try {
      const analysisPromise = (async () => {
        console.log("\n📋 STEP 1: Preparing prompt...");
        
        let extractedText = "";
        
        if (input.mimeType.includes("pdf")) {
          console.log("📌 PDF detected — extracting text from PDF...");
          try {
            const pdfjs = await import('pdfjs-dist');
            
            const pdfData = Buffer.from(input.imageBase64, 'base64');
            const loadingTask = pdfjs.getDocument({ data: pdfData });
            const pdf = await loadingTask.promise;
            
            console.log(`📄 PDF has ${pdf.numPages} pages`);
            
            for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
              const page = await pdf.getPage(pageNum);
              const textContent = await page.getTextContent();
              const pageText = textContent.items.map((item: any) => item.str).join(' ');
              extractedText += pageText + '\n';
              console.log(`✅ Extracted text from page ${pageNum}: ${pageText.length} chars`);
            }
            
            console.log(`✅ Total extracted text: ${extractedText.length} characters`);
            console.log(`📄 First 500 characters: ${extractedText.substring(0, 500)}`);
          } catch (error) {
            console.error("❌ Failed to extract text from PDF:", error);
            console.log("⚠️ Falling back to vision-based analysis...");
            extractedText = "";
          }
        }
        
        const languageInstruction = input.language === "ar" ? "Respond in Arabic." : "Respond in English.";
        
        const basePrompt = `You are Cureon AI. Your job is to explain ANY medical report in clear, simple, non-repetitive language.

You must return ONLY the JSON fields below. No extra text. No section titles or labels inside the text content. Never repeat the same sentence in more than one field.

FIELDS:

1) "patient_name": If present in the report, extract it. If not, write "Unknown".

2) "age_gender": Extract age & gender. If missing, write "Unknown".

3) "study": Type of report (e.g., CBC, urine test, NIPT, imaging).

4) "summary_for_patient":
   - Write 2-3 sentences about the overall situation in PLAIN ENGLISH.
   - Talk about what the results mean for how the patient feels or what might happen.
   - Use ONLY everyday words. Zero medical terminology. Zero test names.
   - Example for low iron: "Your child's blood test shows a few small changes that can happen with low iron or allergies. Nothing dangerous, but it should be checked."
   - MUST be completely different from "impression".

5) "impression":
   - Explain what the medical terms mean.
   - MUST quote at least 2 actual medical terms from the report in quotes.
   - Format: • "Medical Term" means [explanation in simple words]
   - Example: • "Anemia" means the body may have fewer or smaller red blood cells than usual.
              • "Eosinophilia" means a rise in allergy-related white blood cells.
   - Add a short summary sentence at the end if helpful.
   - MUST be completely different from "summary_for_patient".

6) "findings":
   - Bullet points of specific things that are abnormal or need attention.
   - Use bullet format: • Point 1\n• Point 2\n• Point 3
   - Keep each point short (under 12 words).
   - Different from impression and summary.

7) "recommended_next_steps":
   - What should the patient do next?
   - Which type of doctor to see (if needed) and why.
   - Write as a short paragraph or 2-3 bullets.
   - No repetition from other fields.

8) "specialty_referral": One specialty only (e.g., "Pediatric Hematologist").

9) "triage_urgency": one of ["normal", "low", "medium", "high"].

CRITICAL RULES:
- Every field must have UNIQUE content. Zero overlap.
- Do NOT add section labels like "Explanation of medical terms:" or "Key findings:" inside the content.
- Do NOT reuse the same sentence or phrase across fields.
- "summary_for_patient" = layperson feelings/outcome, zero medical words.
- "impression" = medical terms explained in simple language.
- "findings" = specific abnormal values, short bullets.
- "recommended_next_steps" = actionable advice.

Return your response ONLY as valid JSON in this exact structure:

{
  "patient_name": "",
  "age_gender": "",
  "study": "",
  "summary_for_patient": "",
  "impression": "",
  "findings": "",
  "recommended_next_steps": "",
  "specialty_referral": "",
  "triage_urgency": ""
}

${languageInstruction}`;
        
        let userContentParts = [];
        
        if (extractedText.length > 50) {
          userContentParts.push({ type: "text", text: basePrompt + "\n\nExtracted text from report:\n" + extractedText.substring(0, 4000) });
        } else {
          const base64Data = input.imageBase64.includes('base64,')
            ? input.imageBase64
            : `data:${input.mimeType};base64,${input.imageBase64}`;
          userContentParts.push({ type: "text", text: basePrompt });
          userContentParts.push({ type: "image", image: base64Data });
        }
        
        const response = await generateText({
          messages: [
            {
              role: "user",
              content: userContentParts,
            },
          ],
        });

        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          return {
            error: "Could not read file. Try another report.",
            confidence: 0,
          };
        }

        const result = JSON.parse(jsonMatch[0]) as AnalysisResult;
        return result;
      })();

      return await Promise.race([analysisPromise, timeoutPromise]);

    } catch (error) {
      return {
        error: "Could not read file. Try another report.",
        confidence: 0,
      };
    }
  });
