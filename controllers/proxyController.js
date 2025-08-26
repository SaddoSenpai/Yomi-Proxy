// controllers/proxyController.js
// Handles the core logic of proxying requests to the respective AI providers.

const axios = require('axios');
const crypto = require('crypto');
const keyManager = require('../services/keyManager');
const statsService = require('../services/statsService');
const promptService = require('../services/promptService');

/**
 * Proxies an incoming request to the specified AI provider.
 * @param {object} req - The Express request object.
 * @param {object} res - The Express response object.
 * @param {string} provider - The name of the provider (e.g., 'gemini').
 */
exports.proxyRequest = async (req, res, provider) => {
    const reqId = crypto.randomBytes(4).toString('hex');
    const tokenUser = req.userTokenInfo ? ` (Token: ${req.userTokenInfo.name})` : '';
    console.log(`\n--- [${reqId}] New Request for Provider: ${provider}${tokenUser} ---`);

    statsService.incrementPromptCount();
    const rotatingKey = keyManager.getRotatingKey(provider);

    if (!rotatingKey) {
        console.error(`[${reqId}] No active keys available for ${provider}.`);
        return res.status(503).json({ error: `No active API keys available for provider '${provider}'.` });
    }

    const apiKey = rotatingKey.value;
    const body = req.body;
    
    let forwardUrl, forwardBody, headers;
    const providerConfig = keyManager.getProviderConfig(provider);

    try {
        const finalMessages = await promptService.buildFinalMessages(provider, body.messages, reqId);

        // --- Provider-Specific Request Building ---
        if (providerConfig.isCustom) {
            forwardUrl = `${providerConfig.apiBaseUrl}/v1/chat/completions`;
            forwardBody = { ...body, messages: finalMessages, model: providerConfig.modelId };
            headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` };
        } else {
            switch (provider) {
                case 'gemini':
                    forwardUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${apiKey}`;
                    const contents = finalMessages.map(m => ({
                        role: m.role === 'assistant' ? 'model' : 'user',
                        parts: [{ text: m.content || '' }]
                    }));
                    forwardBody = { contents, generation_config: { temperature: body.temperature, top_p: body.top_p } };
                    headers = { 'Content-Type': 'application/json' };
                    break;
                
                case 'deepseek':
                case 'openai':
                case 'openrouter':
                case 'mistral':
                    forwardBody = { ...body, messages: finalMessages };
                    headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` };
                    if (provider === 'deepseek') forwardUrl = 'https://api.deepseek.com/chat/completions';
                    if (provider === 'openai') forwardUrl = 'https://api.openai.com/v1/chat/completions';
                    if (provider === 'openrouter') forwardUrl = 'https://openrouter.ai/api/v1/chat/completions';
                    if (provider === 'mistral') forwardUrl = 'https://api.mistral.ai/v1/chat/completions';
                    break;

                default:
                    return res.status(400).json({ error: `Unsupported provider: ${provider}` });
            }
        }

        // --- Forward the Request ---
        const providerResponse = await axios.post(forwardUrl, forwardBody, { 
            headers, 
            responseType: body.stream ? 'stream' : 'json' 
        });

        keyManager.recordSuccess(provider, apiKey);

        if (body.stream) {
            res.setHeader('Content-Type', 'text/event-stream');
            providerResponse.data.pipe(res);
        } else {
            let responseData = providerResponse.data;
            let usage = responseData.usage || { prompt_tokens: 0, completion_tokens: 0 };

            if (provider === 'gemini') {
                const responseText = responseData.candidates?.[0]?.content?.parts?.[0]?.text || '';
                responseData = {
                    choices: [{ message: { role: 'assistant', content: responseText } }],
                    usage: { prompt_tokens: 0, completion_tokens: 0 }
                };
            }
            
            statsService.addTokens(usage.prompt_tokens, usage.completion_tokens);
            res.status(providerResponse.status).json(responseData);
        }
        console.log(`--- [${reqId}] Request Completed Successfully ---`);

    } catch (error) {
        if (error instanceof promptService.UserInputError) {
            console.warn(`[${reqId}] User Input Error: ${error.message}`);
            return res.status(400).json({ error: 'Invalid command usage', detail: error.message });
        }

        console.error(`[${reqId}] Proxy Error: Provider: ${provider}, Status: ${error.response?.status}, Message: ${error.message}`);
        
        const status = error.response?.status;
        if (status === 402) {
            keyManager.deactivateKey(provider, apiKey, 'over_quota');
        } else if (status === 429) {
            keyManager.recordFailure(provider, apiKey);
        } else if (status === 401 || status === 403) {
            keyManager.deactivateKey(provider, apiKey, 'revoked');
        }

        if (!res.headersSent) {
            res.status(status || 500).json(error.response?.data || { error: 'An internal proxy error occurred.' });
        }
        console.log(`--- [${reqId}] Request Failed ---`);
    }
};