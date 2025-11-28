const AIProvider = require('./base');
const { Client } = require("@gradio/client");

class HuggingFaceProvider extends AIProvider {
    constructor(config) {
        super(config);
        // This is the public space we are "borrowing"
        this.spaceId = "yisol/IDM-VTON"; 
    }

    async generateTryOn(userImage, productImage) {
        try {
            console.log("⏳ Connecting to Hugging Face Space: " + this.spaceId);
            
            // 1. Connect to the public space
            const client = await Client.connect(this.spaceId);

            // 2. Helper to convert Base64 strings to Buffers (Required for Node.js)
            const base64ToBuffer = (base64Str) => {
                // Strip the header if present (e.g., "data:image/png;base64,...")
                const base64Data = base64Str.replace(/^data:image\/\w+;base64,/, "");
                return Buffer.from(base64Data, 'base64');
            };

            // RUTHLESS FIX: Handle input objects correctly (server.js passes objects, not strings)
            const userBuffer = base64ToBuffer(userImage.data);
            const productBuffer = base64ToBuffer(productImage.data);

            console.log("🚀 Sending request to IDM-VTON (This usually takes 45-80 seconds)...");

            // 3. Send the request to the API
            // These parameters mimic the inputs on the public demo page
            const result = await client.predict("/tryon", [
                {
                    "background": userBuffer,
                    "layers": [],
                    "composite": null
                },              // Input 0: User Image (Background)
                productBuffer,  // Input 1: Garment Image
                "clothing",     // Input 2: Description text
                true,           // Input 3: Auto-masking enabled
                true,           // Input 4: Auto-crop enabled
                30,             // Input 5: Denoising steps (30 is standard)
                42              // Input 6: Random seed
            ]);

            // 4. Extract the result
            // The API returns an array. The result image is usually at index 0.
            const output = result.data[0];
            
            // Check if output is a URL object or string
            const imageUrl = output?.url || output;

            if (!imageUrl) {
                throw new Error("Hugging Face returned success but no image URL found.");
            }

            console.log("✅ Image generated successfully:", imageUrl);

            // Return in a format server.js expects (similar to Gemini structure for compatibility if needed, 
            // but server.js just returns the result directly. We'll return a simple object.)
            // Note: The frontend expects a Gemini-like structure if we don't change frontend code.
            // But for now, let's return a standard object and we might need to adjust frontend or server.js to handle it.
            // Actually, server.js just does `res.json(result)`. 
            // Gemini returns `candidates[0].content.parts[0].inline_data`.
            // We should probably mimic that structure OR update the frontend to handle different responses.
            // For "Ruthless" simplicity, let's mimic Gemini structure so Frontend doesn't break.
            
            // Fetch the image to convert to base64 (Frontend expects base64 usually?)
            // Actually, Gemini returns base64. HuggingFace returns a URL.
            // If we return a URL, the frontend might break if it expects base64.
            // Let's fetch the URL and convert to base64 to be 100% compatible.
            
            const imgRes = await fetch(imageUrl);
            const imgBuff = await imgRes.arrayBuffer();
            const imgBase64 = Buffer.from(imgBuff).toString('base64');

            return {
                candidates: [{
                    content: {
                        parts: [{
                            inline_data: {
                                mime_type: "image/png",
                                data: imgBase64
                            }
                        }]
                    },
                    finishReason: "STOP"
                }]
            };

        } catch (error) {
            console.error("❌ HuggingFace Provider Error:", error);
            
            // Helpful error for Render Free Tier users
            if (error.message && (error.message.includes("timeout") || error.message.includes("504"))) {
                throw new Error("Timeout: The public AI server is too busy. Please try again in 1 minute.");
            }
            
            throw new Error(`HF Error: ${error.message}`);
        }
    }

    async validate() {
        try {
            // Simple connection test
            await Client.connect(this.spaceId);
            return { valid: true, models: ["IDM-VTON (Public Space)"] };
        } catch (e) {
            return { valid: false, error: e.message };
        }
    }
}

module.exports = HuggingFaceProvider;