class AIProvider {
    constructor(config) {
        this.config = config; // { apiKey, model, ... }
    }

    /**
     * Generates a Virtual Try-On image.
     * @param {Object} userImage - { data: "base64...", mimeType: "image/jpeg" }
     * @param {Object} productImage - { data: "base64...", mimeType: "image/jpeg" }
     * @returns {Promise<Object>} - The raw JSON response from the provider
     */
    async generateTryOn(userImage, productImage) {
        throw new Error("Method 'generateTryOn' must be implemented");
    }

    /**
     * Validates the API Key and returns available models.
     * @returns {Promise<{valid: boolean, models: string[], error?: string}>}
     */
    async validate() {
        throw new Error("Method 'validate' must be implemented");
    }
}

module.exports = AIProvider;