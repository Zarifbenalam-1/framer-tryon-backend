require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
// RUTHLESS SECURITY: Allow only your Framer site in production.
// Set ALLOWED_ORIGIN in Render environment variables (e.g., "https://your-site.framer.website")
const allowedOrigin = process.env.ALLOWED_ORIGIN || '*';
app.use(cors({
    origin: allowedOrigin,
    methods: ['POST']
}));

// RUTHLESS FIX: Prevent DoS. Default to 10mb, allow env override.
const maxBodySize = process.env.MAX_BODY_SIZE || '10mb';
app.use(express.json({ limit: maxBodySize }));

// Health check
app.get('/', (req, res) => {
    res.send('Try-On API is running. Status: Bulletproof.');
});

// The Main Endpoint
app.post('/api/generate-tryon', async (req, res) => {
    try {
        const { userImage, productImageUrl } = req.body;

        // 1. Input Validation
        if (!userImage || !productImageUrl) {
            console.warn("Blocked request: Missing data");
            return res.status(400).json({ error: 'Missing userImage or productImageUrl' });
        }

        // RUTHLESS SECURITY: SSRF Protection via Allowlist
        try {
            const url = new URL(productImageUrl);
            
            // 1. Protocol Check
            if (url.protocol !== 'http:' && url.protocol !== 'https:') {
                throw new Error('Invalid protocol');
            }

            // 2. Domain Allowlist Check
            // Default trusted domains for Framer/Shopify. Add more via env var if needed.
            const defaultTrusted = ['framerusercontent.com', 'cdn.shopify.com', 'shopify.com', 'images.unsplash.com'];
            const envTrusted = process.env.TRUSTED_DOMAINS ? process.env.TRUSTED_DOMAINS.split(',') : [];
            const trustedDomains = [...defaultTrusted, ...envTrusted];

            const isTrusted = trustedDomains.some(domain => url.hostname.endsWith(domain.trim()));

            if (!isTrusted) {
                throw new Error(`Domain not trusted: ${url.hostname}`);
            }

        } catch (e) {
            console.warn(`Blocked SSRF Attempt: ${e.message}`);
            return res.status(400).json({ error: 'Invalid or untrusted product image URL.' });
        }

        console.log(`Processing try-on for product: ${productImageUrl}`);

        // 2. Fetch the product image from the URL (server-side)
        // Using Node 18+ native fetch
        const productImgResponse = await fetch(productImageUrl);
        if (!productImgResponse.ok) {
            throw new Error(`Failed to fetch product image: ${productImgResponse.statusText}`);
        }
        
        const productImgBuffer = await productImgResponse.arrayBuffer();
        const productImgBase64 = Buffer.from(productImgBuffer).toString('base64');
        const productMimeType = productImgResponse.headers.get('content-type') || 'image/jpeg';

        // 3. Prepare payload for Gemini
        const geminiPayload = {
            contents: [
                {
                    parts: [
                        {
                            text: "Drape the clothing from the product image onto the person in the user photo, preserving face, pose, and background. Ensure realistic fit and high quality."
                        },
                        {
                            inline_data: {
                                mime_type: userImage.mimeType, 
                                data: userImage.data // Expecting base64 from frontend
                            }
                        },
                        {
                            inline_data: {
                                mime_type: productMimeType,
                                data: productImgBase64
                            }
                        }
                    ]
                }
            ]
        };

        // 4. Call Gemini API
        // Using Gemini 2.5 Flash Image (Nano Banana) for native image generation
        const geminiUrl = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent";
        
        if (!process.env.GEMINI_API_KEY) {
            throw new Error("Server Misconfiguration: GEMINI_API_KEY is missing");
        }

        const geminiResponse = await fetch(geminiUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-goog-api-key": process.env.GEMINI_API_KEY
            },
            body: JSON.stringify(geminiPayload)
        });

        if (!geminiResponse.ok) {
            const errorText = await geminiResponse.text();
            console.error(`Gemini API Error: ${geminiResponse.status}`, errorText);
            
            // RUTHLESS FIX: Handle Quota/Billing Errors Gracefully
            if (geminiResponse.status === 429 || geminiResponse.status == '429') {
                return res.status(429).json({ 
                    error: "Quota Exceeded. The 'Virtual Try-On' feature (Image-to-Image) requires the 'gemini-2.5-flash-image' model, which is currently not available on the Gemini API Free Tier. Please enable billing in Google AI Studio to use this feature." 
                });
            }
            
            throw new Error(`Gemini API error: ${geminiResponse.status} - ${errorText}`);
        }

        const data = await geminiResponse.json();
        console.log("Gemini Response:", JSON.stringify(data, null, 2)); // Log full response for debugging

        // RUTHLESS FIX: Handle Safety Blocks & Empty Responses
        const candidate = data.candidates?.[0];
        if (!candidate) {
             throw new Error("Gemini returned no candidates. The AI might be overloaded.");
        }

        if (candidate.finishReason && candidate.finishReason !== "STOP") {
            // Common reasons: SAFETY, RECITATION, OTHER
            console.warn(`Blocked by Gemini. Reason: ${candidate.finishReason}`);
            return res.status(400).json({ 
                error: `AI Generation Failed. Reason: ${candidate.finishReason}. Try a different photo.` 
            });
        }

        // Safe parsing
        const parts = candidate.content?.parts;
        if (!parts || parts.length === 0) {
             console.error("Gemini returned success but no parts. Full response:", JSON.stringify(data));
             return res.status(400).json({ error: "The AI could not generate an image for this photo. Please try a different one." });
        }

        // 5. Send result back to frontend
        console.log("Gemini generation successful");
        res.json(data);

    } catch (error) {
        console.error("Server Error:", error);
        
        // RUTHLESS FIX: Catch-all for 429 errors to prevent crashes
        if (error.message.includes("429") || error.message.includes("Quota")) {
             return res.status(429).json({ 
                error: "Quota Exceeded. Please enable billing to use the Virtual Try-On feature." 
            });
        }

        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Node Version: ${process.version}`);
});
