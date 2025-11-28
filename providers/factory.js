const GeminiProvider = require('./gemini');
const HuggingFaceProvider = require('./huggingface');

class ProviderFactory {
    static getProvider(providerName, config) {
        switch(providerName.toLowerCase()) {
            case 'gemini':
                return new GeminiProvider(config);
            case 'huggingface':
                return new HuggingFaceProvider(config);
            default:
                throw new Error(`Unknown provider '${providerName}'. Supported: gemini, huggingface`);
        }
    }
}

module.exports = ProviderFactory;