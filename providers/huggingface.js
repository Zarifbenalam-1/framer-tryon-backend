// server/providers/huggingface.js
const AIProvider = require('./base');
const { Client } = require("@gradio/client");

class HuggingFaceProvider extends AIProvider {
    constructor(config) {
        super(config);
        this.spaceId = "yisol/IDM-VTON"; 
    }

    async generateTryOn(userImage, productImage) {
        try {
            console.log("⏳ Connecting to Hugging Face Space: " + this.spaceId);
            
            // AUTHENTICATION: Use Token to increase quota limits
            // Priority: Runtime Config > Env Var
            const token = this.config.hfToken || process.env.HF_TOKEN;
            const options = {};
            
            if (token && token.trim().length > 0) {
                options.hf_token = token.trim();
                // RUTHLESS FIX: Explicitly set Authorization header to ensure ZeroGPU sees the token
                options.headers = { "Authorization": `Bearer ${token.trim()}` };
                console.log(`🔑 Using HF_TOKEN for authentication (Token starts with: ${token.substring(0, 4)}...)`);
            } else {
                console.log("⚠️ No HF_TOKEN found (or empty). Using Free Tier (Rate limits may apply).");
                console.log(`Debug: config.hfToken=${this.config.hfToken ? 'SET' : 'NULL'}, env.HF_TOKEN=${process.env.HF_TOKEN ? 'SET' : 'NULL'}`);
            }
            
            const client = await Client.connect(this.spaceId, options);

            const base64ToBuffer = (base64Str) => {
                const base64Data = base64Str.replace(/^data:image\/\w+;base64,/, "");
                return Buffer.from(base64Data, 'base64');
            };

            const userBuffer = base64ToBuffer(userImage.data);
            const productBuffer = base64ToBuffer(productImage.data);

            console.log("🚀 Sending request to IDM-VTON...");

            const result = await client.predict("/tryon", [
                { "background": userBuffer, "layers": [], "composite": null },
                productBuffer,
                "clothing",     // Input 2: Description text
                true,
                true,
                30,
                42
            ]);

            const output = result.data[0];
            const imageUrl = output?.url || output;

            if (!imageUrl) {
                throw new Error("Hugging Face returned success but no image URL found.");
            }

            console.log("✅ Image generated URL:", imageUrl);
            
            const imgRes = await fetch(imageUrl);
            if (!imgRes.ok) throw new Error("Failed to download generated image from HF");
            
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
            if (error.message && (error.message.includes("timeout") || error.message.includes("504"))) {
                throw new Error("Timeout: The public AI server is too busy. Please try again in 1 minute.");
            }
            throw new Error(`HF Error: ${error.message}`);
        }
    }

    async validate() {
        try {
            const token = this.config.hfToken || process.env.HF_TOKEN;
            const options = token ? { hf_token: token } : {};
            
            await Client.connect(this.spaceId, options);
            return { valid: true, models: ["IDM-VTON (Public Space)"] };
        } catch (e) {
            return { valid: false, error: e.message };
        }
    }
}

module.exports = HuggingFaceProvider;
