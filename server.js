require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Global Runtime Config (allows changing key without redeploy)
let currentApiKey = process.env.GEMINI_API_KEY;

// Middleware
// RUTHLESS SECURITY: Allow only your Framer site in production.
// Set ALLOWED_ORIGIN in Render environment variables (e.g., "https://your-site.framer.website")
const allowedOrigin = process.env.ALLOWED_ORIGIN || '*';
app.use(cors({
    origin: allowedOrigin,
    methods: ['GET', 'POST'] // Added GET for dashboard
}));

// Serve Dashboard
app.use(express.static(path.join(__dirname, 'public')));
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

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
        
        if (!currentApiKey) {
            throw new Error("Server Misconfiguration: GEMINI_API_KEY is missing");
        }

        const geminiResponse = await fetch(geminiUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-goog-api-key": currentApiKey
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

// --- ADMIN DASHBOARD ENDPOINTS ---

// 1. Update API Key (Runtime only)
app.post('/api/admin/config', (req, res) => {
    const { apiKey } = req.body;
    if (!apiKey) return res.status(400).json({ error: 'API Key is required' });
    
    currentApiKey = apiKey;
    console.log('API Key updated via Dashboard (Runtime Override)');
    res.json({ success: true, message: 'API Key updated for this session.' });
});

// 2. Validate API Key
app.post('/api/admin/validate-key', async (req, res) => {
    try {
        if (!currentApiKey) return res.status(400).json({ error: 'No API Key set' });

        // List models to check auth
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${currentApiKey}`);
        const data = await response.json();

        if (!response.ok) {
            return res.status(response.status).json({ error: data.error?.message || 'Validation failed' });
        }

        // Check if our required model exists
        const hasImageModel = data.models?.some(m => m.name.includes('gemini-2.5-flash-image'));
        
        res.json({ 
            valid: true, 
            models: data.models?.map(m => m.name).join(', '),
            hasRequiredModel: hasImageModel
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 3. Run Test Generation (End-to-End)
app.post('/api/admin/test-generation', async (req, res) => {
    try {
        console.log("Starting Admin Test Generation...");
        
        // A. Fetch Dummy Images (Portrait & T-Shirt)
        // Using Unsplash source URLs which redirect to actual images
        const userImgUrl = "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400&q=80"; // Portrait
        const productImgUrl = "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=400&q=80"; // T-Shirt

        const [userRes, prodRes] = await Promise.all([fetch(userImgUrl), fetch(productImgUrl)]);
        
        if (!userRes.ok || !prodRes.ok) throw new Error("Failed to fetch test images from Unsplash");

        const userBuff = await userRes.arrayBuffer();
        const prodBuff = await prodRes.arrayBuffer();

        const userBase64 = Buffer.from(userBuff).toString('base64');
        const prodBase64 = Buffer.from(prodBuff).toString('base64');

        // B. Construct Payload (Same as main endpoint)
        const geminiPayload = {
            contents: [{
                parts: [
                    { text: "Drape the clothing from the product image onto the person in the user photo." },
                    { inline_data: { mime_type: "image/jpeg", data: userBase64 } },
                    { inline_data: { mime_type: "image/jpeg", data: prodBase64 } }
                ]
            }]
        };

        // C. Call Gemini
        const geminiUrl = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent";
        const geminiResponse = await fetch(geminiUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-goog-api-key": currentApiKey
            },
            body: JSON.stringify(geminiPayload)
        });

        const data = await geminiResponse.json();
        
        if (!geminiResponse.ok) {
            return res.status(geminiResponse.status).json({ error: JSON.stringify(data) });
        }

        res.json(data);

    } catch (error) {
        console.error("Test Gen Error:", error);
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Node Version: ${process.version}`);
});
