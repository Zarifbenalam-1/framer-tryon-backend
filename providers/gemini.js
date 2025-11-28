const AIProvider = require('./base');

class GeminiProvider extends AIProvider {
    constructor(config) {
        super(config);
        this.baseUrl = "https://generativelanguage.googleapis.com/v1beta";
    }

    async generateTryOn(userImage, productImage) {
        if (!this.config.apiKey) {
            throw new Error("Gemini API Key is missing");
        }

        const model = this.config.model || 'gemini-2.5-flash-image';
        const url = `${this.baseUrl}/models/${model}:generateContent`;

        const payload = {
            contents: [
                {
                    parts: [
                        {
                            text: "Drape the clothing from the product image onto the person in the user photo, preserving face, pose, and background. Ensure realistic fit and high quality."
                        },
                        {
                            inline_data: {
                                mime_type: userImage.mimeType, 
                                data: userImage.data 
                            }
                        },
                        {
                            inline_data: {
                                mime_type: productImage.mimeType,
                                data: productImage.data
                            }
                        }
                    ]
                }
            ]
        };

        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-goog-api-key": this.config.apiKey
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorText = await response.text();
            
            // Handle Quota Errors
            if (response.status === 429) {
                const isFreeTier = model.includes('flash') && !model.includes('exp'); // Rough heuristic
                const msg = isFreeTier 
                    ? "Quota Exceeded. This model may require billing. Try 'gemini-2.0-flash-exp' for free access."
                    : "Quota Exceeded. Please check your Google AI Studio billing.";
                
                throw new Error(`429_QUOTA: ${msg}`);
            }

            throw new Error(`Gemini API Error ${response.status}: ${errorText}`);
        }

        const data = await response.json();
        
        // Validation logic moved from server.js
        const candidate = data.candidates?.[0];
        if (!candidate) throw new Error("Gemini returned no candidates.");
        
        if (candidate.finishReason && candidate.finishReason !== "STOP") {
            throw new Error(`Blocked by Gemini. Reason: ${candidate.finishReason}`);
        }

        const parts = candidate.content?.parts;
        if (!parts || parts.length === 0) {
            throw new Error("Gemini returned success but no image data.");
        }

        return data;
    }

    async validate() {
        if (!this.config.apiKey) return { valid: false, error: "No API Key" };

        try {
            const response = await fetch(`${this.baseUrl}/models?key=${this.config.apiKey}`);
            const data = await response.json();

            if (!response.ok) {
                return { valid: false, error: data.error?.message || 'Validation failed' };
            }

            const models = data.models?.map(m => m.name.replace('models/', '')) || [];
            return { valid: true, models };
        } catch (e) {
            return { valid: false, error: e.message };
        }
    }
}

module.exports = GeminiProvider;