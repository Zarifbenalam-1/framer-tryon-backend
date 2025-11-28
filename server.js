require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const ProviderFactory = require('./providers/factory');

const app = express();
const PORT = process.env.PORT || 3000;

// --- Global Runtime Config ---
// These allow changing settings without redeploy (ephemeral)
let currentProviderName = process.env.AI_PROVIDER || 'gemini';
let currentApiKey = process.env.GEMINI_API_KEY;
let currentModel = process.env.GEMINI_MODEL || 'gemini-2.5-flash-image';

// Helper to get the active provider instance
const getProvider = () => {
    return ProviderFactory.getProvider(currentProviderName, {
        apiKey: currentApiKey,
        model: currentModel
    });
};

// --- Middleware ---
// RUTHLESS SECURITY: Allow only your Framer site in production.
const allowedOrigin = process.env.ALLOWED_ORIGIN || '*';
app.use(cors({
    origin: allowedOrigin,
    methods: ['GET', 'POST']
}));

// RUTHLESS SECURITY: Basic Auth Middleware
const authMiddleware = (req, res, next) => {
    const adminUser = process.env.ADMIN_USERNAME || 'admin';
    const adminPass = process.env.ADMIN_PASSWORD || 'admin123';

    const b64auth = (req.headers.authorization || '').split(' ')[1] || '';
    const [login, password] = Buffer.from(b64auth, 'base64').toString().split(':');

    if (login === adminUser && password === adminPass) {
        return next();
    }

    res.set('WWW-Authenticate', 'Basic realm="Admin Dashboard"');
    res.status(401).send('Authentication required.');
};

// Serve Dashboard (PROTECTED)
app.get('/admin', authMiddleware, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// Protect all Admin API routes
app.use('/api/admin', authMiddleware);

// RUTHLESS FIX: Prevent DoS. Default to 10mb.
const maxBodySize = process.env.MAX_BODY_SIZE || '10mb';
app.use(express.json({ limit: maxBodySize }));

// Health check
app.get('/', (req, res) => {
    res.send(`
        <div style="font-family: sans-serif; padding: 20px;">
            <h1>Try-On API is running</h1>
            <p>Status: <strong style="color: green;">Bulletproof</strong></p>
            <p>Provider: <strong>${currentProviderName}</strong></p>
            <p><a href="/admin">Open Admin Dashboard</a></p>
        </div>
    `);
});

// --- Main Endpoint ---
app.post('/api/generate-tryon', async (req, res) => {
    try {
        const { userImage, productImageUrl } = req.body;

        // 1. Input Validation
        if (!userImage || !productImageUrl) {
            console.warn("Blocked request: Missing data");
            return res.status(400).json({ error: 'Missing userImage or productImageUrl' });
        }

        // RUTHLESS SECURITY: SSRF Protection
        try {
            const url = new URL(productImageUrl);
            if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Invalid protocol');
            
            const defaultTrusted = ['framerusercontent.com', 'cdn.shopify.com', 'shopify.com', 'images.unsplash.com'];
            const envTrusted = process.env.TRUSTED_DOMAINS ? process.env.TRUSTED_DOMAINS.split(',') : [];
            const trustedDomains = [...defaultTrusted, ...envTrusted];

            if (!trustedDomains.some(domain => url.hostname.endsWith(domain.trim()))) {
                throw new Error(`Domain not trusted: ${url.hostname}`);
            }
        } catch (e) {
            console.warn(`Blocked SSRF Attempt: ${e.message}`);
            return res.status(400).json({ error: 'Invalid or untrusted product image URL.' });
        }

        console.log(`Processing try-on for product: ${productImageUrl}`);

        // 2. Fetch Product Image (Server-side)
        const productImgResponse = await fetch(productImageUrl);
        if (!productImgResponse.ok) throw new Error(`Failed to fetch product image: ${productImgResponse.statusText}`);
        
        const productImgBuffer = await productImgResponse.arrayBuffer();
        const productImgBase64 = Buffer.from(productImgBuffer).toString('base64');
        const productMimeType = productImgResponse.headers.get('content-type') || 'image/jpeg';

        // 3. Delegate to Provider
        const provider = getProvider();
        const result = await provider.generateTryOn(
            userImage, // { data, mimeType }
            { data: productImgBase64, mimeType: productMimeType }
        );

        console.log("Generation successful");
        res.json(result);

    } catch (error) {
        console.error("Server Error:", error);
        
        // Handle known provider errors
        if (error.message.includes("429_QUOTA")) {
             return res.status(429).json({ error: error.message.replace("429_QUOTA: ", "") });
        }

        res.status(500).json({ error: error.message });
    }
});

// --- ADMIN DASHBOARD ENDPOINTS ---

// 1. Update Config (Runtime only)
app.post('/api/admin/config', (req, res) => {
    const { apiKey, model, provider } = req.body;
    
    if (apiKey) {
        currentApiKey = apiKey;
        console.log('API Key updated via Dashboard');
    }
    
    if (model) {
        currentModel = model;
        console.log(`Model updated via Dashboard to: ${currentModel}`);
    }

    if (provider) {
        currentProviderName = provider;
        console.log(`Provider updated via Dashboard to: ${currentProviderName}`);
    }

    res.json({ 
        success: true, 
        message: 'Configuration updated.',
        currentProvider: currentProviderName,
        currentModel: currentModel
    });
});

// 2. Validate & List Models
app.post('/api/admin/validate-key', async (req, res) => {
    try {
        const provider = getProvider();
        const result = await provider.validate();

        res.json({ 
            ...result,
            currentProvider: currentProviderName,
            currentModel: currentModel,
            envModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash-image (Default)'
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 3. Run Test Generation
app.post('/api/admin/test-generation', async (req, res) => {
    try {
        console.log("Starting Admin Test Generation...");
        
        // A. Fetch Dummy Images
        const userImgUrl = "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400&q=80";
        const productImgUrl = "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=400&q=80";

        const [userRes, prodRes] = await Promise.all([fetch(userImgUrl), fetch(productImgUrl)]);
        if (!userRes.ok || !prodRes.ok) throw new Error("Failed to fetch test images");

        const userBuff = await userRes.arrayBuffer();
        const prodBuff = await prodRes.arrayBuffer();

        // B. Delegate to Provider
        const provider = getProvider();
        const result = await provider.generateTryOn(
            { data: Buffer.from(userBuff).toString('base64'), mimeType: "image/jpeg" },
            { data: Buffer.from(prodBuff).toString('base64'), mimeType: "image/jpeg" }
        );

        res.json(result);

    } catch (error) {
        console.error("Test Gen Error:", error);
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Node Version: ${process.version}`);
});
